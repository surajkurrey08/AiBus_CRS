import React, { useState, useMemo } from "react";

export type DriveOrientation = "RHD" | "LHD";

export interface DesignerSeat {
  seatId: string;
  label: string;
  row: number;
  column: number;
  isDriver: boolean;
  isBookable: boolean;
  category: "driver" | "front_passenger" | "window" | "middle" | "rear_window" | "aisle";
  baseFarePaise: number;
}

export interface SeatLayoutTemplate {
  templateId: string;
  name: string;
  vehicleCategory: "4-Passenger Sedan" | "7-Passenger MUV";
  totalPhysicalSeats: number;
  bookablePassengerCapacity: number;
  driveOrientation: DriveOrientation;
  seats: DesignerSeat[];
}

export const TEMPLATES: Record<"4-seater" | "7-seater", SeatLayoutTemplate> = {
  "4-seater": {
    templateId: "tpl-4-passenger-sedan",
    name: "Standard 4-Passenger Sedan (5 Physical Seats)",
    vehicleCategory: "4-Passenger Sedan",
    totalPhysicalSeats: 5,
    bookablePassengerCapacity: 4,
    driveOrientation: "RHD",
    seats: [
      {
        seatId: "D",
        label: "Driver",
        row: 1,
        column: 2,
        isDriver: true,
        isBookable: false,
        category: "driver",
        baseFarePaise: 0,
      },
      {
        seatId: "FP",
        label: "Front Passenger",
        row: 1,
        column: 1,
        isDriver: false,
        isBookable: true,
        category: "front_passenger",
        baseFarePaise: 50000,
      },
      {
        seatId: "2L",
        label: "Rear Window Left",
        row: 2,
        column: 1,
        isDriver: false,
        isBookable: true,
        category: "window",
        baseFarePaise: 50000,
      },
      {
        seatId: "2M",
        label: "Rear Middle",
        row: 2,
        column: 2,
        isDriver: false,
        isBookable: true,
        category: "middle",
        baseFarePaise: 45000,
      },
      {
        seatId: "2R",
        label: "Rear Window Right",
        row: 2,
        column: 3,
        isDriver: false,
        isBookable: true,
        category: "window",
        baseFarePaise: 50000,
      },
    ],
  },
  "7-seater": {
    templateId: "tpl-7-passenger-muv",
    name: "Standard 7-Passenger MUV (8 Physical Seats)",
    vehicleCategory: "7-Passenger MUV",
    totalPhysicalSeats: 8,
    bookablePassengerCapacity: 7,
    driveOrientation: "RHD",
    seats: [
      {
        seatId: "D",
        label: "Driver",
        row: 1,
        column: 3,
        isDriver: true,
        isBookable: false,
        category: "driver",
        baseFarePaise: 0,
      },
      {
        seatId: "FP",
        label: "Front Passenger",
        row: 1,
        column: 1,
        isDriver: false,
        isBookable: true,
        category: "front_passenger",
        baseFarePaise: 82500,
      },
      {
        seatId: "2L",
        label: "Middle Window Left",
        row: 2,
        column: 1,
        isDriver: false,
        isBookable: true,
        category: "window",
        baseFarePaise: 75000,
      },
      {
        seatId: "2M",
        label: "Middle Center",
        row: 2,
        column: 2,
        isDriver: false,
        isBookable: true,
        category: "middle",
        baseFarePaise: 65000,
      },
      {
        seatId: "2R",
        label: "Middle Window Right",
        row: 2,
        column: 3,
        isDriver: false,
        isBookable: true,
        category: "window",
        baseFarePaise: 75000,
      },
      {
        seatId: "3L",
        label: "Rear Window Left",
        row: 3,
        column: 1,
        isDriver: false,
        isBookable: true,
        category: "rear_window",
        baseFarePaise: 70000,
      },
      {
        seatId: "3M",
        label: "Rear Center",
        row: 3,
        column: 2,
        isDriver: false,
        isBookable: true,
        category: "middle",
        baseFarePaise: 60000,
      },
      {
        seatId: "3R",
        label: "Rear Window Right",
        row: 3,
        column: 3,
        isDriver: false,
        isBookable: true,
        category: "rear_window",
        baseFarePaise: 70000,
      },
    ],
  },
};

export interface SeatLayoutDesignerProps {
  initialTemplate?: "4-seater" | "7-seater";
  registration?: string;
  readOnly?: boolean;
  onSaveLayout?: (layout: {
    name: string;
    vehicleCategory: string;
    totalPhysicalSeats: number;
    bookablePassengerCapacity: number;
    driveOrientation: DriveOrientation;
    seats: DesignerSeat[];
  }) => void;
}

