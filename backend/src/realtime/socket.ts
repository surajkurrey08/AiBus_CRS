import { recordRealtime } from "../services/observability.service.js";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { Config } from "../config/env.js";
import { principal } from "../modules/auth/index.js";
export function attachRealtime(
  server: HttpServer,
  config: Config,
  adapter?: ReturnType<typeof createAdapter>,
) {
  const io = new Server(server, {
    cors: { origin: config.WEB_ORIGIN, credentials: true },
    maxHttpBufferSize: 16 * 1024,
    transports: ["websocket"],
  });
  if (adapter) io.adapter(adapter);
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string") throw new Error("Missing token");
      const auth = await principal(token, config);
      if (!auth.operatorId || auth.agentId)
        throw new Error("Operator staff context required");
      socket.data.auth = auth;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });
  recordRealtime(0, !!adapter);
  io.on("connection", (socket) => {
    recordRealtime(io.engine.clientsCount, !!adapter);
    const auth = socket.data.auth;
    void socket.join(`operator:${auth.operatorId}`);
    const timer = setInterval(async () => {
      try {
        await principal(String(socket.handshake.auth.token), config);
      } catch {
        socket.disconnect(true);
      }
    }, 15000);
    timer.unref();
    socket.on("disconnect", () => { clearInterval(timer); recordRealtime(io.engine.clientsCount, !!adapter); }); /* No client-controlled room joins or mutation events. */
  });
  return io;
}
