export type Field = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  lookup?: string;
  optional?: boolean;
  money?: boolean;
};
export const configs: Record<
  string,
  { title: string; permission: string; fields: Field[] }
> = {
  services: {
    title: "Services",
    permission: "routes:write",
    fields: [
      { key: "name", label: "Service name" },
      { key: "code", label: "Service code" },
      { key: "routeId", label: "Route", lookup: "routes" },
      { key: "busId", label: "Default bus", lookup: "buses" },
      { key: "departure", label: "Departure · IST", type: "time" },
      {
        key: "doublePaise",
        label: "Double-side fare per passenger · INR",
        money: true,
      },
      {
        key: "singlePaise",
        label: "Single-side fare per passenger · INR",
        money: true,
      },
      { key: "status", label: "Status", options: ["Active", "Inactive"] },
    ],
  },
  tablets: {
    title: "Tablets",
    permission: "fleet:write",
    fields: [
      { key: "name", label: "Tablet name" },
      { key: "serialNumber", label: "Serial number" },
      { key: "status", label: "Status", options: ["Active", "Inactive"] },
    ],
  },
  partners: {
    title: "Agents & branches",
    permission: "pricing:write",
    fields: [
      { key: "name", label: "Name" },
      { key: "kind", label: "Partner type", options: ["Agent", "Branch"] },
      { key: "phone", label: "Phone", type: "tel" },
      { key: "email", label: "Email", type: "email", optional: true },
      { key: "status", label: "Status", options: ["Active", "Inactive"] },
    ],
  },
  commissions: {
    title: "Commission rules",
    permission: "pricing:write",
    fields: [
      { key: "partnerId", label: "Agent / branch", lookup: "partners" },
      { key: "scope", label: "Apply to", options: ["Service", "Trip"] },
      { key: "serviceId", label: "Service", lookup: "services" },
      { key: "tripId", label: "Trip", lookup: "trips" },
      {
        key: "basis",
        label: "Calculation basis",
        options: ["Base fare", "Grand total"],
      },
      { key: "kind", label: "Commission type", options: ["Percent", "Fixed"] },
      { key: "basisPoints", label: "Commission percentage", money: true },
      {
        key: "fixedPaise",
        label: "Fixed commission per booking · INR",
        money: true,
      },
      { key: "status", label: "Status", options: ["Active", "Inactive"] },
    ],
  },
  links: {
    title: "Linked trips",
    permission: "routes:write",
    fields: [
      { key: "fromTripId", label: "From trip", lookup: "trips" },
      { key: "toTripId", label: "To trip", lookup: "trips" },
      { key: "kind", label: "Link type", options: ["Related", "Connection"] },
      {
        key: "transferMinutes",
        label: "Minimum transfer · minutes",
        type: "number",
      },
      { key: "notes", label: "Notes", optional: true },
      { key: "status", label: "Status", options: ["Active", "Inactive"] },
    ],
  },
  fuel: {
    title: "Fuel expenses",
    permission: "fleet:write",
    fields: [
      { key: "tripId", label: "Trip", lookup: "trips" },
      {
        key: "litresMillilitres",
        label: "Fuel purchased · litres",
        money: true,
      },
      { key: "amountPaise", label: "Expense · INR", money: true },
      { key: "at", label: "Purchased at · IST", type: "datetime-local" },
      {
        key: "odometerKm",
        label: "Odometer · km",
        type: "number",
        optional: true,
      },
      { key: "pump", label: "Fuel station", optional: true },
      { key: "receipt", label: "Receipt reference", optional: true },
    ],
  },
  stops: {
    title: "Stop records",
    permission: "routes:write",
    fields: [
      { key: "tripId", label: "Trip", lookup: "trips" },
      {
        key: "kind",
        label: "Stop type",
        options: ["Pickup", "Drop", "POI", "Other"],
      },
      {
        key: "locationId",
        label: "Pickup / drop location",
        lookup: "locations",
      },
      { key: "poiId", label: "Landmark", lookup: "pois" },
      { key: "name", label: "Stop name" },
      {
        key: "arrivedAt",
        label: "Actual arrival · IST",
        type: "datetime-local",
      },
      {
        key: "departedAt",
        label: "Actual departure · IST",
        type: "datetime-local",
      },
      { key: "notes", label: "Notes", optional: true },
    ],
  },
};
export const tabs = [
  "routes",
  "trips",
  "services",
  "scheduling",
  "availability",
  "operations",
  "fuel",
  "stops",
  "reports",
  "tablets",
  "links",
  "partners",
  "commissions",
];
export const titles: Record<string, string> = {
  routes: "Routes",
  trips: "Scheduled trips",
  scheduling: "Multi-trip scheduling",
  availability: "Service availability",
  operations: "Trip tracker",
  reports: "Operational reports",
};
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const localNow = () =>
  new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16);
export const asIso = (value: string) =>
  new Date(value + ":00+05:30").toISOString();
export function optionLabel(
  resource: string,
  row: any,
  lookup: Record<string, any[]>,
) {
  if (resource === "routes") return `${row.source} → ${row.destination}`;
  if (resource === "buses") return `${row.registration} · ${row.name}`;
  if (resource === "trips") {
    const route = lookup.routes?.find((r) => r._id === row.routeId);
    return `${row.journeyDate} · ${route ? `${route.source} → ${route.destination}` : row.routeId} · ${new Date(row.departureAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}`;
  }
  return `${row.name}${row.code ? ` · ${row.code}` : row.kind ? ` · ${row.kind}` : ""}`;
}
