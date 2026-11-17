import mongoose from "mongoose";
import { z } from "zod";
import { readConfig } from "../config/env.js";
import { User } from "../models/index.js";
import { hashPassword } from "../modules/auth/index.js";
const input = z
  .object({
    BOOTSTRAP_EMAIL: z
      .string()
      .email()
      .transform((v) => v.toLowerCase()),
    BOOTSTRAP_PASSWORD: z.string().min(16).max(128),
    BOOTSTRAP_NAME: z.string().min(1).default("Platform administrator"),
  })
  .parse(process.env);
await mongoose.connect(readConfig().MONGODB_URI);
try {
  if (await User.exists({ role: "super_admin" }))
    throw new Error(
      "A platform administrator already exists; bootstrap refuses to overwrite it",
    );
  await User.create({
    email: input.BOOTSTRAP_EMAIL,
    name: input.BOOTSTRAP_NAME,
    passwordHash: await hashPassword(input.BOOTSTRAP_PASSWORD),
    role: "super_admin",
  });
  console.log("Platform administrator created. No credentials printed.");
} finally {
  await mongoose.disconnect();
}
