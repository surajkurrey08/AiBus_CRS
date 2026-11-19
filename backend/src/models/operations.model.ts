import { model, objectId, tenantFields } from "./shared/schema.js";

export const OperationalJob = model(
  "OperationalJob",
  {
    key: { type: String, required: true, unique: true },
    token: String,
    state: {
      type: String,
      enum: ["Idle", "Running", "Backoff", "Manual review"],
      default: "Idle",
    },
    leaseUntil: Date,
    heartbeatAt: Date,
    nextRunAt: { type: Date, default: () => new Date(0) },
    failures: { type: Number, default: 0 },
    lastStartedAt: Date,
    lastSucceededAt: Date,
    lastFailedAt: Date,
    lastCode: String,
  },
  [{ keys: { state: 1, nextRunAt: 1, leaseUntil: 1 } }],
);
export const OperationalJobRun = model(
  "OperationalJobRun",
  {
    jobKey: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["Running", "Succeeded", "Failed", "Lease lost"],
      required: true,
    },
    startedAt: Date,
    finishedAt: Date,
    code: String,
  },
  [{ keys: { jobKey: 1, startedAt: -1 } }],
);
export const OperationalIssue = model(
  "OperationalIssue",
  {
    ...tenantFields,
    key: { type: String, required: true },
    code: { type: String, required: true },
    resourceId: { type: String, required: true },
    tripId: objectId,
    category: {
      type: String,
      enum: ["Inventory", "Recovery", "Finance"],
      required: true,
    },
    status: { type: String, enum: ["Open", "Resolved"], default: "Open" },
    firstSeenAt: Date,
    lastSeenAt: Date,
    resolvedAt: Date,
  },
  [
    { keys: { operatorId: 1, key: 1 }, options: { unique: true } },
    { keys: { operatorId: 1, status: 1, category: 1, lastSeenAt: -1 } },
  ],
);
export const TripIncident = model(
  "TripIncident",
  {
    ...tenantFields,
    tripId: { type: objectId, required: true },
    kind: {
      type: String,
      enum: ["Delay", "Breakdown", "Safety", "Other"],
      required: true,
    },
    reason: { type: String, required: true },
    at: { type: Date, required: true },
    actorId: { type: objectId, required: true },
    requestKey: { type: String, required: true },
    requestHash: { type: String, required: true },
  },
  [
    { keys: { operatorId: 1, requestKey: 1 }, options: { unique: true } },
    { keys: { operatorId: 1, tripId: 1, at: -1 } },
  ],
);
