import { EventEmitter } from "node:events";
import type { Request } from "express";
import { z } from "zod";
import { publicApiSpec } from "../docs/public-api.openapi.js";
import { publicApiRouter } from "../routes/public-api.routes.js";
import {
  authenticatePartner,
  generateCredential,
  sandboxReady,
} from "./public-auth.service.js";
import * as P from "../models/public-api.model.js";
import { portalMember } from "./partner-portal.service.js";
import type { Config } from "../config/env.js";
import type { Limiter } from "../middleware/auth.middleware.js";
import { errorHandler, fail } from "../utils/core.js";

export const playgroundInput = z
  .object({
    operationId: z.string().max(80),
    params: z
      .object({
        id: z
          .string()
          .regex(/^[a-z]+_[\w-]{16,100}$/)
          .optional(),
      })
      .strict()
      .default({}),
    query: z.record(z.string().max(500)).default({}),
    body: z.unknown().default({}),
    idempotencyKey: z
      .string()
      .regex(/^[\w.:-]{16,100}$/)
      .optional(),
  })
  .strict();
// Derived only from the locally compiled contract. No user URL, method, headers or host is accepted.
export const playgroundOperations = Object.entries(publicApiSpec.paths).flatMap(
  ([path, methods]) =>
    Object.entries(methods)
      .filter(
        ([method, op]: any) =>
          ["get", "post"].includes(method) && op.operationId !== "authenticate",
      )
      .map(([method, op]: any) => ({
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
      })),
);
export async function executePlayground(
  config: Config,
  limiter: Limiter,
  req: Request,
  input: z.infer<typeof playgroundInput>,
) {
  sandboxReady(config);
  const { partner } = await portalMember(req.auth, "partner:playground");
  const op = playgroundOperations.find(
    (o) => o.operationId === input.operationId,
  );
  if (!op)
    fail(
      400,
      "PLAYGROUND_OPERATION",
      "Select an allowlisted sandbox operation",
    );
  if (op!.operationId === "ticket")
    await portalMember(req.auth, "partner:passengers");
  if (op!.path.includes("{id}") && !input.params.id)
    fail(400, "RESOURCE_REQUIRED", "This operation requires a resource ID");
  // Short-lived backend-only credentials never cross the portal boundary. Revoked after each request.
  const issued = await generateCredential(
    config,
    String(partner._id),
    partner.scopes,
    new Date(Date.now() + 60000),
    {
      actorId: req.auth.userId,
      portalManaged: true,
      label: "Portal sandbox execution",
    },
  );
  try {
    const token = await authenticatePartner(config, issued.credential);
    const router = publicApiRouter(config, limiter),
      start = performance.now();
    const clone = Object.create(req);
    const path = op!.path
      .replace(/^\/api\/v1\/public/, "")
      .replace("{id}", encodeURIComponent(input.params.id || ""));
    Object.assign(clone, {
      method: op!.method,
      url: path + "?" + new URLSearchParams(input.query),
      originalUrl: path,
      baseUrl: "",
      body: input.body,
      params: {},
      route: undefined,
      headers: {
        authorization: "Bearer " + token.accessToken,
        ...(input.idempotencyKey
          ? { "idempotency-key": input.idempotencyKey }
          : {}),
      },
    });
    Object.defineProperty(clone, "query", {
      value: input.query,
      writable: true,
    });
    return await new Promise<any>((resolve) => {
      const response: any = new EventEmitter();
      response.statusCode = 200;
      response.headersSent = false;
      response.set = () => response;
      response.setHeader = () => response;
      response.status = (code: number) => {
        response.statusCode = code;
        return response;
      };
      response.json = (body: any) => {
        response.headersSent = true;
        response.emit("finish");
        resolve({
          status: response.statusCode,
          durationMs: Math.round(performance.now() - start),
          requestId: req.requestId,
          response: body,
          environment: "sandbox",
        });
        return response;
      };
      router(clone, response, (error: any) => {
        if (error) errorHandler(error, clone, response, () => {});
        else
          response
            .status(404)
            .json({
              error: {
                code: "NOT_FOUND",
                message: "Sandbox operation not found",
              },
            });
      });
    });
  } finally {
    await P.ApiCredential.updateOne(
      { publicId: issued.id },
      { $set: { revokedAt: new Date() } },
    );
  }
}
