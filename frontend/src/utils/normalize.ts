import type { Row } from "../data/demo-data.ts";
export type Raw = Record<string, any>;
export function normalize(
  resource: string,
  r: Raw,
  lookup: { routes?: Raw[]; trips?: Raw[]; buses?: Raw[] } = {},
): Row {
  const trip = lookup.trips?.find((t) => t._id === r.tripId),
    route = lookup.routes?.find((t) => t._id === (r.routeId || trip?.routeId));
  const routeLabel = route ? `${route.source} → ${route.destination}` : "";
  const base = {
    id: String(r._id || r.id || ""),
    status: String(r.status || "Active"),
  };
  if (resource === "finance/refund-intents") return { ...base, bookingId: String(r.bookingId), purpose: r.purpose, fundingMethod: r.fundingMethod, amountDisplay: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(r.amountPaise / 100) };
  if (resource === "finance/wallets") {
    const inr = (value: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
      }).format(value / 100);
    return {
      ...base,
      name: r.name,
      posted: inr(r.postedPaise),
      reserved: inr(r.reservedPaise),
      available: inr(r.availablePaise),
      creditLimit: inr(r.creditLimitPaise),
      outstanding: inr(r.creditOutstandingPaise),
    };
  }
  if (
    resource.startsWith("bus-master/") ||
    resource.startsWith("area-master/")
  ) {
    const bus = lookup.buses?.find((bus) => bus._id === r.busId);
    return {
      ...base,
      ...Object.fromEntries(
        Object.entries(r)
          .filter(
            ([, value]) =>
              typeof value === "string" || typeof value === "number",
          )
          .map(([key, value]) => [key, String(value)]),
      ),
      id: String(r._id),
      name: r.name || r.reference || r.provider || "",
      registration: bus?.registration || r.busId || "",
      type: r.kind || r.type || "",
      capacity: String(r.seats?.length || ""),
      telemetry: "Not connected",
    };
  }
  if (resource === "buses")
    return {
      ...base,
      id: r.registration,
      _id: r._id,
      name: r.name,
      type: r.type,
      capacity: String(r.capacity),
      route: "",
      registration: r.registration,
      status: r.status,
    };
  if (resource === "routes")
    return {
      ...base,
      route: `${r.source} → ${r.destination}`,
      source: r.source,
      destination: r.destination,
      boarding: (r.boarding || []).map((p: Raw) => p.name).join(", "),
      dropping: (r.dropping || []).map((p: Raw) => p.name).join(", "),
      departure: r.departure,
      arrival: r.arrival,
      duration: `${Math.floor(r.durationMinutes / 60)}h ${r.durationMinutes % 60}m`,
      durationMinutes: String(r.durationMinutes),
    };
  if (resource === "trips")
    return {
      ...base,
      route: routeLabel || r.routeId,
      date: r.journeyDate,
      departure: new Date(r.departureAt).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
      }),
      busId: r.busId,
    };
  if (resource === "bookings")
    return {
      ...base,
      _id: r._id,
      id: r.reference,
      pnr: r.pnr || "Not issued",
      passenger:
        r.passengers
          ?.map((p: Raw) => p.name)
          .filter(Boolean)
          .join(", ") || "Restricted",
      phone:
        r.passengers
          ?.map((p: Raw) => p.phone)
          .filter(Boolean)
          .join(", ") || "",
      route: routeLabel || r.tripId,
      date: trip?.journeyDate || "",
      bus: lookup.buses?.find((b) => b._id === trip?.busId)?.name || "",
      seat: r.passengers?.map((p: Raw) => p.seat).join(", "),
      fare: String((r.totalPaise || 0) / 100),
      status: r.status,
      boarding: r.passengers?.[0]?.boarding || "",
      checkin: r.passengers?.every((p: Raw) => p.checkedInAt)
        ? "Checked in"
        : "Awaiting",
      tripId: r.tripId,
      paymentStatus: r.paymentStatus,
    };
  if (resource === "fares")
    return {
      ...base,
      routeId: r.routeId,
      route: routeLabel || r.routeId,
      weekday: String(r.basePaise / 100),
      weekend: String((r.weekendPaise ?? r.basePaise) / 100),
      single: String((r.singlePaise ?? r.basePaise) / 100),
      singleWeekend: String(
        (r.singleWeekendPaise ??
          r.singlePaise ??
          r.weekendPaise ??
          r.basePaise) / 100,
      ),
      festival: String((r.specialDates?.[0]?.amountPaise ?? r.basePaise) / 100),
      discount: "0%",
      version: String(r.version),
    };
  if (resource === "offers")
    return {
      ...base,
      _id: r._id,
      id: r.code,
      name: r.name,
      discount: `${r.percent}%`,
      period: `${r.startDate} – ${r.endDate}`,
      startDate: r.startDate,
      endDate: r.endDate,
      used: String(r.usage || 0),
    };
  if (resource === "refunds")
    return {
      ...base,
      passenger: "Authorized booking",
      route: r.bookingId,
      amount: String((r.amountPaise || 0) / 100),
      date: r.createdAt?.slice(0, 10) || "",
      bookingId: r.bookingId,
    };
  if (resource === "finance/settlements") return { ...base, ...r, id: r._id, netDisplay: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format((r.netPaise || 0) / 100) };
  if (resource === "settlements")
    return {
      ...base,
      id: r.externalId,
      date: r.settledAt?.slice(0, 10) || "Pending",
      amount: String((r.netPaise || 0) / 100),
      commission: `₹${(r.commissionPaise || 0) / 100}`,
    };
  if (resource === "staff")
    return {
      ...base,
      name: r.name,
      email: r.email,
      phone: r.phone || "",
      role: r.role,
      roleDisplay:
        r.role === "booking_staff"
          ? "Agent"
          : r.role === "manager"
            ? "Manager"
            : r.role === "read_only"
              ? "Read Only"
              : r.role,
      commissionType: r.commissionType || "Percent",
      commissionRate: String((r.commissionRate || 0) / 100),
      rawCommissionRate: String(r.commissionRate ?? 500),
      status: r.active ? "Active" : "Inactive",
    };
  return Object.fromEntries(
    Object.entries({ ...r, ...base }).map(([k, v]) => [
      k,
      typeof v === "object" ? JSON.stringify(v) : String(v ?? ""),
    ]),
  );
}
