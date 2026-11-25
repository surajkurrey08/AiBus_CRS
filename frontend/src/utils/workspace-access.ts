export const isAgentWorkspace = (role: string) =>
  role === "agent" || role === "booking_staff";

// Preserve stored role identifiers; this is the user-facing role name.
export const workspaceRoleLabel = (role: string) =>
  isAgentWorkspace(role) ? "Agent" : role.replaceAll("_", " ");

export const canOpenWorkspacePage = (role: string, page: number) =>
  !isAgentWorkspace(role) || [0, 6, 7].includes(page);
