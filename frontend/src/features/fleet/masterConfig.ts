export type MasterField = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  optional?: boolean;
};
export const vehicleTypes = [
  "AC Sleeper",
  "Non-AC Sleeper",
  "AC Seater",
  "Non-AC Seater",
  "Semi Sleeper",
  "Mixed Seater/Sleeper",
];
const active: MasterField = {
  key: "status",
  label: "Status",
  options: ["Active", "Inactive"],
};
export const masterTabs = [
  { id: "vehicles", label: "Vehicles" },
  { id: "charts", label: "Seat charts" },
  { id: "coaches", label: "Coach types" },
  { id: "crew", label: "Crew" },
  { id: "owners", label: "Owners" },
  { id: "documents", label: "Documents & service" },
  { id: "gps", label: "GPS devices" },
  { id: "trip-crew", label: "Trip crew" },
];
export const masterFields: Record<string, MasterField[]> = {
  charts: [
    { key: "name", label: "Chart name" },
    { key: "capacity", label: "Seat capacity", type: "number" },
    {
      key: "layoutType",
      label: "Layout type",
      options: ["sleeper", "seater", "mixed"],
    },
    { key: "decks", label: "Decks", options: ["1", "2"] },
    active,
  ],
  coaches: [
    { key: "name", label: "Coach name" },
    { key: "type", label: "Bus type", options: vehicleTypes },
    {
      key: "arrangement",
      label: "Seating arrangement",
      options: ["2+1", "2+2"],
    },
    { key: "decks", label: "Decks", options: ["1", "2"] },
    { key: "amenities", label: "Amenities (comma-separated)", optional: true },
    active,
  ],
  crew: [
    { key: "name", label: "Full name" },
    {
      key: "role",
      label: "Crew role",
      options: ["Driver", "Conductor", "Pickup staff"],
    },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "licenceNumber", label: "Driver licence number", optional: true },
    {
      key: "licenceExpiry",
      label: "Driver licence expiry",
      type: "date",
      optional: true,
    },
    { key: "pickupPoint", label: "Pickup point", optional: true },
    active,
  ],
  owners: [
    { key: "name", label: "Owner / proprietor name" },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "email", label: "Email", type: "email", optional: true },
    { key: "address", label: "Address", optional: true },
    active,
  ],
  documents: [
    { key: "busId", label: "Bus" },
    {
      key: "kind",
      label: "Record type",
      options: [
        "Registration",
        "Insurance",
        "Permit",
        "Fitness",
        "PUC",
        "Service",
      ],
    },
    { key: "reference", label: "Document / service reference" },
    {
      key: "issuedOn",
      label: "Issue / service date",
      type: "date",
      optional: true,
    },
    {
      key: "expiresOn",
      label: "Expiry / next service date",
      type: "date",
      optional: true,
    },
    { key: "notes", label: "Notes", optional: true },
  ],
  gps: [
    { key: "busId", label: "Bus" },
    { key: "provider", label: "GPS provider" },
    { key: "deviceId", label: "Device ID / IMEI" },
    active,
  ],
};
export const masterColumns: Record<string, [string, string][]> = {
  charts: [
    ["name", "Chart"],
    ["capacity", "Seats"],
    ["status", "Status"],
  ],
  coaches: [
    ["name", "Coach"],
    ["type", "Type"],
    ["arrangement", "Arrangement"],
    ["decks", "Decks"],
    ["status", "Status"],
  ],
  crew: [
    ["name", "Name"],
    ["role", "Role"],
    ["phone", "Phone"],
    ["licenceExpiry", "Licence expiry"],
    ["status", "Status"],
  ],
  owners: [
    ["name", "Owner"],
    ["phone", "Phone"],
    ["email", "Email"],
    ["status", "Status"],
  ],
  documents: [
    ["registration", "Bus"],
    ["type", "Record type"],
    ["name", "Reference"],
    ["expiresOn", "Expiry / service due"],
  ],
  gps: [
    ["registration", "Bus"],
    ["name", "Provider"],
    ["deviceId", "Device ID"],
    ["telemetry", "Live status"],
    ["status", "Configuration"],
  ],
};
