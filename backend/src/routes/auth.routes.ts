import { Router, type Request } from "express";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { Config } from "../config/env.js";
import {
  authenticate,
  rateLimit,
  type Limiter,
} from "../middleware/auth.middleware.js";
import { Audit, Operator, Reset, Session, User } from "../models/index.js";
import {
  checkPassword,
  clearRefresh,
  hashPassword,
  hashToken,
  sessionResponse,
  setRefresh,
  signAccess,
} from "../services/auth.service.js";
import {
  AppError,
  asyncRoute,
  fail,
  ok,
  rolePermissions,
  text,
  type Role,
} from "../utils/core.js";

const refreshCookieName = (req: Request) =>
  req.get("X-Aibus-Client") === "admin"
    ? "aibus_admin_refresh"
    : "aibus_refresh";

export const credentials = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();

export const strongPassword = z.string().min(12).max(128);

export function authRouter(config: Config, limiter: Limiter) {
  const router = Router();
  router.use(rateLimit(limiter, "auth", 100, 900));
  router.post(
    "/register",
    rateLimit(limiter, "register", 5, 3600),
    asyncRoute(async (req, res) => {
      const input = credentials
        .extend({
          password: strongPassword,
          name: text,
          company: text,
          phone: text,
          address: text,
        })
        .parse(req.body);
      const passwordHash = await hashPassword(input.password);
      await mongoose.connection.transaction(async (session) => {
        const [operator] = await Operator.create(
          [
            {
              company: input.company,
              email: input.email,
              phone: input.phone,
              address: input.address,
            },
          ],
          { session },
        );
        await User.create(
          [
            {
              operatorId: operator._id,
              name: input.name,
              email: input.email,
              passwordHash,
              role: "operator_admin",
            },
          ],
          { session },
        );
        await Audit.create(
          [
            {
              operatorId: operator._id,
              action: "operator.register",
              requestId: req.requestId,
            },
          ],
          { session },
        );
      });
      ok(
        res,
        {
          status: "pending",
          message: "Registration submitted for platform approval",
        },
        undefined,
        201,
      );
    }),
  );
  router.post(
    "/login",
    rateLimit(limiter, "login", 10, 900),
    asyncRoute(async (req, res) => {
      const input = credentials.parse(req.body);
      const user = await User.findOne({ email: input.email, active: true })
        .select("+passwordHash")
        .lean();
      const fallback =
        "scrypt:00000000000000000000000000000000:" + "0".repeat(128);
      const valid = await checkPassword(
        input.password,
        (user?.passwordHash as string) || fallback,
      );
      if (!user || !valid)
        fail(401, "INVALID_CREDENTIALS", "Invalid email or password");
      if (
        user!.role !== "super_admin" &&
        !(await Operator.exists({ _id: user!.operatorId, status: "approved" }))
      )
        fail(
          403,
          "OPERATOR_NOT_APPROVED",
          "Your operator account is pending approval or suspended",
        );
      await Audit.create({
        operatorId: user!.operatorId,
        actorId: user!._id,
        action: "auth.login",
        requestId: req.requestId,
      });
      if (req.get("X-Aibus-Client") === "admin" && user!.role !== "super_admin")
        fail(
          403,
          "ADMIN_REQUIRED",
          "Sign in with a platform administrator account",
        );
      await sessionResponse(
        user!,
        res,
        config,
        undefined,
        refreshCookieName(req),
      );
    }),
  );
  router.post(
    "/refresh",
    asyncRoute(async (req, res) => {
      const token = req.cookies?.[refreshCookieName(req)];
      if (typeof token !== "string" || token.length > 128)
        fail(401, "UNAUTHENTICATED", "Refresh session is missing");
      const tokenHash = hashToken(token);
      const old = await Session.findOne({ refreshHash: tokenHash }).lean();
      if (!old) fail(401, "UNAUTHENTICATED", "Refresh session is invalid");
      if (old!.revokedAt) {
        await Session.updateMany(
          { family: old!.family, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        );
        clearRefresh(res, config, refreshCookieName(req));
        fail(
          401,
          "TOKEN_REUSE",
          "Session token reuse detected. Sign in again.",
        );
      }
      if (new Date(old!.expiresAt as Date) <= new Date())
        fail(401, "SESSION_EXPIRED", "Session expired");
      const user = await User.findOne({
        _id: old!.userId,
        active: true,
      }).lean();
      if (!user) fail(401, "SESSION_REVOKED", "Session ended");
      if (
        user!.role !== "super_admin" &&
        !(await Operator.exists({ _id: user!.operatorId, status: "approved" }))
      )
        fail(403, "OPERATOR_NOT_APPROVED", "Operator is not approved");
      const fresh = randomBytes(48).toString("base64url");
      let newId = "";
      try {
        await mongoose.connection.transaction(async (session) => {
          const consumed = await Session.findOneAndUpdate(
            { _id: old!._id, revokedAt: null },
            { $set: { revokedAt: new Date() } },
            { session, new: true },
          );
          if (!consumed)
            fail(401, "TOKEN_REUSE", "Refresh token was already used");
          const [next] = await Session.create(
            [
              {
                userId: user!._id,
                family: old!.family,
                refreshHash: hashToken(fresh),
                expiresAt: new Date(Date.now() + 7 * 86400000),
              },
            ],
            { session },
          );
          newId = String(next._id);
        });
      } catch (error) {
        if (error instanceof AppError && error.code === "TOKEN_REUSE") {
          await Session.updateMany(
            { family: old!.family, revokedAt: null },
            { $set: { revokedAt: new Date() } },
          );
          clearRefresh(res, config, refreshCookieName(req));
        }
        throw error;
      }
      setRefresh(res, fresh, config, refreshCookieName(req));
      ok(res, {
        accessToken: signAccess(String(user!._id), newId, config),
        expiresIn: 600,
        user: {
          id: String(user!._id),
          name: user!.name,
          email: user!.email,
          role: user!.role,
          operatorId: user!.operatorId ? String(user!.operatorId) : null,
          permissions: rolePermissions[user!.role as Role],
        },
      });
    }),
  );
  router.post(
    "/logout",
    asyncRoute(async (req, res) => {
      const token = req.cookies?.[refreshCookieName(req)];
      if (typeof token === "string") {
        const session = await Session.findOne({
          refreshHash: hashToken(token),
        }).lean();
        if (session)
          await Session.updateMany(
            { family: session.family, revokedAt: null },
            { $set: { revokedAt: new Date() } },
          );
      }
      clearRefresh(res, config, refreshCookieName(req));
      ok(res, { loggedOut: true });
    }),
  );
  router.post(
    "/forgot-password",
    rateLimit(limiter, "reset", 5, 3600),
    asyncRoute(async (req, res) => {
      const { email } = z
        .object({
          email: z
            .string()
            .email()
            .transform((v) => v.toLowerCase()),
        })
        .strict()
        .parse(req.body);
      if (!config.SMTP_HOST)
        fail(
          503,
          "EMAIL_UNAVAILABLE",
          "Password reset email is not configured. Contact your administrator.",
        );
      const user = await User.findOne({ email, active: true }).lean();
      if (user) {
        const token = randomBytes(48).toString("base64url");
        await Reset.create({
          userId: user._id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 30 * 60000),
        });
        const transport = nodemailer.createTransport({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_PORT === 465,
          auth: config.SMTP_USER
            ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
            : undefined,
        });
        await transport.sendMail({
          from: config.MAIL_FROM,
          to: email,
          subject: "Reset your Aibus password",
          text: `Reset your password: ${config.WEB_ORIGIN}/?reset=${token}\nThis link expires in 30 minutes.`,
        });
      }
      ok(res, { message: "If the account exists, a reset link has been sent" });
    }),
  );
  router.post(
    "/reset-password",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          token: z.string().min(32).max(128),
          password: strongPassword,
        })
        .strict()
        .parse(req.body);
      const passwordHash = await hashPassword(input.password);
      await mongoose.connection.transaction(async (session) => {
        const reset = await Reset.findOneAndUpdate(
          {
            tokenHash: hashToken(input.token),
            usedAt: null,
            expiresAt: { $gt: new Date() },
          },
          { $set: { usedAt: new Date() } },
          { new: true, session },
        );
        if (!reset)
          fail(400, "RESET_INVALID", "Reset link has expired or was used");
        await User.updateOne(
          { _id: reset!.userId },
          { $set: { passwordHash } },
          { session },
        );
        await Reset.updateMany(
          { userId: reset!.userId, usedAt: null },
          { $set: { usedAt: new Date() } },
          { session },
        );
        await Session.updateMany(
          { userId: reset!.userId, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session },
        );
      });
      clearRefresh(res, config, refreshCookieName(req));
      ok(res, { message: "Password changed. Sign in with your new password." });
    }),
  );
  router.get(
    "/me",
    authenticate(config),
    asyncRoute(async (req, res) => {
      const user = await User.findById(req.auth.userId).lean();
      ok(res, {
        id: req.auth.userId,
        name: user!.name,
        email: user!.email,
        ...req.auth,
      });
    }),
  );
  return router;
}