export const SeatLayoutDesigner: React.FC<SeatLayoutDesignerProps> = ({
  initialTemplate = "4-seater",
  registration = "MH12AB1234",
  readOnly = false,
  onSaveLayout,
}) => {
  const [activeTemplateKey, setActiveTemplateKey] = useState<"4-seater" | "7-seater">(initialTemplate);
  const [orientation, setOrientation] = useState<DriveOrientation>("RHD");
  const [seats, setSeats] = useState<DesignerSeat[]>(TEMPLATES[initialTemplate].seats);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);

  // Switch template
  const handleTemplateSwitch = (key: "4-seater" | "7-seater") => {
    setActiveTemplateKey(key);
    const tpl = TEMPLATES[key];
    const updatedSeats = tpl.seats.map((s) => {
      if (s.isDriver) {
        return { ...s, column: orientation === "RHD" ? (key === "4-seater" ? 2 : 3) : 1 };
      }
      if (s.seatId === "FP") {
        return { ...s, column: orientation === "RHD" ? 1 : key === "4-seater" ? 2 : 3 };
      }
      return { ...s };
    });
    setSeats(updatedSeats);
    setSelectedSeatId(null);
  };

  // Switch drive orientation (RHD / LHD)
  const handleOrientationToggle = (newOrientation: DriveOrientation) => {
    setOrientation(newOrientation);
    setSeats((prevSeats) =>
      prevSeats.map((s) => {
        if (s.isDriver) {
          const col = newOrientation === "RHD" ? (activeTemplateKey === "4-seater" ? 2 : 3) : 1;
          return { ...s, column: col };
        }
        if (s.seatId === "FP") {
          const col = newOrientation === "RHD" ? 1 : activeTemplateKey === "4-seater" ? 2 : 3;
          return { ...s, column: col };
        }
        return s;
      })
    );
  };

  // Modify seat fare
  const handleFareChange = (seatId: string, newFareRupees: number) => {
    if (readOnly) return;
    setSeats((prev) =>
      prev.map((s) => {
        if (s.seatId === seatId && !s.isDriver) {
          return { ...s, baseFarePaise: Math.max(0, Math.round(newFareRupees * 100)) };
        }
        return s;
      })
    );
  };

  // Physical layout validation
  const validation = useMemo(() => {
    const driverCount = seats.filter((s) => s.isDriver).length;
    const bookablePassengerCount = seats.filter((s) => s.isBookable && !s.isDriver).length;
    const expected = TEMPLATES[activeTemplateKey].bookablePassengerCapacity;
    const totalPhysical = seats.length;
    const driverIsNonBookable = seats.filter((s) => s.isDriver).every((s) => !s.isBookable);

    const isValid =
      driverCount === 1 &&
      driverIsNonBookable &&
      bookablePassengerCount === expected &&
      totalPhysical === expected + 1;

    return {
      isValid,
      driverCount,
      bookablePassengerCount,
      expectedPassengerCapacity: expected,
      totalPhysical,
      driverIsNonBookable,
    };
  }, [seats, activeTemplateKey]);

  const selectedSeat = seats.find((s) => s.seatId === selectedSeatId);

  // Group seats by row
  const rows = useMemo(() => {
    const map: Record<number, DesignerSeat[]> = {};
    for (const seat of seats) {
      if (!map[seat.row]) map[seat.row] = [];
      map[seat.row].push(seat);
    }
    // Sort each row by column
    for (const r in map) {
      map[r].sort((a, b) => a.column - b.column);
    }
    return map;
  }, [seats]);

  const handleSave = () => {
    if (!validation.isValid || readOnly || !onSaveLayout) return;
    onSaveLayout({
      name: `${registration} ${TEMPLATES[activeTemplateKey].vehicleCategory} Layout`,
      vehicleCategory: TEMPLATES[activeTemplateKey].vehicleCategory,
      totalPhysicalSeats: validation.totalPhysical,
      bookablePassengerCapacity: validation.bookablePassengerCount,
      driveOrientation: orientation,
      seats,
    });
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header & Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>
            Car Seat Layout Designer
          </h2>
          <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "#6b7280" }}>
            Bus-style individual passenger seat booking platform for {registration}
          </p>
        </div>

        {/* Template Switcher */}
        <div style={{ display: "flex", gap: 8, background: "#f3f4f6", padding: 4, borderRadius: 8 }}>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => handleTemplateSwitch("4-seater")}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              background: activeTemplateKey === "4-seater" ? "#2563eb" : "transparent",
              color: activeTemplateKey === "4-seater" ? "#ffffff" : "#374151",
              transition: "all 0.15s ease",
            }}
          >
            4-Passenger Sedan (5 Physical)
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => handleTemplateSwitch("7-seater")}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              background: activeTemplateKey === "7-seater" ? "#2563eb" : "transparent",
              color: activeTemplateKey === "7-seater" ? "#ffffff" : "#374151",
              transition: "all 0.15s ease",
            }}
          >
            7-Passenger MUV (8 Physical)
          </button>
        </div>
      </div>

      {/* Orientation and Safety Status Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: validation.isValid ? "#ecfdf5" : "#fef2f2",
          border: `1px solid ${validation.isValid ? "#a7f3d0" : "#fecaca"}`,
          padding: "10px 16px",
          borderRadius: 8,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>{validation.isValid ? "🛡️" : "⚠️"}</span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: validation.isValid ? "#065f46" : "#991b1b",
            }}
          >
            {validation.isValid
              ? `Physical Layout Verified: 1 Driver (Locked) + ${validation.bookablePassengerCount} Bookable Passenger Seats = ${validation.totalPhysical} Total Physical Seats`
              : "Invalid Layout Configuration: Driver seat must be locked and capacity must match exactly."}
          </span>
        </div>

        {/* Orientation selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 500 }}>
          <span style={{ color: "#4b5563" }}>Orientation:</span>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => handleOrientationToggle("RHD")}
            style={{
              padding: "3px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              cursor: "pointer",
              background: orientation === "RHD" ? "#1f2937" : "#ffffff",
              color: orientation === "RHD" ? "#ffffff" : "#374151",
            }}
          >
            RHD (India / UK)
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => handleOrientationToggle("LHD")}
            style={{
              padding: "3px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              cursor: "pointer",
              background: orientation === "LHD" ? "#1f2937" : "#ffffff",
              color: orientation === "LHD" ? "#ffffff" : "#374151",
            }}
          >
            LHD (US / EU)
          </button>
        </div>
      </div>

      {/* Main Automotive Top-Down Canvas */}
      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 24, alignItems: "start" }}>
        {/* Car Chassis Container */}
        <div
          style={{
            background: "#f8fafc",
            border: "2px solid #cbd5e1",
            borderRadius: "48px 48px 36px 36px",
            padding: "20px 24px 30px 24px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05), inset 0 2px 4px rgba(0,0,0,0.02)",
            position: "relative",
          }}
        >
          {/* Front Hood / Windshield */}
          <div
            style={{
              textAlign: "center",
              marginBottom: 16,
              paddingBottom: 10,
              borderBottom: "2px dashed #cbd5e1",
            }}
          >
            <div
              style={{
                width: 60,
                height: 6,
                background: "#94a3b8",
                borderRadius: 3,
                margin: "0 auto 8px auto",
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#64748b" }}>
              FRONT HOOD & WINDSHIELD
            </span>
          </div>

          {/* Cabin Rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.keys(rows)
              .map(Number)
              .sort()
              .map((rowNum) => {
                const rowSeats = rows[rowNum];
                const isFrontRow = rowNum === 1;

                return (
                  <div key={rowNum} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textAlign: "center" }}>
                      {isFrontRow
                        ? "ROW 1 — DRIVER & FRONT CABIN"
                        : rowNum === 2
                        ? activeTemplateKey === "7-seater"
                          ? "ROW 2 — MIDDLE BENCH"
                          : "ROW 2 — REAR PASSENGER BENCH"
                        : "ROW 3 — REAR BENCH"}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        justifyContent: isFrontRow ? "space-between" : "center",
                        gap: 12,
                      }}
                    >
                      {rowSeats.map((seat) => {
                        const isSelected = selectedSeatId === seat.seatId;
                        const isDriver = seat.isDriver;

                        return (
                          <div
                            key={seat.seatId}
                            onClick={() => setSelectedSeatId(seat.seatId)}
                            style={{
                              flex: isFrontRow ? "0 0 130px" : "1 1 0",
                              padding: "10px 8px",
                              borderRadius: 10,
                              cursor: "pointer",
                              textAlign: "center",
                              background: isDriver
                                ? "#fee2e2"
                                : isSelected
                                ? "#dbeafe"
                                : "#ffffff",
                              border: `2px solid ${
                                isDriver
                                  ? "#ef4444"
                                  : isSelected
                                  ? "#2563eb"
                                  : "#e2e8f0"
                              }`,
                              boxShadow: isSelected
                                ? "0 0 0 3px rgba(37, 99, 235, 0.2)"
                                : "0 2px 4px rgba(0,0,0,0.04)",
                              transition: "all 0.15s ease",
                              userSelect: "none",
                            }}
                          >
                            {/* Seat Identifier & Icon */}
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 4,
                                marginBottom: 4,
                              }}
                            >
                              {isDriver ? (
                                <span style={{ fontSize: 13 }} title="Steering Wheel">
                                  🚗
                                </span>
                              ) : (
                                <span style={{ fontSize: 13 }}>💺</span>
                              )}
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: 14,
                                  color: isDriver ? "#b91c1c" : "#1e293b",
                                }}
                              >
                                {seat.seatId}
                              </span>
                            </div>

                            {/* Seat Label */}
                            <div
                              style={{
                                fontSize: 11,
                                color: isDriver ? "#991b1b" : "#64748b",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {isDriver ? "Driver (Locked)" : seat.label}
                            </div>

                            {/* Badge */}
                            <div style={{ marginTop: 6 }}>
                              {isDriver ? (
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontSize: 9,
                                    fontWeight: 700,
                                    color: "#991b1b",
                                    background: "#fecaca",
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    letterSpacing: 0.5,
                                  }}
                                >
                                  NON-BOOKABLE
                                </span>
                              ) : (
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: "#1d4ed8",
                                    background: "#eff6ff",
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                  }}
                                >
                                  ₹{Math.round(seat.baseFarePaise / 100)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Rear Boot / Trunk */}
          <div
            style={{
              textAlign: "center",
              marginTop: 20,
              paddingTop: 12,
              borderTop: "2px dashed #cbd5e1",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#64748b" }}>
              LUGGAGE BOOT / TRUNK
            </span>
          </div>
        </div>

        {/* Seat Inspector / Edit Panel */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 20,
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
          }}
        >
          {selectedSeat ? (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingBottom: 12,
                  borderBottom: "1px solid #e5e7eb",
                  marginBottom: 16,
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>
                    Seat {selectedSeat.seatId} Inspector
                  </h3>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>{selectedSeat.label}</span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "4px 8px",
                    borderRadius: 6,
                    background: selectedSeat.isDriver ? "#fee2e2" : "#ecfdf5",
                    color: selectedSeat.isDriver ? "#991b1b" : "#047857",
                  }}
                >
                  {selectedSeat.isDriver ? "LOCKED DRIVER SEAT" : "BOOKABLE PASSENGER"}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                    Position & Category
                  </label>
                  <div
                    style={{
                      fontSize: 13,
                      background: "#f9fafb",
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: "1px solid #e5e7eb",
                      color: "#1f2937",
                      textTransform: "capitalize",
                    }}
                  >
                    Row {selectedSeat.row}, Column {selectedSeat.column} ({selectedSeat.category.replace("_", " ")})
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                    Bookable Status
                  </label>
                  <div
                    style={{
                      fontSize: 13,
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: selectedSeat.isDriver ? "#f3f4f6" : "#f0fdf4",
                      color: selectedSeat.isDriver ? "#6b7280" : "#15803d",
                      fontWeight: 600,
                    }}
                  >
                    {selectedSeat.isDriver
                      ? "⛔ Non-Bookable (Strict Automotive Rule: Driver seat cannot be sold)"
                      : "✅ Bookable for Individual Passenger Reservation"}
                  </div>
                </div>

                {!selectedSeat.isDriver && (
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                      Base Fare (₹ INR)
                    </label>
                    <input
                      type="number"
                      disabled={readOnly}
                      min={0}
                      step={50}
                      value={Math.round(selectedSeat.baseFarePaise / 100)}
                      onChange={(e) => handleFareChange(selectedSeat.seatId, Number(e.target.value))}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        fontSize: 14,
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <span style={{ fontSize: 11, color: "#6b7280", marginTop: 4, display: "block" }}>
                      Paise equivalent: {selectedSeat.baseFarePaise} paise
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 10px", color: "#6b7280" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>💺</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#374151" }}>Select a Seat</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                Click any seat in the car blueprint to inspect its position, pricing tier, and bookable status.
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
            <button
              type="button"
              disabled={readOnly || !validation.isValid}
              onClick={handleSave}
              style={{
                width: "100%",
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 600,
                color: "#ffffff",
                background: validation.isValid && !readOnly ? "#2563eb" : "#9ca3af",
                border: "none",
                borderRadius: 8,
                cursor: validation.isValid && !readOnly ? "pointer" : "not-allowed",
              }}
            >
              Save & Apply Layout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
