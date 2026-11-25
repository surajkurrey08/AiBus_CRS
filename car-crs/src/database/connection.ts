import mongoose from "mongoose";
import { validateCarCrsConfig } from "../config/env.js";

let carCrsConnected = false;

export async function connectCarCrsDatabase(uri?: string) {
  const targetUri = uri || process.env.CAR_CRS_MONGODB_URI;
  if (!targetUri) {
    throw new Error("CAR_CRS_MONGODB_URI is not set. Car CRS requires an isolated MongoDB connection.");
  }

  // Enforce isolation validation
  validateCarCrsConfig({
    CAR_CRS_MONGODB_URI: targetUri,
    BUS_CRS_MONGODB_URI: process.env.MONGODB_URI,
    NODE_ENV: (process.env.NODE_ENV as any) || "development",
  });

  if (mongoose.connection.readyState === 1 && mongoose.connection.name === "aibus_car_crs") {
    carCrsConnected = true;
    return mongoose.connection;
  }

  await mongoose.connect(targetUri);
  carCrsConnected = true;
  return mongoose.connection;
}

export async function disconnectCarCrsDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    carCrsConnected = false;
  }
}

export function isCarCrsConnected() {
  return carCrsConnected;
}
