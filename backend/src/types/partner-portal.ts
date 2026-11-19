export const partnerRoles = [
  "Owner",
  "Admin",
  "Developer",
  "Finance Viewer",
  "Read Only",
] as const;
export const partnerPermissions = [
  "partner:overview",
  "partner:credentials:read",
  "partner:credentials:write",
  "partner:inventory",
  "partner:docs",
  "partner:playground",
  "partner:bookings",
  "partner:passengers",
  "partner:webhooks:read",
  "partner:webhooks:write",
  "partner:analytics",
  "partner:export",
  "partner:team:read",
  "partner:team:write",
  "partner:support:read",
  "partner:support:write",
  "partner:settings:write",
] as const;
export const partnerRolePermissions: Record<string, readonly string[]> = {
  Owner: partnerPermissions,
  Admin: partnerPermissions,
  Developer: partnerPermissions.filter(
    (p) =>
      ![
        "partner:team:write",
        "partner:settings:write",
        "partner:passengers",
      ].includes(p),
  ),
  "Finance Viewer": [
    "partner:overview",
    "partner:docs",
    "partner:bookings",
    "partner:analytics",
    "partner:export",
    "partner:support:read",
  ],
  "Read Only": [
    "partner:overview",
    "partner:inventory",
    "partner:docs",
    "partner:bookings",
    "partner:webhooks:read",
    "partner:analytics",
    "partner:team:read",
    "partner:support:read",
  ],
};
export const applicationStates = [
  "Draft",
  "Submitted",
  "Under Review",
  "Approved",
  "Rejected",
  "Suspended",
] as const;
