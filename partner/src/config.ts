import type { Identity } from "./api/client";
import type { ReviewField } from "../../admin/src/features/finance/FinanceReviewForm";
export const can = (user: Identity, p: string) =>
  user.permissions.includes("partner:" + p);
export const scopes = [
  "inventory:read",
  "holds:write",
  "bookings:write",
  "bookings:read",
  "tickets:read",
  "cancellations:write",
  "refunds:read",
  "webhooks:read",
];
export const roles = [
  "Owner",
  "Admin",
  "Developer",
  "Finance Viewer",
  "Read Only",
];
export const options = (items: string[]) =>
  items.map((value) => ({ label: value, value }));
export const reviewFields: ReviewField[] = [
  { name: "reason", label: "Reason" },
  { name: "password", label: "Current password", type: "password" },
];
