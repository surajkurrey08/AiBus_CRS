import { z } from "zod";

export const carRegistrationRegex = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;

export const carInputSchema = z
  .object({
    registration: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase().replace(/[\s-]/g, ""))
      .refine((v) => carRegistrationRegex.test(v), "Invalid Indian car registration format"),
    make: z.string().trim().min(2).max(50),
    modelName: z.string().trim().min(2).max(50),
    category: z.enum([
      "4-Passenger Sedan",
      "4-Passenger Hatchback",
      "6-Passenger SUV",
      "7-Passenger MUV",
    ]),
    advertisedCapacity: z.number().int().min(4).max(10),
    totalPhysicalSeats: z.number().int().min(5).max(9),
    driverSeatsCount: z.literal(1).default(1),
    bookablePassengerCapacity: z.number().int().refine(
      (v) => [4, 6, 7].includes(v),
      "Supported bookable passenger capacities are 4, 6, or 7"
    ),
    driveOrientation: z.enum(["RHD", "LHD"]).default("RHD"),
    assignedDriver: z
      .object({
        name: z.string().trim().min(2).max(100),
        phone: z.string().trim().regex(/^\+?[\d\s-]{10,16}$/),
        licenseNumber: z.string().trim().min(5).max(30),
      })
      .optional(),
  })
  .strict()
  .refine(
    (data) => data.totalPhysicalSeats === data.driverSeatsCount + data.bookablePassengerCapacity,
    {
      message: "Total physical seats must equal driverSeatsCount (1) + bookablePassengerCapacity",
      path: ["totalPhysicalSeats"],
    }
  );

export const carSeatDefinitionSchema = z
  .object({
    seatId: z.string().trim().min(1).max(6),
    label: z.string().trim().min(1).max(50),
    row: z.number().int().min(1).max(4),
    column: z.number().int().min(1).max(4),
    isDriver: z.boolean(),
    isBookable: z.boolean(),
    category: z.enum(["driver", "front_passenger", "window", "middle", "rear_window"]),
    baseFarePaise: z.number().int().min(0),
  })
  .strict();

export const carSeatLayoutInputSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    vehicleCategory: z.enum([
      "4-Passenger Sedan",
      "4-Passenger Hatchback",
      "6-Passenger SUV",
      "7-Passenger MUV",
    ]),
    totalPhysicalSeats: z.number().int().min(5).max(9),
    bookablePassengerCapacity: z.number().int().min(4).max(7),
    driveOrientation: z.enum(["RHD", "LHD"]).default("RHD"),
    seats: z.array(carSeatDefinitionSchema).min(5).max(9),
  })
  .strict()
  .refine(
    (data) => {
      const drivers = data.seats.filter((s) => s.isDriver);
      return drivers.length === 1 && !drivers[0].isBookable;
    },
    { message: "Layout must contain exactly one driver seat, which cannot be bookable" }
  )
  .refine(
    (data) => {
      const bookable = data.seats.filter((s) => s.isBookable && !s.isDriver);
      return bookable.length === data.bookablePassengerCapacity;
    },
    { message: "Count of bookable seats must exactly match bookablePassengerCapacity" }
  );
