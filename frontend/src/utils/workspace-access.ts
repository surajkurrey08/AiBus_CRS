export const isAgentWorkspace = (role: string) =>
  role === "agent" || role === "booking_staff";
export const workspaceRoleLabel = (role: string) =>
  isAgentWorkspace(role) ? "Agent" : role.replaceAll("_", " ");
// Release-baseline page IDs: booking history, passenger manifest, booking counter.
export const canOpenWorkspacePage = (role: string, page: number) =>
  !isAgentWorkspace(role) || [4, 5, 11].includes(page);
