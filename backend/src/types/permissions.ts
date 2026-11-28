export type Role =
  | "super_admin"
  | "operator_admin"
  | "manager"
  | "booking_staff"
  | "read_only"
  | "agent"
  | "vehicle_owner"
  | "partner";

export type Permission =
  | (typeof import("./partner-portal.js").partnerPermissions)[number]
  | (typeof import("./platform.js").platformPermissions)[number]
  | "read"
  | "fleet:write"
  | "routes:write"
  | "inventory:write"
  | "bookings:write"
  | "manifest:read"
  | "manifest:write"
  | "pricing:write"
  | "refunds:write"
  | "offers:write"
  | "staff:write"
  | "settings:write"
  | "finance:read"
  | "finance:manage"
  | "platform:finance:read"
  | "refunds:review"
  | "settlements:prepare"
  | "settlements:approve"
  | "payouts:authorize"
  | "agents:read"
  | "agents:write"
  | "platform:manage";

export const rolePermissions: Record<Role, Permission[]> = {
  super_admin: ["platform:manage"],
  operator_admin: [
    "finance:manage",
    "agents:read",
    "agents:write",
    "read",
    "fleet:write",
    "routes:write",
    "inventory:write",
    "bookings:write",
    "manifest:read",
    "manifest:write",
    "pricing:write",
    "refunds:write",
    "offers:write",
    "staff:write",
    "settings:write",
    "finance:read",
  ],
  manager: [
    "agents:read",
    "read",
    "fleet:write",
    "routes:write",
    "inventory:write",
    "bookings:write",
    "manifest:read",
    "manifest:write",
    "pricing:write",
    "refunds:write",
    "offers:write",
    "finance:read",
  ],
  booking_staff: ["read", "bookings:write", "manifest:read", "manifest:write"],
  read_only: ["read"],
  agent: [],
  vehicle_owner: [],
  partner: [],
};

export interface Principal {
  userId: string;
  operatorId: string | null;
  role: Role;
  sessionId: string;
  permissions: Permission[];
  agentId?: string;
  partnerId?: string;
  partnerRole?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth: Principal;
      requestId: string;
    }
  }
}
