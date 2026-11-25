import mongoose from "mongoose";
import { Car } from "../models/car.model.js";
import { CarSeatLayout } from "../models/car-seat-layout.model.js";
import { CarTrip } from "../models/car-trip.model.js";
import { fail } from "../utils/response.js";
import { carInputSchema } from "../validators/car.validators.js";
import { z } from "zod";

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

function assertValidObjectId(id: string, paramName = "id"): void {
  if (!id || !objectIdRegex.test(id)) {
    fail(400, "INVALID_ID", `Invalid ObjectId provided for ${paramName}`);
  }
}

export async function createCar(
  operatorId: string,
  input: z.infer<typeof carInputSchema>,
  layoutId?: string
) {
  assertValidObjectId(operatorId, "operatorId");
  const validated = carInputSchema.parse(input);

  // Normalize registration: uppercase, strip spaces & dashes
  const normalizedRegistration = validated.registration.toUpperCase().replace(/[\s-]/g, "");

  // Check unique registration globally (across all operators)
  const existing = await Car.findOne({ registration: normalizedRegistration }).lean();
  if (existing) {
    fail(409, "DUPLICATE_REGISTRATION", `Vehicle registration '${normalizedRegistration}' is already registered.`);
  }

  // Validate activeLayoutId if provided
  let activeLayoutObjId: mongoose.Types.ObjectId | undefined;
  if (layoutId) {
    assertValidObjectId(layoutId, "layoutId");
    const layout: any = await CarSeatLayout.findOne({
      _id: layoutId,
      operatorId,
      status: "Active",
    }).lean();

    if (!layout) {
      fail(404, "LAYOUT_NOT_FOUND", "Specified layout not found or inactive for this operator");
    }

    if (layout.bookablePassengerCapacity !== validated.bookablePassengerCapacity) {
      fail(
        400,
        "LAYOUT_CAPACITY_MISMATCH",
        `Layout capacity (${layout.bookablePassengerCapacity}) does not match vehicle capacity (${validated.bookablePassengerCapacity})`
      );
    }
    activeLayoutObjId = layout._id as mongoose.Types.ObjectId;
  }

  const car = await Car.create({
    ...validated,
    registration: normalizedRegistration,
    operatorId,
    activeLayoutId: activeLayoutObjId,
    status: "Active",
  });

  return car.toObject();
}

export async function listCars(
  operatorId: string,
  query: {
    status?: string;
    capacity?: number;
    search?: string;
    page?: number;
    limit?: number;
  } = {}
) {
  assertValidObjectId(operatorId, "operatorId");
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = { operatorId };

  if (query.status) {
    filter.status = query.status;
  } else {
    // By default exclude archived cars from standard list
    filter.status = { $ne: "Archived" };
  }

  if (query.capacity) {
    filter.bookablePassengerCapacity = Number(query.capacity);
  }

  if (query.search) {
    const term = query.search.trim().replace(/[\s-]/g, "");
    filter.$or = [
      { registration: { $regex: term, $options: "i" } },
      { make: { $regex: query.search.trim(), $options: "i" } },
      { modelName: { $regex: query.search.trim(), $options: "i" } },
    ];
  }

  const [cars, total] = await Promise.all([
    Car.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("activeLayoutId", "name vehicleCategory version totalPhysicalSeats bookablePassengerCapacity")
      .lean(),
    Car.countDocuments(filter),
  ]);

  return {
    data: cars,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getCarById(operatorId: string, carId: string) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(carId, "carId");

  const car = await Car.findOne({ _id: carId, operatorId })
    .populate("activeLayoutId")
    .lean();

  if (!car) {
    fail(404, "CAR_NOT_FOUND", "Car record not found or belongs to another operator");
  }

  return car;
}

export async function updateCar(
  operatorId: string,
  carId: string,
  input: Partial<z.infer<typeof carInputSchema>> & { activeLayoutId?: string }
) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(carId, "carId");

  const car = await Car.findOne({ _id: carId, operatorId });
  if (!car) {
    fail(404, "CAR_NOT_FOUND", "Car record not found or belongs to another operator");
  }

  // Prevent changing registration or operator
  if (input.registration && input.registration.toUpperCase().replace(/[\s-]/g, "") !== car.registration) {
    fail(400, "IMMUTABLE_FIELD", "Vehicle registration cannot be modified after registration");
  }

  // If changing capacity, ensure no active scheduled trips exist
  if (
    input.bookablePassengerCapacity !== undefined &&
    input.bookablePassengerCapacity !== car.bookablePassengerCapacity
  ) {
    const hasActiveTrips = await CarTrip.exists({
      carId,
      status: { $in: ["Scheduled", "Boarding", "On Road"] },
      departureAt: { $gt: new Date() },
    });
    if (hasActiveTrips) {
      fail(
        409,
        "ACTIVE_TRIPS_EXIST",
        "Cannot change vehicle capacity while active scheduled trips exist for this car"
      );
    }
  }

  // If assigning a new layout, validate it
  if (input.activeLayoutId) {
    assertValidObjectId(input.activeLayoutId, "activeLayoutId");
    const layout: any = await CarSeatLayout.findOne({
      _id: input.activeLayoutId,
      operatorId,
      status: "Active",
    }).lean();

    if (!layout) {
      fail(404, "LAYOUT_NOT_FOUND", "Specified seat layout not found or inactive");
    }

    const targetCapacity = input.bookablePassengerCapacity ?? car.bookablePassengerCapacity;
    if (layout.bookablePassengerCapacity !== targetCapacity) {
      fail(
        400,
        "LAYOUT_CAPACITY_MISMATCH",
        `Layout capacity (${layout.bookablePassengerCapacity}) must match vehicle capacity (${targetCapacity})`
      );
    }
    car.activeLayoutId = layout._id as mongoose.Types.ObjectId;
  }

  if (input.make) car.make = input.make.trim();
  if (input.modelName) car.modelName = input.modelName.trim();
  if (input.category) car.category = input.category;
  if (input.advertisedCapacity !== undefined) car.advertisedCapacity = input.advertisedCapacity;
  if (input.bookablePassengerCapacity !== undefined) {
    car.bookablePassengerCapacity = input.bookablePassengerCapacity;
    car.totalPhysicalSeats = 1 + input.bookablePassengerCapacity;
  }
  if (input.assignedDriver) car.assignedDriver = input.assignedDriver;

  await car.save();
  return car.toObject();
}

export async function updateCarStatus(
  operatorId: string,
  carId: string,
  status: "Active" | "Inactive" | "Under Maintenance" | "Archived"
) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(carId, "carId");

  const car = await Car.findOne({ _id: carId, operatorId });
  if (!car) {
    fail(404, "CAR_NOT_FOUND", "Car record not found or belongs to another operator");
  }

  // If deactivating or archiving, verify no active trips exist
  if (["Inactive", "Archived", "Under Maintenance"].includes(status)) {
    const activeTrip: any = await CarTrip.findOne({
      carId,
      status: { $in: ["Scheduled", "Boarding", "On Road"] },
      departureAt: { $gt: new Date() },
    }).lean();

    if (activeTrip) {
      fail(
        409,
        "CAR_REFERENCED_BY_ACTIVE_TRIPS",
        `Cannot change car status to '${status}' because upcoming scheduled trip (${activeTrip._id}) is active`
      );
    }
  }

  car.status = status;
  await car.save();
  return car.toObject();
}

export async function archiveCar(operatorId: string, carId: string) {
  return updateCarStatus(operatorId, carId, "Archived");
}
