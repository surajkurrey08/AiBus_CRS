import mongoose from "mongoose";
import { CarSeatDefinition, DriveOrientation } from "../models/shared/car-seat.types.js";
import { Car } from "../models/car.model.js";
import { CarSeatLayout } from "../models/car-seat-layout.model.js";
import { CarTrip } from "../models/car-trip.model.js";
import { fail } from "../utils/response.js";
import { carSeatLayoutInputSchema } from "../validators/car.validators.js";
import { z } from "zod";

/**
 * Standard, physically verified 4-passenger-seat layout (Sedan / Hatchback).
 * Total physical seats: 5
 * Driver seats: 1 (Row 1, Col 2 in RHD - NON-BOOKABLE)
 * Passenger seats: 4 (FP + 2L + 2M + 2R - BOOKABLE)
 */
export function getStandard4PassengerLayout(
  driveOrientation: DriveOrientation = "RHD",
  baseFarePaise = 50000
): CarSeatDefinition[] {
  const driverCol = driveOrientation === "RHD" ? 2 : 1;
  const passengerCol = driveOrientation === "RHD" ? 1 : 2;

  return [
    {
      seatId: "D",
      label: "Driver",
      row: 1,
      column: driverCol,
      isDriver: true,
      isBookable: false,
      category: "driver",
      baseFarePaise: 0,
    },
    {
      seatId: "FP",
      label: "Front Passenger",
      row: 1,
      column: passengerCol,
      isDriver: false,
      isBookable: true,
      category: "front_passenger",
      baseFarePaise,
    },
    {
      seatId: "2L",
      label: "Rear Window Left",
      row: 2,
      column: 1,
      isDriver: false,
      isBookable: true,
      category: "window",
      baseFarePaise,
    },
    {
      seatId: "2M",
      label: "Rear Middle",
      row: 2,
      column: 2,
      isDriver: false,
      isBookable: true,
      category: "middle",
      baseFarePaise: Math.round(baseFarePaise * 0.9), // slight discount for middle seat
    },
    {
      seatId: "2R",
      label: "Rear Window Right",
      row: 2,
      column: 3,
      isDriver: false,
      isBookable: true,
      category: "window",
      baseFarePaise,
    },
  ];
}

/**
 * Standard, physically verified 7-passenger-seat layout (8-seater MUV/SUV).
 * Total physical seats: 8
 * Driver seats: 1 (Row 1, Col 3 in RHD - NON-BOOKABLE)
 * Passenger seats: 7 (1 Front + 3 Middle + 3 Rear - ALL BOOKABLE)
 */
export function getStandard7PassengerLayout(
  driveOrientation: DriveOrientation = "RHD",
  baseFarePaise = 75000
): CarSeatDefinition[] {
  const driverCol = driveOrientation === "RHD" ? 3 : 1;
  const passengerCol = driveOrientation === "RHD" ? 1 : 3;

  return [
    // Row 1: Front
    {
      seatId: "D",
      label: "Driver",
      row: 1,
      column: driverCol,
      isDriver: true,
      isBookable: false,
      category: "driver",
      baseFarePaise: 0,
    },
    {
      seatId: "FP",
      label: "Front Passenger",
      row: 1,
      column: passengerCol,
      isDriver: false,
      isBookable: true,
      category: "front_passenger",
      baseFarePaise: Math.round(baseFarePaise * 1.1), // premium for front seat
    },
    // Row 2: Middle Bench (3 seats)
    {
      seatId: "2L",
      label: "Middle Window Left",
      row: 2,
      column: 1,
      isDriver: false,
      isBookable: true,
      category: "window",
      baseFarePaise,
    },
    {
      seatId: "2M",
      label: "Middle Center",
      row: 2,
      column: 2,
      isDriver: false,
      isBookable: true,
      category: "middle",
      baseFarePaise: Math.round(baseFarePaise * 0.85),
    },
    {
      seatId: "2R",
      label: "Middle Window Right",
      row: 2,
      column: 3,
      isDriver: false,
      isBookable: true,
      category: "window",
      baseFarePaise,
    },
    // Row 3: Rear Bench (3 seats)
    {
      seatId: "3L",
      label: "Rear Window Left",
      row: 3,
      column: 1,
      isDriver: false,
      isBookable: true,
      category: "rear_window",
      baseFarePaise: Math.round(baseFarePaise * 0.95),
    },
    {
      seatId: "3M",
      label: "Rear Center",
      row: 3,
      column: 2,
      isDriver: false,
      isBookable: true,
      category: "middle",
      baseFarePaise: Math.round(baseFarePaise * 0.8),
    },
    {
      seatId: "3R",
      label: "Rear Window Right",
      row: 3,
      column: 3,
      isDriver: false,
      isBookable: true,
      category: "rear_window",
      baseFarePaise: Math.round(baseFarePaise * 0.95),
    },
  ];
}

