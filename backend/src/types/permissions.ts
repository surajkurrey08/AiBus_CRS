export type Role =
  "super_admin" | "operator_admin" | "manager" | "booking_staff" | "read_only";

export type Permission =
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
  | "platform:manage";

export const rolePermissions: Record<Role, Permission[]> = {
  super_admin: ["platform:manage"],
  operator_admin: [
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
};

export interface Principal {
  userId: string;
  operatorId: string | null;
  role: Role;
  sessionId: string;
  permissions: Permission[];
}

declare global {
  namespace Express {
    interface Request {
      auth: Principal;
      requestId: string;
    }
  }
}
