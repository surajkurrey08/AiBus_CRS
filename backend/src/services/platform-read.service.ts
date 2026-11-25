import mongoose from "mongoose";
import * as M from "../models/index.js";
import { fail, type Principal, literalRegex } from "../utils/core.js";
import type { Permission } from "../types/permissions.js";
import {
  createdDuring,
  indiaToday,
} from "../validators/agent-dashboard.schemas.js";
import { csvDocument } from "./finance-export.service.js";
import { paise, safeMoney } from "./ledger.service.js";
export type PlatformQuery = {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  operatorId?: string;
  agentId?: string;
  from?: string;
  to?: string;
  source?: string;
};
export function platformPermit(auth: Principal, permission: Permission) {
  if (
    auth.role !== "super_admin" ||
    auth.operatorId ||
    auth.agentId ||
    !auth.permissions.includes(permission)
  )
    fail(403, "FORBIDDEN", "Explicit platform permission is required");
}
export async function selectedOperator(operatorId?: string) {
  if (operatorId && !(await M.Operator.exists({ _id: operatorId })))
    fail(404, "NOT_FOUND", "Operator not found");
  return operatorId ? { operatorId } : {};
}
const permits: Record<string, Permission> = {
  buses: "platform:monitor:read",
  cars: "platform:monitor:read",
  trips: "platform:monitor:read",
  routes: "platform:monitor:read",
  agencies: "platform:agencies:read",
  bookings: "platform:bookings:read",
  alerts: "platform:monitor:read",
  audit: "platform:audit:read",
};
async function capped(
  model: any,
  filter: any,
  projection: string,
  session?: any,
) {
  const rows = await model
    .find(filter)
    .select(projection)
    .sort({ createdAt: -1, _id: -1 })
    .limit(10001)
    .session(session || null)
    .lean();
  if (rows.length > 10000)
    fail(
      413,
      "PLATFORM_SCOPE_TOO_LARGE",
      "Narrow the date range or operator scope",
    );
  return rows;
}
function safeMetadata(metadata: any, finance: boolean) {
  const allowed = [
    "reason",
    "status",
    "previousStatus",
    "profile",
    "active",
    "version",
    "changedFields",
    "permissions",
    "previousProfile",
    "previousPermissions",
    "financeRead",
    "financeActions",
    "previousFinanceRead",
    "previousFinanceActions",
    "action",
    "revision",
    ...(finance ? ["amountPaise", "journalId", "intentId", "reference"] : []),
  ];
  return Object.fromEntries(
    allowed
      .filter((k) => metadata && Object.hasOwn(metadata, k))
      .map((k) => [k, metadata[k]]),
  );
}
const financeAction =
  /^(ledger|wallet|credit|refund|settlement|exception|payment|cancellation)\./;
