export const agentCapabilities = [
  "search",
  "inventory",
  "book",
  "bookings",
  "tickets",
  "cancel",
  "commissions",
  "settlements",
  "wallet",
  "credit",
] as const;
export type AgentCapability = (typeof agentCapabilities)[number];
