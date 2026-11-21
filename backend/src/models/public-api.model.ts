import { applicationStates } from "../types/partner-portal.js";
import mongoose from "mongoose";
import { model as baseModel, objectId } from "./shared/schema.js";
const model = (...args: Parameters<typeof baseModel>) =>
  baseModel(...args) as unknown as mongoose.Model<{
    _id: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
    [field: string]: any;
  }>;
const sandbox = {
  type: String,
  enum: ["sandbox"],
  default: "sandbox",
  immutable: true,
};
export const ApiPartner = model("ApiPartner", {
  publicId: { type: String, required: true, unique: true },
  // Set only by the authenticated control plane in the isolated sandbox.
  portalSourcePublicId: { type: String, immutable: true },
  name: { type: String, required: true },
  onboardingStatus: {
    type: String,
    enum: applicationStates,
    default: "Approved",
  },
  contactPerson: String,
  businessEmail: String,
  phone: String,
  address: String,
  registrationDetails: String,
  technicalEmail: String,
  intendedUsage: String,
  requestedEnvironment: {
    type: String,
    enum: ["Sandbox", "Production"],
    default: "Sandbox",
  },
  portalActivatedAt: Date,
  submissionTokenHash: { type: String, select: false },
  submissionExpiresAt: Date,
  reviewedBy: objectId,
  reviewReason: String,
  reviewedAt: Date,
  requestsPerMinute: { type: Number, min: 1, max: 120, default: 120 },
  environment: sandbox,
  status: { type: String, enum: ["Active", "Suspended"], default: "Active" },
  scopes: [String],
  sandboxAllowancePaise: {
    type: Number,
    default: 0,
    min: 0,
    validate: Number.isSafeInteger,
  },
  revision: { type: Number, default: 0 },
  bookingCutoffMinutes: {
    type: Number,
    min: 0,
    max: 1440,
    default: 0,
    validate: Number.isInteger,
  },
});
ApiPartner.schema.index({ onboardingStatus: 1, createdAt: -1 });
export const ApiCredential = model("ApiCredential", {
  publicId: { type: String, required: true, unique: true },
  partnerId: { type: objectId, required: true, immutable: true, index: true },
  environment: sandbox,
  secretHash: { type: String, required: true, select: false },
  label: String,
  lastUsedAt: Date,
  createdBy: objectId,
  portalManaged: { type: Boolean, default: false },
  scopes: [String],
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
  version: { type: Number, default: 1 },
});
ApiCredential.schema.index({ partnerId: 1, portalManaged: 1, createdAt: -1 });
export const PartnerInventoryGrant = model(
  "PartnerInventoryGrant",
  {
    partnerId: { type: objectId, required: true, immutable: true },
    operatorId: { type: objectId, required: true, immutable: true },
    kind: {
      type: String,
      enum: ["Operator", "Route", "Service", "Trip"],
      required: true,
    },
    targetId: { type: objectId, required: true, immutable: true },
    active: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true },
  },
  [
    {
      keys: { partnerId: 1, operatorId: 1, kind: 1, targetId: 1 },
      options: { unique: true },
    },
  ],
);
export const PublicResource = model(
  "PublicResource",
  {
    publicId: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    internalKey: { type: String, required: true },
  },
  [{ keys: { kind: 1, internalKey: 1 }, options: { unique: true } }],
);
export const PartnerCommand = model(
  "PartnerCommand",
  {
    partnerId: { type: objectId, required: true, immutable: true },
    key: { type: String, required: true },
    action: { type: String, required: true },
    requestHash: { type: String, required: true },
    resourceId: { type: String, required: true },
  },
  [{ keys: { partnerId: 1, key: 1 }, options: { unique: true } }],
);
export const PartnerBookingReference = model(
  "PartnerBookingReference",
  {
    partnerId: { type: objectId, required: true, immutable: true },
    publicId: { type: String, required: true, unique: true },
    reference: { type: String, required: true },
    operatorId: { type: objectId, required: true, immutable: true },
    bookingId: objectId,
    funded: { type: Boolean, default: false },
  },
  [
    { keys: { partnerId: 1, reference: 1 }, options: { unique: true } },
    {
      keys: { bookingId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { bookingId: { $type: "objectId" } },
      },
    },
  ],
);
export const PartnerApiUsage = model(
  "PartnerApiUsage",
  {
    partnerId: objectId,
    credentialId: objectId,
    requestId: String,
    operation: String,
    status: Number,
    durationMs: Number,
  },
  [{ keys: { partnerId: 1, createdAt: -1 } }],
);
export const PartnerWebhookSubscription = model(
  "PartnerWebhookSubscription",
  {
    partnerId: { type: objectId, required: true, immutable: true },
    publicId: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    active: { type: Boolean, default: true },
    signingVersion: { type: Number, default: 1 },
  },
  [{ keys: { partnerId: 1, url: 1 }, options: { unique: true } }],
);
PartnerWebhookSubscription.schema.index({ partnerId: 1, createdAt: -1 });
export const PartnerWebhookEvent = model(
  "PartnerWebhookEvent",
  {
    partnerId: { type: objectId, required: true, immutable: true },
    publicId: { type: String, required: true, unique: true },
    key: { type: String, required: true },
    type: {
      type: String,
      enum: ["booking.status", "integration.test"],
      default: "booking.status",
    },
    booking: String,
    status: String,
    paymentStatus: String,
    cancellationStatus: String,
  },
  [{ keys: { partnerId: 1, key: 1 }, options: { unique: true } }],
);
export const PartnerWebhookDelivery = model(
  "PartnerWebhookDelivery",
  {
    partnerId: { type: objectId, required: true, immutable: true },
    subscriptionId: { type: objectId, required: true },
    eventId: { type: objectId, required: true },
    status: {
      type: String,
      enum: ["Pending", "Delivering", "Delivered", "Manual review"],
      default: "Pending",
    },
    attempts: { type: Number, default: 0 },
    retryLimit: { type: Number, min: 5, max: 10, default: 5 },
    leaseUntil: Date,
    leaseToken: String,
    nextAttemptAt: { type: Date, default: () => new Date(0) },
    lastCode: String,
  },
  [
    { keys: { subscriptionId: 1, eventId: 1 }, options: { unique: true } },
    { keys: { status: 1, nextAttemptAt: 1, leaseUntil: 1 } },
  ],
);
export const PartnerWebhookAttempt = model(
  "PartnerWebhookAttempt",
  {
    deliveryId: { type: objectId, required: true },
    attempt: Number,
    code: String,
    succeeded: Boolean,
  },
  [{ keys: { deliveryId: 1, attempt: 1 }, options: { unique: true } }],
);

PartnerWebhookDelivery.schema.index({ partnerId: 1, status: 1, createdAt: -1 });
