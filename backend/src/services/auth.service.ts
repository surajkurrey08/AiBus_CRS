import { type Response } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import type { Config } from "../config/env.js";
import { Operator, Session, User } from "../models/index.js";
import {
  fail,
  ok,
  rolePermissions,
  type Principal,
  type Role,
} from "../utils/core.js";
export const scrypt = (password: string, salt: string, length: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(
      password,
      salt,
      length,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );

export const hashToken = (s: string) =>
  createHash("sha256").update(s).digest("hex");

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt-v1:${salt}:${hash.toString("hex")}`;
}

export async function checkPassword(password: string, encoded: string) {
  const [, salt, hash] = encoded.split(":");
  if (!salt || !hash) return false;
  const candidate = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

export function signAccess(userId: string, sessionId: string, config: Config) {
  return jwt.sign({ sid: sessionId }, config.JWT_SECRET, {
    subject: userId,
    issuer: "aibus-operator",
    audience: "aibus-dashboard",
    expiresIn: "10m",
    algorithm: "HS256",
  });
}

export async function principal(
  token: string,
  config: Config,
): Promise<Principal> {
  let claims: jwt.JwtPayload;
  try {
    const parsed = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "aibus-operator",
      audience: "aibus-dashboard",
    });
    if (typeof parsed === "string") throw new Error();
    claims = parsed;
  } catch {
    fail(401, "UNAUTHENTICATED", "Sign in to continue");
  }
  if (
    typeof claims!.sub !== "string" ||
    !mongoose.isValidObjectId(claims!.sub) ||
    typeof claims!.sid !== "string" ||
    !mongoose.isValidObjectId(claims!.sid)
  )
    fail(401, "UNAUTHENTICATED", "Invalid session");
  const session = await Session.findOne({
    _id: claims!.sid,
    userId: claims!.sub,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).lean();
  const user = await User.findOne({ _id: claims!.sub, active: true }).lean();
  if (!session || !user)
    fail(401, "SESSION_REVOKED", "Your session has ended. Sign in again.");
  if (user!.role !== "super_admin") {
    const operator = await Operator.findOne({
      _id: user!.operatorId,
      status: "approved",
    }).lean();
    if (!operator)
      fail(
        403,
        "OPERATOR_NOT_APPROVED",
        "Your operator account is not approved or is suspended",
      );
  }
  const role = user!.role as Role;
  return {
    userId: String(user!._id),
    operatorId: user!.operatorId ? String(user!.operatorId) : null,
    role,
    sessionId: String(session!._id),
    permissions: rolePermissions[role],
  };
}

export function setRefresh(
  res: Response,
  value: string,
  config: Config,
  cookieName = "aibus_refresh",
) {
  res.cookie(cookieName, value, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
    maxAge: 7 * 86400000,
  });
}

export function clearRefresh(
  res: Response,
  config: Config,
  cookieName = "aibus_refresh",
) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
  });
}

export async function sessionResponse(
  user: Record<string, unknown>,
  res: Response,
  config: Config,
  family = randomUUID(),
  cookieName = "aibus_refresh",
) {
  const refresh = randomBytes(48).toString("base64url");
  const session = await Session.create({
    userId: user._id,
    family,
    refreshHash: hashToken(refresh),
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  setRefresh(res, refresh, config, cookieName);
  return ok(res, {
    accessToken: signAccess(String(user._id), String(session._id), config),
    expiresIn: 600,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      operatorId: user.operatorId ? String(user.operatorId) : null,
      permissions: rolePermissions[user.role as Role],
    },
  });
}
