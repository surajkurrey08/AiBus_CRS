import type { Permission } from "./permissions.js";
export const platformPermissions = [
  "platform:partners:read",
  "platform:partners:write",
  "platform:overview:read",
  "platform:operators:read",
  "platform:operators:write",
  "platform:verification:write",
  "platform:monitor:read",
  "platform:agencies:read",
  "platform:bookings:read",
  "platform:passengers:read",
  "platform:reports:read",
  "platform:audit:read",
  "platform:staff:write",
  "platform:settings:read",
  "platform:settings:write",
] as const;
export const platformProfiles = [
  "Platform Operations",
  "Finance Manager",
  "Booking Support",
  "Operator Verification",
  "Audit / Read Only",
] as const;
export const profilePermissions: Record<string, readonly string[]> = {
  "Platform Operations": [
    "platform:partners:read",
    "platform:overview:read",
    "platform:operators:read",
    "platform:monitor:read",
    "platform:agencies:read",
    "platform:reports:read",
    "platform:settings:read",
  ],
  "Finance Manager": [
    "platform:overview:read",
    "platform:operators:read",
    "platform:agencies:read",
    "platform:bookings:read",
    "platform:reports:read",
    "platform:audit:read",
  ],
  "Booking Support": [
    "platform:overview:read",
    "platform:operators:read",
    "platform:monitor:read",
    "platform:bookings:read",
    "platform:passengers:read",
    "platform:reports:read",
  ],
  "Operator Verification": [
    "platform:overview:read",
    "platform:operators:read",
    "platform:operators:write",
    "platform:verification:write",
    "platform:monitor:read",
  ],
  "Audit / Read Only": platformPermissions.filter(
    (p) => p.endsWith(":read") && p !== "platform:passengers:read",
  ),
};
export function platformIdentity(user: any): Permission[] {
  if (user.role !== "super_admin" || user.operatorId || user.salesPartnerId)
    return [];
  const operations = user.platformProfile
    ? (user.platformPermissions || []).filter((p: string) =>
        profilePermissions[user.platformProfile]?.includes(p),
      )
    : ["platform:manage", ...platformPermissions];
  const finance =
    user.platformFinanceRead === true
      ? [
          "platform:finance:read",
          ...(user.platformFinanceActions || []).filter(
            (p: string) =>
              [
                "refunds:review",
                "settlements:prepare",
                "settlements:approve",
                "payouts:authorize",
              ].includes(p) &&
              (!user.platformProfile ||
                user.platformProfile === "Finance Manager"),
          ),
        ]
      : [];
  return [...operations, ...finance] as Permission[];
}
