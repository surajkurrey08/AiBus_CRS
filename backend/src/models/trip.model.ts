import {
  inventorySeat,
  mapping,
  model,
  objectId,
  tenantFields,
} from "./shared/schema.js";

export const Trip = model(
  "Trip",
  {
    ...tenantFields,
    routeId: { type: objectId, required: true },
    busId: { type: objectId, required: true },
    scheduleId: objectId,
    serviceId: objectId,
    serviceName: String,
    serviceCode: String,
    operationStage: String,
    actualDepartureAt: Date,
    actualArrivalAt: Date,
    startOdometerKm: Number,
    endOdometerKm: Number,
    fuelConsumedMillilitres: Number,
    crewIds: [objectId],
    journeyDate: { type: String, required: true },
    departureAt: { type: Date, required: true },
    arrivalAt: Date,
    seatSideFares: {
      type: { doublePaise: Number, singlePaise: Number },
      default: undefined,
    },
    bookingOpen: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["Scheduled", "Departed", "Completed", "Cancelled"],
      default: "Scheduled",
    },
    inventoryOwner: {
      type: String,
      enum: ["internal", "external"],
      default: "internal",
    },
    seats: [inventorySeat],
    ...mapping,
  },
  [
    { keys: { operatorId: 1, journeyDate: 1 } },
    { keys: { busId: 1, departureAt: 1 }, options: { unique: true } },
    {
      keys: { operatorId: 1, serviceId: 1, journeyDate: 1 },
      options: {
        unique: true,
        partialFilterExpression: { serviceId: { $type: "objectId" } },
      },
    },
  ],
);
