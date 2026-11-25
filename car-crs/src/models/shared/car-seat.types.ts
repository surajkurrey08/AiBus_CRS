export type DriveOrientation = "RHD" | "LHD";

export type SeatCategory = "driver" | "front_passenger" | "window" | "middle" | "rear_window";

export type SeatState = "available" | "held" | "booked" | "blocked";

export interface CarSeatDefinition {
  seatId: string;
  label: string;
  row: number;
  column: number;
  isDriver: boolean;
  isBookable: boolean;
  category: SeatCategory;
  baseFarePaise: number;
}

export interface CarInventorySeat extends CarSeatDefinition {
  state: SeatState;
  holdId?: string;
  holdUserId?: string;
  holdUntil?: Date;
  bookingId?: string;
  passengerName?: string;
}

export interface VehicleCapacitySpec {
  advertisedCapacity: number;       // e.g. 5, 7, 8 (marketing label)
  totalPhysicalSeats: number;       // e.g. 5, 7, 8 (actual installed physical seats)
  driverSeatsCount: number;         // strictly 1
  bookablePassengerCapacity: number;// e.g. 4, 6, 7 (strictly totalPhysicalSeats - driverSeatsCount)
}