export async function platformRows(
  auth: Principal,
  resource: string,
  q: PlatformQuery,
  exportAll = false,
) {
  if (!permits[resource])
    fail(404, "NOT_FOUND", "Monitoring resource not found");
  platformPermit(auth, permits[resource]);
  const scope = await selectedOperator(q.operatorId),
    finance = auth.permissions.includes("platform:finance:read");
  let rows: any[] = [];
  await mongoose.connection.transaction(
    async (session) => {
      const companies = await M.Operator.find(
        q.operatorId ? { _id: q.operatorId } : {},
      )
        .select("company status")
        .session(session)
        .lean();
      const names = new Map(companies.map((o) => [String(o._id), o.company]));
      const common = (r: any) => ({
        id: String(r._id),
        operatorId: String(r.operatorId || ""),
        operator: names.get(String(r.operatorId)) || "Platform",
        status: r.status,
      });
      if (resource === "buses")
        rows = (
          await capped(
            M.Bus,
            scope,
            "operatorId registration name type capacity status insuranceExpiry permitExpiry",
            session,
          )
        ).map((b: any) => ({
          ...common(b),
          registration: b.registration,
          name: b.name,
          type: b.type,
          capacity: b.capacity,
        }));
      if (resource === "cars")
        rows = (
          await capped(
            M.Car,
            scope,
            "operatorId registration make model vehicleCategory bookablePassengerCapacity status",
            session,
          )
        ).map((c: any) => ({
          ...common(c),
          registration: c.registration,
          name: [c.make, c.model].filter(Boolean).join(" "),
          type: c.vehicleCategory,
          capacity: c.bookablePassengerCapacity,
        }));
      if (resource === "routes")
        rows = (
          await capped(
            M.Route,
            scope,
            "operatorId source destination departure arrival status",
            session,
          )
        ).map((r: any) => ({
          ...common(r),
          route: `${r.source} → ${r.destination}`,
          departure: r.departure,
          arrival: r.arrival,
        }));
      if (
        resource === "trips" ||
        resource === "bookings" ||
        resource === "alerts"
      ) {
        const trips: any[] = await capped(
          M.Trip,
          {
            ...scope,
            ...(q.from || q.to
              ? {
                  journeyDate: {
                    ...(q.from ? { $gte: q.from } : {}),
                    ...(q.to ? { $lte: q.to } : {}),
                  },
                }
              : {}),
          },
          "operatorId routeId busId carId journeyDate departureAt arrivalAt status operationStage bookingOpen seats",
          session,
        );
        const buses = await M.Bus.find({
            _id: { $in: trips.map((t) => t.busId) },
            ...scope,
          })
            .select("registration type")
            .session(session)
            .lean(),
          routes = await M.Route.find({
            _id: { $in: trips.map((t) => t.routeId) },
            ...scope,
          })
            .select("source destination")
            .session(session)
            .lean();
        const cars=await M.Car.find({...scope,_id:{$in:trips.map(t=>t.carId||t.busId)}}).select("registration vehicleCategory").session(session).lean();
        const vehicles:any[]=[...buses,...cars.map(c=>({...c,type:c.vehicleCategory}))];
        const busMap = new Map(vehicles.map((b) => [String(b._id), b])),
          routeMap = new Map(routes.map((r) => [String(r._id), r]));
        const inventory = (t: any) => ({
          total: t.seats.filter((s:any)=>!s.isDriver&&s.isBookable!==false).length,
          available: t.seats.filter(
            (s: any) =>
              s.state === "available" ||
              (s.state === "held" && new Date(s.holdUntil) <= new Date()),
          ).length,
          booked: t.seats.filter((s: any) => s.state === "booked").length,
          blocked: t.seats.filter((s: any) => !s.isDriver && s.isBookable!==false && s.state === "blocked").length,
          held: t.seats.filter(
            (s: any) =>
              s.state === "held" && new Date(s.holdUntil) > new Date(),
          ).length,
        });
        const tripRows = trips.map((t) => {
          const route = routeMap.get(String(t.routeId));
          return {
            ...common(t),
            date: t.journeyDate,
            registration:
              busMap.get(String(t.busId))?.registration || "Unavailable",
            busType: busMap.get(String(t.busId))?.type,
            route: route
              ? `${route.source} → ${route.destination}`
              : "Unavailable",
            departure: t.departureAt,
            arrival: t.arrivalAt,
            bookingOpen: t.bookingOpen,
            operation: t.operationStage || "Not recorded",
            ...inventory(t),
          };
        });
        if (resource === "trips") rows = tripRows;
        if (resource === "bookings") {
          const bookings = await capped(
            M.Booking,
            {
              ...scope,
              tripId: { $in: trips.map((t) => t._id) },
              ...(q.source ? { source: q.source } : {}),
              ...(q.agentId
                ? {
                    $or: [
                      { agentId: q.agentId },
                      {
                        salesPartnerId: q.agentId,
                        "commissionSnapshot.partnerKind": "Agent",
                      },
                    ],
                  }
                : {}),
            },
            "operatorId tripId agentId salesPartnerId commissionSnapshot.partnerKind reference pnr source passengers.seat status paymentStatus createdAt",
            session,
          );
          const ids = bookings.map((b: any) => b._id),
            tickets = await M.Ticket.find({ bookingId: { $in: ids }, ...scope })
              .select("bookingId status")
              .session(session)
              .lean(),
            cancellations = await M.Cancellation.find({
              bookingId: { $in: ids },
              ...scope,
            })
              .select("bookingId status")
              .session(session)
              .lean();
          const agencies = await M.SalesPartner.find({
              ...scope,
              kind: "Agent",
            })
              .select("name")
              .session(session)
              .lean(),
            agencyNames = new Map(agencies.map((a) => [String(a._id), a.name])),
            tripMap = new Map(tripRows.map((t) => [t.id, t]));
          rows = bookings.map((b: any) => {
            const agentId = String(
                b.agentId ||
                  (b.commissionSnapshot?.partnerKind === "Agent"
                    ? b.salesPartnerId || ""
                    : ""),
              ),
              t = tripMap.get(String(b.tripId));
            return {
              ...common(b),
              reference: b.reference,
              pnr: b.pnr || "Not issued",
              agencyId: agentId,
              agency: agencyNames.get(agentId) || "Direct / operator",
              source: b.source,
              date: t?.date,
              route: t?.route,
              tripId: String(b.tripId),
              seats: b.passengers.map((p: any) => p.seat).join(", "),
              paymentStatus: b.paymentStatus,
              ticketStatus:
                tickets.find((t) => String(t.bookingId) === String(b._id))
                  ?.status || "Not issued",
              cancellationStatus:
                cancellations.find((c) => String(c.bookingId) === String(b._id))
                  ?.status || "None",
            };
          });
        }
        if (resource === "alerts") {
          rows = tripRows
            .filter((t) => t.status === "Scheduled" && !t.bookingOpen)
            .map((t) => ({
              ...t,
              id: `sales:${t.id}`,
              status: "Warning",
              code: "TRIP_SALES_STOPPED",
              message: `New sales stopped for ${t.route}`,
            }));
          const expired: any[] = await capped(
            M.Bus,
            {
              ...scope,
              $or: [
                { permitExpiry: { $lt: new Date() } },
                { insuranceExpiry: { $lt: new Date() } },
              ],
            },
            "operatorId registration",
            session,
          );
          rows.push(
            ...expired.map((b) => ({
              ...common(b),
              status: "Warning",
              code: "VEHICLE_DOCUMENT_EXPIRED",
              message: `Review permit / insurance for ${b.registration}`,
            })),
          );
          rows.push(
            ...companies
              .filter((c) => c.status === "suspended")
              .map((c) => ({
                id: `operator:${c._id}`,
                operatorId: String(c._id),
                operator: c.company,
                status: "Warning",
                code: "OPERATOR_SUSPENDED",
                message:
                  "Portal access and new sales blocked; existing tickets preserved",
              })),
          );
        }
      }
      if (resource === "agencies") {
        const agencies = await capped(
          M.SalesPartner,
          { ...scope, kind: "Agent" },
          "operatorId name status permissions commissionType commissionRate",
          session,
        );
        rows = [];
        for (const a of agencies) {
          const wallet: any =
              finance &&
              (await M.AgentWallet.findOne({
                operatorId: a.operatorId,
                agentId: a._id,
              })
                .session(session)
                .lean()),
            credit: any =
              finance &&
              (await M.CreditFacility.findOne({
                operatorId: a.operatorId,
                agentId: a._id,
              })
                .session(session)
                .lean());
          let exposure = 0n;
          if (credit) {
            const account: any = await M.LedgerAccount.findOne({
                operatorId: a.operatorId,
                ownerId: String(a._id),
                code: "agency-credit-receivable",
              })
                .session(session)
                .lean(),
              balance: any =
                account &&
                (await M.AccountBalanceProjection.findOne({
                  accountId: account._id,
                })
                  .session(session)
                  .lean());
            if (balance)
              exposure = paise(balance.debitPaise) - paise(balance.creditPaise);
          }
          const agencyBookings = finance
            ? await M.Booking.find({
                operatorId: a.operatorId,
                $or: [
                  { agentId: a._id },
                  {
                    salesPartnerId: a._id,
                    "commissionSnapshot.partnerKind": "Agent",
                  },
                ],
              })
                .select("_id")
                .limit(10001)
                .session(session)
                .lean()
            : [];
          if (agencyBookings.length > 10000)
            fail(
              413,
              "PLATFORM_SCOPE_TOO_LARGE",
              "Narrow the agency financial review scope",
            );
          const openFinancialExceptions = finance
            ? await M.FinanceException.countDocuments({
                operatorId: a.operatorId,
                bookingId: { $in: agencyBookings.map((b) => b._id) },
                status: { $ne: "Resolved" },
              }).session(session)
            : undefined;
          rows.push({
            ...common(a),
            name: a.name,
            permissions: a.permissions.join(", "),
            commission:
              a.commissionType === "Fixed"
                ? new Intl.NumberFormat("en-IN", {
                    style: "currency",
                    currency: "INR",
                  }).format(a.commissionRate / 100) + " per eligible passenger"
                : a.commissionRate / 100 + "% of approved commission basis",
            bookingCount: await M.Booking.countDocuments({
              operatorId: a.operatorId,
              $or: [
                { agentId: a._id },
                {
                  salesPartnerId: a._id,
                  "commissionSnapshot.partnerKind": "Agent",
                },
              ],
            }).session(session),
            ...(finance
              ? {
                  openFinancialExceptions,
                  walletStatus: wallet?.status || "Not configured",
                  creditStatus: credit?.status || "Not configured",
                  creditOutstandingPaise: safeMoney(exposure),
                }
              : {}),
          });
        }
      }
      if (resource === "audit") {
        const entries = await capped(
          M.Audit,
          {
            ...scope,
            ...createdDuring(q),
            ...(!finance ? { action: { $not: financeAction } } : {}),
          },
          "operatorId actorId action resource resourceId metadata createdAt expiresAt",
          session,
        );
        const actors = await M.User.find({
            _id: { $in: entries.map((e: any) => e.actorId).filter(Boolean) },
          })
            .select("name")
            .session(session)
            .lean(),
          actorNames = new Map(actors.map((a) => [String(a._id), a.name]));
        rows = entries.map((e: any) => ({
          ...common(e),
          actor: actorNames.get(String(e.actorId)) || "System / historical",
          action: e.action,
          resource: e.resource || "Record",
          resourceId: e.resourceId,
          time: e.createdAt,
          retention: e.expiresAt ? "Operational policy" : "Preserved",
          reason: e.metadata?.reason || "Not recorded",
          metadata: safeMetadata(e.metadata, finance),
        }));
      }
    },
    { readConcern: { level: "snapshot" } },
  );
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  if (q.search) {
    const match = literalRegex(q.search);
    rows = rows.filter((r) =>
      Object.values(r).some((v) =>
        match.test(typeof v === "object" ? JSON.stringify(v) : String(v)),
      ),
    );
  }
  const total = rows.length;
  return {
    rows: exportAll
      ? rows
      : rows.slice((q.page - 1) * q.limit, q.page * q.limit),
    total,
    page: q.page,
    limit: q.limit,
    pages: Math.max(1, Math.ceil(total / q.limit)),
  };
}
export async function platformDetail(
  auth: Principal,
  resource: string,
  id: string,
) {
  const data = await platformRows(
      auth,
      resource,
      { page: 1, limit: 100 },
      true,
    ),
    row = data.rows.find((r) => r.id === id);
  if (!row) fail(404, "NOT_FOUND", "Platform record not found");
  if (resource !== "bookings") return { record: row };
  const booking: any = await M.Booking.findOne({
    _id: id,
    operatorId: row.operatorId,
  }).lean();
  const ticket = await M.Ticket.findOne({
    bookingId: id,
    operatorId: row.operatorId,
  })
    .select("pnr status issuedAt")
    .lean();
  const audits: any[] = auth.permissions.includes("platform:audit:read")
    ? await M.Audit.find({ operatorId: row.operatorId, resourceId: id })
        .select("action createdAt")
        .sort({ createdAt: 1 })
        .limit(200)
        .lean()
    : [];
  const finance = auth.permissions.includes("platform:finance:read");
  if (auth.permissions.includes("platform:passengers:read"))
    await M.Audit.create({
      operatorId: row.operatorId,
      actorId: auth.userId,
      action: "platform.passengers.view",
      resourceId: id,
      metadata: { reason: "Authorized support detail" },
    });
  return {
    record: row,
    ticket,
    timeline: [
      { action: "booking.created", at: booking.createdAt },
      ...(ticket ? [{ action: "ticket.issued", at: ticket.issuedAt }] : []),
      ...audits.map((a) => ({ action: a.action, at: a.createdAt })),
    ].sort((a, b) => +new Date(a.at) - +new Date(b.at)),
    ...(auth.permissions.includes("platform:passengers:read")
      ? { passengers: booking.passengers, contact: booking.contact }
      : { passengerDataRestricted: true }),
    ...(finance
      ? {
          payments: await M.Payment.find({
            operatorId: row.operatorId,
            bookingId: id,
          })
            .select(
              "providerId status amountPaise currency refundedPaise confirmedAt",
            )
            .lean(),
          refundIntents: await M.RefundIntent.find({
            operatorId: row.operatorId,
            bookingId: id,
          })
            .select("status amountPaise fundingMethod createdAt processedAt")
            .lean(),
          exceptions: await M.FinanceException.find({
            operatorId: row.operatorId,
            bookingId: id,
          })
            .select("kind status code")
            .lean(),
        }
      : { financialEvidenceRestricted: true }),
  };
}
export async function platformOverview(auth: Principal, q: PlatformQuery) {
  platformPermit(auth, "platform:overview:read");
  const scope = await selectedOperator(q.operatorId),
    today = indiaToday();
  // Reuse the scoped monitoring projections rather than another inventory engine.
  const internal = {
    ...auth,
    permissions: [
      ...new Set<Permission>([
        ...auth.permissions,
        "platform:monitor:read",
        "platform:bookings:read",
      ]),
    ],
  };
  const trips = (await platformRows(internal, "trips", q, true)).rows,
    bookings = (await platformRows(internal, "bookings", q, true)).rows;
  const operators = await M.Operator.find(
    q.operatorId ? { _id: q.operatorId } : {},
  )
    .select("status")
    .lean();
  const metrics: Record<string, number> = {
    totalOperators: operators.length,
    activeOperators: operators.filter((o) => o.status === "approved").length,
    pendingOperators: operators.filter((o) => o.status === "pending").length,
    buses: await M.Bus.countDocuments(scope),
    cars: await M.Car.countDocuments(scope),
    activeTrips: trips.filter((t) =>
      ["Scheduled", "Departed"].includes(t.status),
    ).length,
    departingToday: trips.filter(
      (t) => t.date === today && t.status === "Scheduled",
    ).length,
    confirmedBookings: bookings.filter((b) => b.status === "Confirmed").length,
    pendingBookings: bookings.filter((b) => b.status === "Pending payment")
      .length,
    cancelledBookings: bookings.filter((b) => b.status === "Cancelled").length,
    availableSeats: trips
      .filter((t) => t.status === "Scheduled")
      .reduce((sum, t) => sum + t.available, 0),
  };
  if (auth.permissions.includes("platform:finance:read")) {
    const ids = bookings.map((b) => new mongoose.Types.ObjectId(b.id)),
      actual: any[] = await M.Booking.find({ _id: { $in: ids }, ...scope })
        .select("totalPaise")
        .lean();
    metrics.grossBookingValuePaise = safeMoney(
      actual.reduce((sum, b) => sum + paise(b.totalPaise), 0n),
    );
    const accounts = await M.LedgerAccount.find({
        ...scope,
        code: "platform-commission",
      })
        .select("_id")
        .lean(),
      projections: any[] = await M.AccountBalanceProjection.find({
        ...scope,
        accountId: { $in: accounts.map((a) => a._id) },
      }).lean();
    metrics.platformEarningsPaise = safeMoney(
      projections.reduce(
        (sum, p) => sum + paise(p.creditPaise) - paise(p.debitPaise),
        0n,
      ),
    );
    metrics.pendingSettlements = await M.Settlement.countDocuments({
      ...scope,
      workflowVersion: 1,
      workflowStatus: { $ne: "Paid" },
    });
    metrics.refundExceptions = await M.FinanceException.countDocuments({
      ...scope,
      status: { $ne: "Resolved" },
    });
  }
  const group = (key: string, data: any[]) =>
    [
      ...data.reduce(
        (m, r) =>
          m.set(r[key] || "Unknown", (m.get(r[key] || "Unknown") || 0) + 1),
        new Map<string, number>(),
      ),
    ].map(([label, count]) => ({ label, count }));
  return {
    metrics,
    financeRestricted: !auth.permissions.includes("platform:finance:read"),
    trends: group("date", bookings).sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
    routes: group("route", bookings),
    recent: await M.Audit.find({ ...scope, action: { $not: financeAction } })
      .select("action resourceId createdAt")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    policy:
      "Booking metrics use selected travel dates. Finance balances and open cases are current, not period revenue; gross value is not platform revenue.",
    alerts: (await platformRows(internal, "alerts", q, true)).rows.slice(0, 20),
  };
}
export async function operationalReport(
  auth: Principal,
  name: string,
  q: PlatformQuery,
  exportAll = false,
) {
  platformPermit(auth, "platform:reports:read");
  const resource =
    name === "bus-occupancy"
      ? "trips"
      : name === "operational-alerts"
        ? "alerts"
        : "bookings";
  const delegated = {
    ...auth,
    permissions: [
      ...new Set<Permission>([
        ...auth.permissions,
        resource === "bookings"
          ? "platform:bookings:read"
          : "platform:monitor:read",
      ]),
    ],
  };
  const original = await platformRows(
    delegated,
    resource,
    { ...q, ...(name === "payment-status" ? { status: undefined } : {}) },
    true,
  );
  if (name === "payment-status" && q.status)
    original.rows = original.rows.filter((r) => r.paymentStatus === q.status);
  if (name === "confirmed-cancelled")
    original.rows = original.rows.filter((r) =>
      ["Confirmed", "Cancelled"].includes(r.status),
    );
  if (name === "bus-occupancy")
    original.rows = original.rows.map((r) => ({
      ...r,
      occupancyPercent: r.total
        ? Math.round((r.booked * 10000) / r.total) / 100
        : 0,
    }));
  if (
    [
      "bus-occupancy",
      "confirmed-cancelled",
      "payment-status",
      "operational-alerts",
    ].includes(name)
  )
    return {
      ...original,
      total: original.rows.length,
      pages: Math.max(1, Math.ceil(original.rows.length / q.limit)),
      rows: exportAll
        ? original.rows
        : original.rows.slice((q.page - 1) * q.limit, q.page * q.limit),
    };
  const field: Record<string, string> = {
    "operator-performance": "operator",
    "agency-performance": "agency",
    "booking-source": "source",
    "route-bookings": "route",
  };
  if (!field[name])
    fail(
      404,
      "NOT_FOUND",
      "Operational report not found; finance reports use the existing Finance API",
    );
  const groups = new Map<string, any>();
  for (const row of original.rows) {
    const group = row[field[name]] || "Unknown",
      key =
        name === "operator-performance"
          ? row.operatorId
          : name === "agency-performance"
            ? row.operatorId + ":" + (row.agencyId || "direct")
            : group,
      g = groups.get(key) || {
        id: key,
        group,
        bookings: 0,
        confirmed: 0,
        cancelled: 0,
      };
    g.bookings++;
    if (row.status === "Confirmed") g.confirmed++;
    if (row.status === "Cancelled") g.cancelled++;
    groups.set(key, g);
  }
  const rows = [...groups.values()];
  return {
    rows: exportAll
      ? rows
      : rows.slice((q.page - 1) * q.limit, q.page * q.limit),
    total: rows.length,
    page: q.page,
    limit: q.limit,
    pages: Math.max(1, Math.ceil(rows.length / q.limit)),
  };
}
export function platformCsv(rows: any[]) {
  const fields: string[] = [
    ...new Set<string>(rows.flatMap((r) => Object.keys(r))),
  ];
  return csvDocument([
    fields,
    ...rows.map((r) =>
      fields.map((f) =>
        typeof r[f] === "object" ? JSON.stringify(r[f]) : r[f],
      ),
    ),
  ]);
}