/**
 * Standard 6-passenger layout (7 physical seats = 1 driver + 6 passenger seats).
 * Maintained as an internal utility; customer-facing standard products remain 4 and 7.
 */
export function getStandard6PassengerLayout(
  driveOrientation: DriveOrientation = "RHD",
  baseFarePaise = 70000
): CarSeatDefinition[] {
  const driverCol = driveOrientation === "RHD" ? 3 : 1;
  const passengerCol = driveOrientation === "RHD" ? 1 : 3;

  return [
    {
      seatId: "D",
      label: "Driver",
      row: 1,
      column: driverCol,
      isDriver: true,
      isBookable: false,
      category: "driver",
      baseFarePaise: 0,
    },
    {
      seatId: "FP",
      label: "Front Passenger",
      row: 1,
      column: passengerCol,
      isDriver: false,
      isBookable: true,
      category: "front_passenger",
      baseFarePaise: Math.round(baseFarePaise * 1.1),
    },
    {
      seatId: "2L",
      label: "Captain Seat Left",
      row: 2,
      column: 1,
      isDriver: false,
      isBookable: true,
      category: "window",
      baseFarePaise: Math.round(baseFarePaise * 1.15),
    },
    {
      seatId: "2R",
      label: "Captain Seat Right",
      row: 2,
      column: 3,
      isDriver: false,
      isBookable: true,
      category: "window",
      baseFarePaise: Math.round(baseFarePaise * 1.15),
    },
    {
      seatId: "3L",
      label: "Rear Left",
      row: 3,
      column: 1,
      isDriver: false,
      isBookable: true,
      category: "rear_window",
      baseFarePaise: Math.round(baseFarePaise * 0.9),
    },
    {
      seatId: "3M",
      label: "Rear Middle",
      row: 3,
      column: 2,
      isDriver: false,
      isBookable: true,
      category: "middle",
      baseFarePaise: Math.round(baseFarePaise * 0.8),
    },
    {
      seatId: "3R",
      label: "Rear Right",
      row: 3,
      column: 3,
      isDriver: false,
      isBookable: true,
      category: "rear_window",
      baseFarePaise: Math.round(baseFarePaise * 0.9),
    },
  ];
}

/**
 * Validates any custom physical layout against strict Car CRS rules.
 */
export function validatePhysicalCarLayout(seats: CarSeatDefinition[], expectedPassengerCapacity: number) {
  const driverSeats = seats.filter((s) => s.isDriver);
  if (driverSeats.length !== 1) {
    fail(400, "INVALID_LAYOUT", `Physically invalid layout: Car must have exactly 1 driver seat, found ${driverSeats.length}`);
  }
  if (driverSeats[0].isBookable) {
    fail(400, "INVALID_LAYOUT", "Security violation: Driver seat must NEVER be marked as bookable");
  }

  const bookableSeats = seats.filter((s) => s.isBookable && !s.isDriver);
  if (bookableSeats.length !== expectedPassengerCapacity) {
    fail(
      400,
      "INVALID_LAYOUT",
      `Capacity mismatch: Layout defines ${bookableSeats.length} bookable seats, but vehicle capacity requires ${expectedPassengerCapacity}`
    );
  }

  // Unique seat IDs
  const seatIds = seats.map((s) => s.seatId);
  if (new Set(seatIds).size !== seatIds.length) {
    fail(400, "INVALID_LAYOUT", "Duplicate seat IDs found in physical layout");
  }

  // Unique coordinates
  const coords = seats.map((s) => `${s.row}:${s.column}`);
  if (new Set(coords).size !== coords.length) {
    fail(400, "INVALID_LAYOUT", "Overlapping physical seat coordinates in layout");
  }

  return true;
}

/**
 * Exposes the standard customer-facing templates (4-Passenger Sedan and 7-Passenger MUV).
 */
