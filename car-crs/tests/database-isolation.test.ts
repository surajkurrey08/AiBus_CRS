import { describe, it, expect } from "vitest";
import { validateCarCrsConfig } from "../src/config/env.js";

describe("Car CRS Database Isolation Guards", () => {
  it("rejects configuration that points to the primary Bus CRS database ('aibus')", () => {
    expect(() =>
      validateCarCrsConfig({
        CAR_CRS_MONGODB_URI: "mongodb://127.0.0.1:27017/aibus",
      })
    ).toThrow(/FATAL_DATABASE_ISOLATION_VIOLATION/);

    expect(() =>
      validateCarCrsConfig({
        CAR_CRS_MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net/aibus?retryWrites=true",
      })
    ).toThrow(/FATAL_DATABASE_ISOLATION_VIOLATION/);
  });

  it("rejects configuration when CAR_CRS_MONGODB_URI is identical to BUS_CRS_MONGODB_URI", () => {
    expect(() =>
      validateCarCrsConfig({
        CAR_CRS_MONGODB_URI: "mongodb://127.0.0.1:27017/custom_db",
        BUS_CRS_MONGODB_URI: "mongodb://127.0.0.1:27017/custom_db",
      })
    ).toThrow(/FATAL_DATABASE_ISOLATION_VIOLATION/);
  });

  it("accepts dedicated isolated database name 'aibus_car_crs'", () => {
    const config = validateCarCrsConfig({
      CAR_CRS_MONGODB_URI: "mongodb://127.0.0.1:27017/aibus_car_crs",
      BUS_CRS_MONGODB_URI: "mongodb://127.0.0.1:27017/aibus",
      NODE_ENV: "test",
    });

    expect(config.CAR_CRS_MONGODB_URI).toBe("mongodb://127.0.0.1:27017/aibus_car_crs");
    expect(config.NODE_ENV).toBe("test");
  });

  it("fails if CAR_CRS_MONGODB_URI is omitted", () => {
    expect(() =>
      validateCarCrsConfig({
        CAR_CRS_MONGODB_URI: "",
      })
    ).toThrow();
  });
});