export function getCarLayoutTemplates() {
  return [
    {
      templateId: "tpl-4-passenger-sedan",
      name: "Standard 4-Passenger Sedan (5 Physical Seats)",
      vehicleCategory: "4-Passenger Sedan",
      totalPhysicalSeats: 5,
      bookablePassengerCapacity: 4,
      driveOrientation: "RHD",
      seats: getStandard4PassengerLayout("RHD"),
    },
    {
      templateId: "tpl-7-passenger-muv",
      name: "Standard 7-Passenger MUV (8 Physical Seats)",
      vehicleCategory: "7-Passenger MUV",
      totalPhysicalSeats: 8,
      bookablePassengerCapacity: 7,
      driveOrientation: "RHD",
      seats: getStandard7PassengerLayout("RHD"),
    },
  ];
}

/**
 * Assigns or updates a car's physical seat layout with versioning protection.
 * If the current layout is already used by a published/scheduled trip,
 * this function preserves the historical layout snapshot and creates a new layout version.
 */
export async function assignOrUpdateCarLayoutWithVersioning(
  operatorId: string,
  carId: string,
  layoutInput: any
) {
  const car = await Car.findOne({ _id: carId, operatorId });
  if (!car) {
    fail(404, "CAR_NOT_FOUND", "Car record not found or belongs to another operator");
  }

  // Allow optional vehicleCategory, totalPhysicalSeats, bookablePassengerCapacity, defaulting to car values
  const inputWithDefaults = {
    name: layoutInput.name || `${car.registration} Layout`,
    vehicleCategory: layoutInput.vehicleCategory || car.category,
    totalPhysicalSeats: layoutInput.totalPhysicalSeats || car.totalPhysicalSeats,
    bookablePassengerCapacity: layoutInput.bookablePassengerCapacity || car.bookablePassengerCapacity,
    driveOrientation: layoutInput.driveOrientation || car.driveOrientation,
    seats: layoutInput.seats,
  };

  const validated = carSeatLayoutInputSchema.parse(inputWithDefaults);
  validatePhysicalCarLayout(validated.seats, car.bookablePassengerCapacity);

  if (car.bookablePassengerCapacity !== validated.bookablePassengerCapacity) {
    fail(
      400,
      "CAPACITY_MISMATCH",
      `Layout capacity (${validated.bookablePassengerCapacity}) must match car capacity (${car.bookablePassengerCapacity})`
    );
  }

  // Check if current active layout is referenced by any published or scheduled trip
  let needsNewVersion = false;
  let nextVersion = 1;

  if (car.activeLayoutId) {
    const tripReferencingLayout = await CarTrip.exists({
      carId,
      status: { $in: ["Scheduled", "Boarding", "On Road", "Completed"] },
    });

    if (tripReferencingLayout) {
      needsNewVersion = true;
      const currentLayout = await CarSeatLayout.findById(car.activeLayoutId).lean();
      nextVersion = ((currentLayout as any)?.version || 1) + 1;
    }
  }

  let finalLayout: any;

  if (needsNewVersion || !car.activeLayoutId) {
    // Create new versioned layout
    finalLayout = await CarSeatLayout.create({
      operatorId,
      carId,
      name: validated.name || `${car.registration} Layout v${nextVersion}`,
      vehicleCategory: car.category,
      totalPhysicalSeats: car.totalPhysicalSeats,
      bookablePassengerCapacity: car.bookablePassengerCapacity,
      driveOrientation: validated.driveOrientation || car.driveOrientation,
      version: nextVersion,
      seats: validated.seats,
      status: "Active",
    });

    car.activeLayoutId = finalLayout._id as mongoose.Types.ObjectId;
    await car.save();
  } else {
    // Safe to update existing unreferenced layout in place
    finalLayout = await CarSeatLayout.findOneAndUpdate(
      { _id: car.activeLayoutId, operatorId },
      {
        $set: {
          name: validated.name,
          seats: validated.seats,
          driveOrientation: validated.driveOrientation || car.driveOrientation,
        },
      },
      { new: true }
    );
  }

  return finalLayout.toObject();
}

/**
 * Retrieves the active layout for a car.
 */
export async function getCarActiveLayout(operatorId: string, carId: string) {
  const car: any = await Car.findOne({ _id: carId, operatorId }).lean();
  if (!car) {
    fail(404, "CAR_NOT_FOUND", "Car record not found or belongs to another operator");
  }

  if (!car.activeLayoutId) {
    fail(404, "LAYOUT_NOT_ASSIGNED", "Car does not have an active seat layout assigned");
  }

  const layout = await CarSeatLayout.findOne({ _id: car.activeLayoutId, operatorId }).lean();
  if (!layout) {
    fail(404, "LAYOUT_NOT_FOUND", "Assigned layout record not found");
  }

  return layout;
}
