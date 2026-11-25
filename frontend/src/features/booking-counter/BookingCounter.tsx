import { PartnerSelector } from "./components/PartnerSelector";
import {
  ArrowLeftRight,
  ArrowRight,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  LockKeyhole,
  MapPin,
  Pause,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  Tag,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { api, ApiError } from "../../api/client.ts";
import { Badge, Panel } from "../../components/index.ts";
import {
  SeatMap,
  type InventorySeat,
} from "../../components/seats/SeatMap.tsx";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import { money } from "../../data/demo-data.ts";
import "../../styles/counter-crs.css";
import {
  counterApi,
  type CounterBooking,
  type CounterHold,
  type CounterPassenger,
  type CounterQuote,
  type CounterTrip,
  type PricingPolicy,
} from "./api/counter.api.ts";
import {
  ConfirmAction,
  ManifestDialog,
  ModifyDialog,
  PassengerFields,
  PaymentDialog,
  PricingDialog,
  TicketDialog,
} from "./components/CounterDialogs.tsx";
const sourceLabels: Record<string, string> = {
  operator: "Operator counter",
  customer: "AIBUS Customer App",
  agent: "Travel Agent Dashboard",
  external: "External API",
};
const time = (value?: string) =>
  value
    ? new Date(value).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Kolkata",
      })
    : "—";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const bookingOutcomeText = (status: string) =>
  status === "Confirmed"
    ? "Booking confirmed by the authoritative reservation system. Open the ticket in trip bookings below."
    : status === "Pending payment"
      ? "Booking saved. Seats are locked until the payment hold expires. Complete payment to confirm the booking and issue its ticket."
      : status === "Cancelled"
        ? "This booking has already been cancelled. Review trip bookings before creating another."
        : status === "Failed"
          ? "This booking failed or its hold expired. No ticket was issued."
          : "This booking needs reconciliation. Review its recorded status before creating a replacement.";
export function BookingCounter({
  navigationGuard,
}: {
  navigationGuard?: RefObject<((proceed: () => void) => void) | null>;
}) {
  const ws = useWorkspace(),
    allowed = (p: string) => ws.user.permissions.includes(p);
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [date, setDate] = useState(today),
    [trips, setTrips] = useState<CounterTrip[]>([]),
    [trip, setTrip] = useState<CounterTrip | null>(null),
    [searchPage, setSearchPage] = useState(1),
    [searchPages, setSearchPages] = useState(1),
    [searchTotal, setSearchTotal] = useState(0),
    [searching, setSearching] = useState(false),
    [hasSearched, setHasSearched] = useState(false),
    [searchError, setSearchError] = useState("");
  const [counterSources, setCounterSources] = useState<{
    tripId: string;
    counts: Record<string, number>;
  } | null>(null);
  const [counterView, setCounterView] = useState<"booking" | "bookings">(
    "booking",
  );
  const [manageInventory, setManageInventory] = useState(false);
  const [committed, setCommitted] = useState({
      from: "",
      to: "",
      journeyDate: today(),
    }),
    [seats, setSeats] = useState<InventorySeat[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [inventoryLoading, setInventoryLoading] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [hold, setHold] = useState<CounterHold | null>(null),
    [quote, setQuote] = useState<CounterQuote | null>(null),
    [quoting, setQuoting] = useState(false),
    [quoteError, setQuoteError] = useState(""),
    [promo, setPromo] = useState(""),
    [discount, setDiscount] = useState(""),
    [now, setNow] = useState(Date.now()),
    [policy, setPolicy] = useState<PricingPolicy | null>(null),
    [policyOpen, setPolicyOpen] = useState(false),
    [policyRevision, setPolicyRevision] = useState(0);
  const [passengers, setPassengers] = useState<
      Record<string, CounterPassenger>
    >({}),
    [salesPartnerId, setSalesPartnerId] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [gstEnabled, setGstEnabled] = useState(false),
    [gst, setGst] = useState({ number: "", company: "", address: "" }),
    [review, setReview] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [result, setResult] = useState<{
      reference: string;
      status: string;
      id: string;
      pnr?: string;
    } | null>(null),
    [refreshVersion, setRefreshVersion] = useState(0);
  const [operation, setOperation] = useState<
      | "stop"
      | "quota"
      | "quota-release"
      | "block"
      | "unblock"
      | "release-hold"
      | null
    >(null),
    [quotaLabel, setQuotaLabel] = useState(""),
    [chartOpen, setChartOpen] = useState(false),
    [fareOverrides, setFareOverrides] = useState<Record<string, string>>({}),
    [fareSaving, setFareSaving] = useState<string | null>(null),
    [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const searchRequest = useRef<AbortController | null>(null),
    activeHold = useRef<CounterHold | null>(null),
    inventoryRequest = useRef<AbortController | null>(null),
    bookingKey = useRef(""),
    pendingPayload = useRef<string | null>(null),
    currentTrip = useRef<string | null>(null),
    mounted = useRef(true),
    submitLock = useRef(false);
  useEffect(() => {
    setSalesPartnerId("");
  }, [hold?.holdId, trip?.id]);
  const seconds = hold
      ? Math.max(0, Math.ceil((Date.parse(hold.expiresAt) - now) / 1000))
      : 0,
    selectedSeats = seats.filter((s) => selected.includes(s.number)),
    selectionKey = [...selected].sort().join("|");
  const dirty =
    busy ||
    uncertain ||
    !!hold ||
    Object.values(passengers).some((p) => p.name?.trim());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      searchRequest.current?.abort();
      inventoryRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (hold && seconds === 0) {
      activeHold.current = null;
      setNotice("");
      setHold(null);
      setQuote(null);
      setReview(false);
      setSelected([]);
      setError(
        "Your seat hold expired. Passenger details are retained here; select seats and review a new quote.",
      );
      void loadInventory();
    }
  }, [seconds, hold?.holdId]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (!hold) return;
    const field = document.getElementById("counter-contact-phone");
    field?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    field?.focus({ preventScroll: true });
  }, [hold?.holdId]);
  useEffect(() => {
    if (!navigationGuard) return;
    navigationGuard.current = (proceed) => {
      if (dirty) setLeaveAction(() => proceed);
      else proceed();
    };
    return () => {
      navigationGuard.current = null;
    };
  }, [navigationGuard, dirty]);
  async function search(q = committed, page = 1, selectFirst = false) {
    if (!q.from.trim() || !q.to.trim() || !q.journeyDate) return;
    searchRequest.current?.abort();
    if (selectFirst) {
      setHasSearched(true);
      selectTrip(null);
      setTrips([]);
      setSearchTotal(0);
      setSearchPage(1);
      setSearchPages(1);
    }
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setSearchError("");
    try {
      const response = await counterApi.search(
        { ...q, page },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setTrips(response.data);
      setSearchPage(page);
      setSearchPages(response.meta?.pages || 1);
      setSearchTotal(response.meta?.total || 0);
      if (selectFirst && !hold) {
        selectTrip(response.data.find((t) => t.capabilities.inventory) || null);
      } else if (trip) {
        const fresh = response.data.find((t) => t.id === trip.id);
        if (fresh) setTrip(fresh);
      }
    } catch (e) {
      if (!controller.signal.aborted) setSearchError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }
  function selectTrip(value: CounterTrip | null) {
    if (hold || busy || uncertain) return;
    currentTrip.current = value?.id || null;
    setTrip(value);
    setManageInventory(false);
    setSeats([]);
    setSelected([]);
    setQuote(null);
    setError("");
    setQuoteError("");
    setPassengers({});
    setResult(null);
    setNotice("");
    setPromo("");
    setDiscount("");
  }
  async function loadInventory() {
    const id = currentTrip.current;
    if (!id) {
      setSeats([]);
      return;
    }
    inventoryRequest.current?.abort();
    const controller = new AbortController();
    inventoryRequest.current = controller;
    setInventoryLoading(true);
    try {
      const response = await counterApi.seats(id, controller.signal);
      if (controller.signal.aborted || currentTrip.current !== id) return;
      setSeats(response.data.seats);
      setSelected((old) =>
        old.filter((n) =>
          response.data.seats.some(
            (s) =>
              s.number === n &&
              (activeHold.current?.seats.includes(n) ||
                ["available", "blocked", "quota"].includes(s.state)),
          ),
        ),
      );
    } catch (e) {
      if (!controller.signal.aborted && currentTrip.current === id) {
        setError((e as Error).message);
        setSeats([]);
      }
    } finally {
      if (!controller.signal.aborted) setInventoryLoading(false);
    }
  }

  async function saveCustomSeatFare(seatNum: string) {
    if (!trip) return;
    const val = Number(fareOverrides[seatNum]);
    if (isNaN(val) || val < 0) {
      setError("Please enter a valid non-negative fare amount");
      return;
    }
    setFareSaving(seatNum);
    setError("");
    try {
      const paiseVal = Math.round(val * 100);
      await api(`/operator/trips/${trip.id}/seat-fares`, {
        method: "PATCH",
        body: JSON.stringify({ seatFares: { [seatNum]: paiseVal } }),
      });
      setNotice(`Seat ${seatNum} fare updated to ₹${val}.`);
      await loadInventory();
      setPolicyRevision((v) => v + 1);
    } catch (e: any) {
      setError(e.message || "Failed to update seat fare");
    } finally {
      setFareSaving(null);
    }
  }

  useEffect(() => {
    void loadInventory();
    if (!trip) return;
    const interval = setInterval(() => {
      void loadInventory();
      void search(committed, searchPage);
    }, 15000);
    return () => {
      clearInterval(interval);
      inventoryRequest.current?.abort();
    };
  }, [
    trip?.id,
    ws.revision,
    hold?.holdId,
    committed.from,
    committed.to,
    committed.journeyDate,
    searchPage,
  ]);
  useEffect(() => {
    let active = true;
    counterApi
      .policy()
      .then((r) => {
        if (active) setPolicy(r.data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [policyRevision, ws.revision]);
  useEffect(() => {
    if (uncertain) return;
    setReview(false);
    setQuote(null);
    setQuoteError("");
    setQuoting(false);
    if (
      !trip ||
      !selected.length ||
      !allowed("bookings:write") ||
      selectedSeats.some((s) => !["available", "held"].includes(s.state)) ||
      trip.inventoryOwner !== "internal"
    )
      return;
    const controller = new AbortController();
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const response = await counterApi.quote(
          trip.id,
          {
            seats: selected,
            ...(hold ? { holdId: hold.holdId } : {}),
            ...(promo.trim() ? { promoCode: promo.trim().toUpperCase() } : {}),
            operatorDiscountPaise: Math.round(Number(discount || 0) * 100),
          },
          controller.signal,
        );
        if (!controller.signal.aborted) setQuote(response.data);
      } catch (e) {
        if (!controller.signal.aborted) setQuoteError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setQuoting(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    trip?.id,
    selectionKey,
    promo,
    discount,
    hold?.holdId,
    policyRevision,
    ws.revision,
    uncertain,
    selectedSeats.map((s) => s.state).join("|"),
  ]);
  useEffect(() => {
    if (quote && Date.parse(quote.expiresAt) <= now) {
      setQuote(null);
      setReview(false);
      setQuoteError("Quote expired. Refresh pricing to continue.");
    }
  }, [now, quote?.quoteId]);
  function toggle(number: string) {
    if (hold || busy) return;
    const seat = seats.find((s) => s.number === number);
    if (
      !seat ||
      (seat.state !== "available" &&
        !(
          manageInventory &&
          allowed("inventory:write") &&
          ["blocked", "quota"].includes(seat.state)
        ))
    )
      return;
    setResult(null);
    setNotice("");
    setSelected((old) =>
      old.includes(number)
        ? old.filter((n) => n !== number)
        : old.length >= 6
          ? (setError("Select up to six seats per booking."), old)
          : [...old, number],
    );
  }
  async function refreshAll() {
    await loadInventory();
    await search(committed, searchPage);
    setRefreshVersion((v) => v + 1);
    void ws.refresh();
  }
  async function acquireHold() {
    if (!trip || !quote || busy || !freeSelection) return;
    setBusy(true);
    setError("");
    const id = trip.id;
    try {
      const response = await counterApi.hold(id, selected);
      if (!mounted.current) return;
      activeHold.current = response.data;
      pendingPayload.current = null;
      setHold(response.data);
      bookingKey.current = crypto.randomUUID();
      setPassengers((old) =>
        Object.fromEntries(
          selected.map((seat) => [
            seat,
            old[seat] || {
              seat,
              name: "",
              boarding:
                trip.boarding.length === 1 ? trip.boarding[0].name : undefined,
              dropping:
                trip.dropping.length === 1 ? trip.dropping[0].name : undefined,
            },
          ]),
        ),
      );
      setNotice(
        "Seats held. Complete passenger details and review the final server quote.",
      );
      await loadInventory();
    } catch (e) {
      setError((e as Error).message);
      await loadInventory();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function releaseHold() {
    if (uncertain)
      throw new Error(
        "Resolve the pending booking request before releasing its seats.",
      );
    if (!trip || !hold) return;
    try {
      await counterApi.release(trip.id, hold.holdId);
    } catch (e) {
      if (!(
        e instanceof ApiError &&
        e.status === 404 &&
        Date.now() >= Date.parse(hold.expiresAt)
      ))
        throw e;
    }
    activeHold.current = null;
    setHold(null);
    setNotice(
      "Hold released. Those seats are available to other booking channels.",
    );
    setQuote(null);
    setSelected([]);
    setReview(false);
    await loadInventory();
  }
  function validateForm() {
    if (!hold || !quote || !trip) {
      setError("Hold the selected seats and wait for a current server quote.");
      return false;
    }
    if (!/^\+?[\d\s-]{10,16}$/.test(phone)) {
      setError("Enter a valid booking contact mobile number.");
      document.getElementById("counter-contact-phone")?.focus();
      return false;
    }
    for (const seat of selected) {
      const p = passengers[seat];
      if (!p?.name?.trim()) {
        setError(`Enter the full passenger name for seat ${seat}.`);
        document.getElementById(`counter-passenger-name-${seat}`)?.focus();
        return false;
      }
      if (!p.boarding || !p.dropping) {
        setError(`Choose boarding and dropping points for seat ${seat}.`);
        return false;
      }
      if (quote.pricing.requirements.age && p.age === undefined) {
        setError(`Enter passenger age for seat ${seat}.`);
        return false;
      }
      if (quote.pricing.requirements.gender && !p.gender) {
        setError(`Choose passenger gender for seat ${seat}.`);
        return false;
      }
    }
    setError("");
    return true;
  }
  async function create() {
    if (
      !trip ||
      (!pendingPayload.current && (!hold || !quote)) ||
      submitLock.current
    )
      return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!pendingPayload.current)
        pendingPayload.current = JSON.stringify({
          tripId: trip.id,
          holdId: hold!.holdId,
          ...(salesPartnerId ? { salesPartnerId } : {}),
          quoteId: quote!.quoteId,
          passengers: selected.map((seat) => ({
            ...passengers[seat],
            phone: passengers[seat].phone || phone,
          })),
          contact: { phone, email: email || undefined },
          ...(gstEnabled ? { gst } : {}),
          ...(promo.trim() ? { promoCode: promo.trim().toUpperCase() } : {}),
          operatorDiscountPaise: Math.round(Number(discount || 0) * 100),
        });
      const response = await api<any>("/operator/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": bookingKey.current },
        body: pendingPayload.current,
      });
      setResult({
        id: String(response.data._id),
        reference: response.data.reference,
        status: response.data.status,
        pnr: response.data.pnr,
      });
      activeHold.current = null;
      pendingPayload.current = null;
      setUncertain(false);
      setHold(null);
      setSelected([]);
      setPassengers({});
      setPhone("");
      setEmail("");
      setGst({ number: "", company: "", address: "" });
      setGstEnabled(false);
      setReview(false);
      setNotice(bookingOutcomeText(response.data.status));
      await refreshAll();
    } catch (e) {
      const unknown =
        !(e instanceof ApiError) ||
        e.code === "INVALID_RESPONSE" ||
        e.status === 0 ||
        e.status >= 500 ||
        e.status === 408 ||
        e.status === 429;
      setUncertain(unknown);
      setNotice("");
      if (!unknown) {
        pendingPayload.current = null;
        bookingKey.current = crypto.randomUUID();
      }
      setError(
        unknown
          ? "Booking outcome could not be verified. Recover the original request before editing or releasing seats."
          : (e as Error).message,
      );
      setReview(false);
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }
  async function executeOperation() {
    if (!trip) return;
    setBusy(true);
    setError("");
    try {
      if (operation === "release-hold") await releaseHold();
      else if (operation === "stop") {
        const response = await api<{ bookingOpen: boolean; version: number }>(
          `/operator/trips/${trip.id}/booking-status`,
          {
            method: "PATCH",
            body: JSON.stringify({
              open: !trip.bookingOpen,
              expectedVersion: trip.version,
            }),
          },
        );
        setTrip({
          ...trip,
          bookingOpen: response.data.bookingOpen,
          version: response.data.version,
        });
        setNotice(
          response.data.bookingOpen
            ? "New bookings resumed."
            : "New bookings stopped. Existing pending payments and confirmed tickets remain valid.",
        );
      } else if (operation === "quota" || operation === "quota-release") {
        await api(`/operator/trips/${trip.id}/quota`, {
          method: "POST",
          body: JSON.stringify({
            seats: selected,
            action: operation === "quota" ? "assign" : "release",
            ...(operation === "quota" ? { label: quotaLabel } : {}),
          }),
        });
        setSelected([]);
        setNotice("Quota allocation updated.");
      } else if (operation) {
        await api(
          `/operator/trips/${trip.id}/${operation === "block" ? "block" : "unblock"}`,
          { method: "POST", body: JSON.stringify({ seats: selected }) },
        );
        setSelected([]);
        setNotice(
          operation === "block"
            ? "Selected seats blocked."
            : "Selected seats released.",
        );
      }
      setOperation(null);
      await refreshAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const freeSelection =
    selected.length > 0 &&
    selectedSeats.length === selected.length &&
    selectedSeats.every((s) => s.state === "available");
  return (
    <div className="booking-counter counter-crs">
      {uncertain && (
        <div className="counter-alert" role="alert">
          Booking response unavailable. Retrying reuses the original request and
          idempotency key.
          <button className="btn" disabled={busy} onClick={() => void create()}>
            {busy ? "Checking…" : "Recover booking request"}
          </button>
        </div>
      )}
      <div className="counter-topline">
        <div className="counter-topline-left">
          <span className="counter-session">
            <ShieldCheck size={14} />
            Booking counter
            <span className="car-topline-badge">
              <span className="car-badge-live">LIVE</span>
              Car Central Reservation System
            </span>
          </span>
          <div className="counter-nav-pills" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={counterView === "booking"}
              className={`counter-nav-pill ${counterView === "booking" ? "active" : ""}`}
              onClick={() => setCounterView("booking")}
            >
              <Ticket size={13} />
              Reservation Console
            </button>
            {trip && (
              <button
                type="button"
                role="tab"
                aria-selected={counterView === "bookings"}
                className={`counter-nav-pill ${counterView === "bookings" ? "active" : ""}`}
                onClick={() => setCounterView("bookings")}
              >
                <Users size={13} />
                Trip Bookings & PNRs
                {counterSources && (
                  <span className="counter-tab-badge">
                    {Object.values(counterSources.counts).reduce(
                      (a, b) => a + b,
                      0,
                    )}
                  </span>
                )}
              </button>
            )}
          </div>
          <span className="counter-timezone">All journey times in IST</span>
        </div>
        <button
          className="text-btn"
          onClick={() => setPolicyOpen(true)}
          disabled={!allowed("pricing:write")}
        >
          <Settings2 size={14} />
          Pricing rules
        </button>
      </div>
      {notice && (
        <div className="counter-alert success" role="status">
          <CheckCircle2 size={17} />
          {notice}
          <button
            aria-label="Dismiss counter notice"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="counter-alert error" role="alert">
          {error}
          <button
            aria-label="Dismiss counter error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div
        className={`counter-workbench${trip ? " has-trip" : ""}`}
        hidden={counterView !== "booking"}
      >
        <div className="counter-left">
          <SeatMap
            variant="counter-chart"
            title={
              trip
                ? `Vehicle : ${trip.registration || (trip.busName && trip.busName !== "Bus unavailable" ? trip.busName : "Car Fleet")} (${trip.busType || "Car"})`
                : "Vehicle : Select a trip"
            }
            seats={seats}
            selected={selected}
            onToggle={toggle}
            disabled={busy || !!hold || uncertain}
            loading={inventoryLoading}
            onRefresh={() => void loadInventory()}
            selectable={
              manageInventory && allowed("inventory:write")
                ? ["blocked", "quota"]
                : allowed("bookings:write") || allowed("inventory:write")
                  ? ["available"]
                  : []
            }
            heldSeats={hold?.seats}
          />
          {trip && allowed("inventory:write") && (
            <div className="counter-alert">
              <span>
                {manageInventory
                  ? "Management mode: blocked/quota seats can only be released, not booked."
                  : "Booking mode: only green available seats can be reserved."}
              </span>
              <button
                className="btn"
                aria-pressed={manageInventory}
                disabled={busy || !!hold || uncertain}
                onClick={() => {
                  setManageInventory((v) => !v);
                  setSelected([]);
                }}
              >
                {manageInventory
                  ? "Return to booking"
                  : "Manage blocked / quota seats"}
              </button>
            </div>
          )}
          <div
            className="crs-channel-summary"
            aria-label="Booking channel counts"
          >
            {Object.entries(sourceLabels).map(([key, label]) => (
              <div key={key}>
                <span>{label}</span>
                <strong>
                  {trip && counterSources?.tripId === trip.id
                    ? (counterSources?.counts[key] ?? 0)
                    : "—"}
                </strong>
              </div>
            ))}
          </div>
          {trip && (
            <Panel
              title="Trip controls"
              aside={
                <Badge
                  value={
                    trip.bookingOpen ? "Open for booking" : "Booking stopped"
                  }
                />
              }
            >
              <div className="counter-controls" inert={uncertain}>
                {allowed("inventory:write") && (
                  <>
                    <button
                      className="btn"
                      disabled={busy || !!hold || !freeSelection}
                      onClick={() => setOperation("block")}
                    >
                      <LockKeyhole size={14} />
                      Block seats
                    </button>
                    <button
                      className="btn"
                      disabled={
                        busy ||
                        !!hold ||
                        !selected.length ||
                        !selectedSeats.every((s) => s.state === "blocked")
                      }
                      onClick={() => setOperation("unblock")}
                    >
                      Unblock seats
                    </button>
                    <button
                      className="btn"
                      disabled={busy || !!hold || !freeSelection}
                      onClick={() => {
                        setQuotaLabel("");
                        setOperation("quota");
                      }}
                    >
                      Assign quota
                    </button>
                    <button
                      className="btn"
                      disabled={
                        busy ||
                        !!hold ||
                        !selected.length ||
                        !selectedSeats.every((s) => s.state === "quota")
                      }
                      onClick={() => setOperation("quota-release")}
                    >
                      Release quota
                    </button>
                  </>
                )}
                {allowed("manifest:read") && (
                  <button className="btn" onClick={() => setChartOpen(true)}>
                    <Users size={14} />
                    Passenger chart
                  </button>
                )}
                {allowed("routes:write") && (
                  <button
                    className="btn counter-stop"
                    disabled={
                      busy || !!hold || trip.inventoryOwner !== "internal"
                    }
                    onClick={() => setOperation("stop")}
                  >
                    {trip.bookingOpen ? (
                      <Pause size={14} />
                    ) : (
                      <Play size={14} />
                    )}
                    {trip.bookingOpen ? "Stop booking" : "Resume booking"}
                  </button>
                )}
              </div>
            </Panel>
          )}
          <div className="counter-footnote">
            <LockKeyhole size={13} />
            Seat holds and confirmations share the existing booking engine.
          </div>
        </div>
        <div className="counter-right" inert={uncertain}>
          <Panel title="Find a trip">
            <div className="crs-route-heading">
              {trip
                ? `${trip.source} — ${trip.destination}`
                : "Route & journey search"}
            </div>
            <form
              className="counter-search"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (hold || busy || uncertain) return;
                const q = {
                  from: from.trim(),
                  to: to.trim(),
                  journeyDate: date,
                };
                if (!q.from || !q.to || !q.journeyDate) {
                  setSearchError(
                    "Enter origin, destination and journey date, then search trips.",
                  );
                  document
                    .querySelector<HTMLInputElement>(
                      !q.from
                        ? '[aria-label="Counter from"]'
                        : !q.to
                          ? '[aria-label="Counter to"]'
                          : '[aria-label="Counter journey date"]',
                    )
                    ?.focus();
                  return;
                }
                setCommitted(q);
                void search(q, 1, true);
              }}
            >
              <div className="counter-fields">
                <label>
                  From
                  <div className="counter-input">
                    <MapPin size={14} />
                    <input
                      aria-label="Counter from"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      placeholder="Origin city"
                      disabled={!!hold || busy}
                    />
                    {from && (
                      <button
                        type="button"
                        aria-label="Clear origin"
                        disabled={!!hold}
                        onClick={() => setFrom("")}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </label>
                <button
                  type="button"
                  className="crs-swap"
                  aria-label="Swap origin and destination"
                  disabled={!!hold || busy}
                  onClick={() => {
                    setFrom(to);
                    setTo(from);
                  }}
                >
                  <ArrowLeftRight size={20} />
                </button>
                <label>
                  To
                  <div className="counter-input">
                    <MapPin size={14} />
                    <input
                      aria-label="Counter to"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      placeholder="Destination city"
                      disabled={!!hold || busy}
                    />
                    {to && (
                      <button
                        type="button"
                        aria-label="Clear destination"
                        disabled={!!hold}
                        onClick={() => setTo("")}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </label>
                <label>
                  Journey date
                  <input
                    aria-label="Counter journey date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={!!hold || busy}
                  />
                </label>
                <button
                  className="btn primary counter-search-button"
                  disabled={searching || !!hold || busy}
                >
                  <Search size={15} />
                  {searching ? "Searching…" : "Search trips"}
                </button>
              </div>
            </form>
            <div className="crs-service-toolbar">
              <button
                className="btn"
                onClick={() => setPolicyOpen(true)}
                disabled={!allowed("pricing:write")}
              >
                <Settings2 size={14} />
                Discount policy
              </button>
              <strong>
                {trip
                  ? `${trip.busName && trip.busName !== "Bus unavailable" ? trip.busName : trip.registration || "Car"} · ${trip.busType} · ${trip.journeyDate} · ${time(trip.departureAt)} IST`
                  : "Select a departure to begin booking"}
              </strong>
              <button
                className="btn"
                disabled={!trip || !allowed("manifest:read")}
                onClick={() => setChartOpen(true)}
              >
                <Users size={14} />
                View chart
              </button>
            </div>
            <div className="crs-trip-columns" aria-hidden="true">
              <span>Departure / Route</span>
              <span>Service / Car</span>
              <span>Seats / Fare</span>
            </div>
            {searchError && (
              <div className="counter-alert error" role="alert">
                {searchError}
                {hasSearched && (
                  <button
                    className="text-btn"
                    onClick={() => void search(committed, searchPage)}
                  >
                    Retry search
                  </button>
                )}
              </div>
            )}
            <div className="counter-trip-results" aria-busy={searching}>
              {!trips.length && !searching ? (
                <div className="counter-empty">
                  {hasSearched
                    ? "No authorized trips for this search. Try another date or route."
                    : "Enter origin, destination and journey date, then select Search trips to view scheduled cars."}
                </div>
              ) : (
                trips.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    disabled={busy || !!hold || !t.capabilities.inventory}
                    className={`counter-trip-option ${trip?.id === t.id ? "selected" : ""}`}
                    aria-pressed={trip?.id === t.id}
                    onClick={() => selectTrip(t)}
                  >
                    <div className="counter-trip-option-head">
                      <strong>
                        {t.busName && t.busName !== "Bus unavailable"
                          ? t.busName
                          : t.registration
                            ? `Car (${t.registration})`
                            : "Car"}
                      </strong>
                      <span>
                        {t.availableSeats ?? "—"} / {t.totalSeats ?? "—"}{" "}
                        available
                      </span>
                    </div>
                    <div className="counter-route-line">
                      <b>{time(t.departureAt)}</b>
                      <span>{t.source}</span>
                      <ArrowRight size={13} />
                      <span>{t.destination}</span>
                      <b>{time(t.arrivalAt)}</b>
                    </div>
                    <div className="counter-trip-option-foot">
                      <span>
                        {t.registration} · {t.busType}
                      </span>
                      <strong>
                        {t.baseFarePaise === null
                          ? "Provider unavailable"
                          : money(t.baseFarePaise / 100)}
                      </strong>
                    </div>
                    <small>
                      Trip {t.id.slice(-8).toUpperCase()} ·{" "}
                      {t.bookingOpen ? "Open for booking" : "Booking stopped"}
                    </small>
                  </button>
                ))
              )}
            </div>
            <div className="counter-search-footer">
              <span>
                {hasSearched
                  ? `${searchTotal} matching trips`
                  : "No search submitted"}
              </span>
              <div>
                <button
                  className="icon-btn"
                  aria-label="Previous trip results"
                  disabled={searchPage <= 1 || searching || !!hold}
                  onClick={() => void search(committed, searchPage - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                <span>
                  {searchPage} / {searchPages}
                </span>
                <button
                  className="icon-btn"
                  aria-label="Next trip results"
                  disabled={searchPage >= searchPages || searching || !!hold}
                  onClick={() => void search(committed, searchPage + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </Panel>
          <div className="counter-action-split">
            <Panel
              title="Fare details"
              className="crs-fare-panel"
              aside={
                <span className="counter-source-pill">
                  Operator counter · INR
                </span>
              }
            >
              <p className="crs-section-hint" role="status">
                {result
                  ? "Booking saved. Review its recorded status below."
                  : hold
                    ? "Seats held. Complete passenger details to save your booking."
                    : selected.length
                      ? "Next: hold these seats, then enter passenger details."
                      : "Step 1: Search a trip and select green available seats."}
              </p>
              <div className="crs-fare-grid">
                {[
                  ["Seats", String(selected.length)],
                  [
                    "Seat type",
                    selectedSeats.length
                      ? [...new Set(selectedSeats.map((s) => s.category))].join(
                          " / ",
                        )
                      : "—",
                  ],
                  [
                    "Base fare",
                    quote
                      ? money(quote.pricing.grossPaise / 100)
                      : selected.length &&
                          selectedSeats.length === selected.length
                        ? money(
                            selectedSeats.reduce(
                              (sum, seat) => sum + seat.farePaise,
                              0,
                            ) / 100,
                          )
                        : "—",
                  ],
                  [
                    "Discount",
                    quote ? money(quote.pricing.discountPaise / 100) : "—",
                  ],
                  [
                    "Charges",
                    quote ? money(quote.pricing.chargePaise / 100) : "—",
                  ],
                  ["Tax", quote ? money(quote.pricing.taxPaise / 100) : "—"],
                  [
                    "Grand total",
                    quote ? money(quote.pricing.totalPaise / 100) : "—",
                  ],
                ].map(([label, value]) => (
                  <label key={label}>
                    {label}
                    <output>{value}</output>
                  </label>
                ))}
              </div>
              {quoteError && (
                <div className="counter-alert error" role="alert">
                  <span>
                    {quoteError} The base fare above is a preview; the final
                    total requires a validated quote.
                  </span>
                  {allowed("pricing:write") && !policy && (
                    <button className="btn" onClick={() => setPolicyOpen(true)}>
                      Configure pricing
                    </button>
                  )}
                  <button
                    className="text-btn"
                    onClick={() => setPolicyRevision((v) => v + 1)}
                  >
                    Retry calculation
                  </button>
                </div>
              )}
              {!quote && !quoteError && (
                <p className="crs-section-hint">
                  {quoting
                    ? "Validating fares…"
                    : selected.length
                      ? "Base fare preview from selected seats. Final charges and total require a validated quote."
                      : "Select available seats to calculate the fare."}
                </p>
              )}
              {trip &&
                selected.length > 0 &&
                !hold &&
                allowed("bookings:write") && (
                  <div
                    className="counter-fare-override-card"
                    style={{
                      margin: "8px 0 10px",
                      padding: "8px 10px",
                      background: "#f8fafc",
                      border: "1.5px solid #cbd5e1",
                      borderRadius: "6px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#0f172a",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <Tag size={13} color="#2563eb" />
                        Operator Seat Price Control (Exclusive)
                      </span>
                      <span style={{ fontSize: "10px", color: "#64748b" }}>
                        Edit seat fare directly
                      </span>
                    </div>
                    <div
                      style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}
                    >
                      {selected.map((seatNum) => {
                        const curSeat = seats.find((s) => s.number === seatNum);
                        const currentVal =
                          fareOverrides[seatNum] ??
                          (curSeat ? String(curSeat.farePaise / 100) : "");
                        return (
                          <div
                            key={seatNum}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              background: "#ffffff",
                              padding: "3px 6px",
                              borderRadius: "4px",
                              border: "1px solid #94a3b8",
                            }}
                          >
                            <strong
                              style={{ fontSize: "11px", color: "#1e293b" }}
                            >
                              {seatNum}:
                            </strong>
                            <span
                              style={{ fontSize: "11px", color: "#64748b" }}
                            >
                              ₹
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="10"
                              style={{
                                width: "60px",
                                padding: "2px 4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                color: "#0f172a",
                                border: "1px solid #cbd5e1",
                                borderRadius: "3px",
                              }}
                              value={currentVal}
                              onChange={(e) =>
                                setFareOverrides({
                                  ...fareOverrides,
                                  [seatNum]: e.target.value,
                                })
                              }
                            />
                            <button
                              type="button"
                              className="btn primary"
                              style={{
                                padding: "2px 6px",
                                fontSize: "10px",
                                height: "22px",
                                minHeight: "22px",
                                cursor: "pointer",
                              }}
                              disabled={busy || fareSaving === seatNum}
                              onClick={() => void saveCustomSeatFare(seatNum)}
                            >
                              {fareSaving === seatNum ? "…" : "Set"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              {trip && !hold && allowed("bookings:write") && (
                <div className="counter-summary" style={{ paddingTop: "4px" }}>
                  <button
                    className="btn primary full"
                    disabled={
                      !quote ||
                      quoting ||
                      busy ||
                      !freeSelection ||
                      !trip.bookingOpen
                    }
                    onClick={() => void acquireHold()}
                  >
                    <LockKeyhole size={15} />
                    {busy ? "Reserving seats…" : "Hold seats & add passengers"}
                  </button>
                  {!trip.bookingOpen && (
                    <p className="error">
                      This trip is closed for new bookings.
                    </p>
                  )}
                </div>
              )}
              {hold ? (
                <div
                  className="counter-hold-state"
                  style={{ margin: "6px 12px 10px" }}
                >
                  <span>
                    <Clock size={14} />
                    Seats held for {Math.floor(seconds / 60)}:
                    {String(seconds % 60).padStart(2, "0")}
                  </span>
                  <button
                    className="text-btn"
                    disabled={busy}
                    onClick={() => setOperation("release-hold")}
                  >
                    Release hold
                  </button>
                </div>
              ) : null}
            </Panel>

            {result ? (
              <Panel title="Booking recorded">
                <div className="counter-summary">
                  <Badge value={result.status} />
                  <h3 className="counter-result-reference">
                    {result.reference}
                  </h3>
                  {(result as any).pnr && (
                    <div className="detail-row" style={{ marginTop: "8px" }}>
                      <span>PNR</span>
                      <strong>{(result as any).pnr}</strong>
                    </div>
                  )}
                  <p className="counter-availability-note">
                    {bookingOutcomeText(result.status)}
                  </p>
                  {result.status === "Pending payment" && !["agent", "booking_staff"].includes(ws.user.role) && (
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        marginTop: "12px",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const res = await counterApi.confirmDirect(
                              result.id,
                            );
                            setResult({
                              ...result,
                              status: res.data.status,
                              pnr: res.data.pnr,
                            });
                            setNotice("Booking confirmed and ticket issued!");
                            await refreshAll();
                          } catch (err: any) {
                            setError(
                              err.message || "Failed to confirm booking",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <CheckCircle2 size={14} />
                        Confirm cash received & book
                      </button>
                    </div>
                  )}
                  {result.status === "Confirmed" && (
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        marginTop: "12px",
                        flexWrap: "wrap",
                      }}
                    >
                      <a
                        href={`/api/v1/operator/bookings/${result.id}/ticket.html`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn primary"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          textDecoration: "none",
                        }}
                      >
                        <Ticket size={14} />
                        View & Print Ticket
                      </a>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setResult(null);
                          setSelected([]);
                          setHold(null);
                          setQuote(null);
                          setPassengers({});
                        }}
                      >
                        Book Next Seat
                      </button>
                    </div>
                  )}
                </div>
              </Panel>
            ) : hold && trip ? (
              <Panel
                title="Passenger & contact details"
                aside={
                  <span className="count">{selected.length} passengers</span>
                }
              >
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (validateForm()) setReview(true);
                  }}
                >
                  <div className="counter-passenger-body">
                    {error && (
                      <p className="counter-alert error" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="counter-fields">
                      <PartnerSelector
                        value={salesPartnerId}
                        onChange={setSalesPartnerId}
                      />
                      <label>
                        Booking contact mobile
                        <input
                          id="counter-contact-phone"
                          aria-label="Booking contact mobile"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Email · optional
                        <input
                          aria-label="Booking contact email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          autoComplete="off"
                        />
                      </label>
                    </div>
                    <PassengerFields
                      seats={selected}
                      values={passengers}
                      onChange={setPassengers}
                      trip={trip}
                      requireAge={quote?.pricing.requirements.age}
                      requireGender={quote?.pricing.requirements.gender}
                    />
                    {quote?.pricing.requirements.gstEnabled && (
                      <>
                        <label className="counter-check">
                          <input
                            type="checkbox"
                            checked={gstEnabled}
                            onChange={(e) => setGstEnabled(e.target.checked)}
                          />
                          Include GST details
                        </label>
                        {gstEnabled && (
                          <div className="counter-fields">
                            {(["number", "company", "address"] as const).map(
                              (key) => (
                                <label key={key}>
                                  GST {key}
                                  <input
                                    value={gst[key]}
                                    onChange={(e) =>
                                      setGst({
                                        ...gst,
                                        [key]:
                                          key === "number"
                                            ? e.target.value.toUpperCase()
                                            : e.target.value,
                                      })
                                    }
                                  />
                                </label>
                              ),
                            )}
                          </div>
                        )}
                      </>
                    )}
                    <button
                      className="btn primary full"
                      disabled={busy || quoting || !quote || seconds === 0}
                    >
                      Review booking
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </form>
              </Panel>
            ) : trip ? (
              <Panel
                title="Booking summary"
                aside={
                  <span className="counter-source-pill">Operator counter</span>
                }
              >
                <div className="counter-summary">
                  <div className="counter-journey">
                    <Car size={18} />
                    <div>
                      <strong>{trip.route}</strong>
                      <span>
                        {trip.registration} · {trip.journeyDate} ·{" "}
                        {time(trip.departureAt)}–{time(trip.arrivalAt)} IST
                      </span>
                    </div>
                  </div>
                  <div className="counter-selected-row">
                    <span>Selected seats</span>
                    <div>
                      {selected.length ? (
                        selected.map((s) => (
                          <span className="counter-seat-chip" key={s}>
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="muted">No seats selected</span>
                      )}
                    </div>
                  </div>
                  {allowed("bookings:write") && (
                    <div className="counter-fields counter-discounts">
                      <label>
                        Coupon · optional
                        <div className="counter-input">
                          <Tag size={13} />
                          <input
                            aria-label="Counter coupon"
                            value={promo}
                            onChange={(e) =>
                              setPromo(e.target.value.toUpperCase())
                            }
                            placeholder="Promo code"
                            disabled={busy}
                          />
                        </div>
                      </label>
                      {allowed("pricing:write") &&
                        policy &&
                        policy.operatorDiscountMaxPaise > 0 && (
                          <label>
                            Operator discount · INR
                            <input
                              aria-label="Operator discount"
                              type="number"
                              min="0"
                              step="0.01"
                              value={discount}
                              onChange={(e) => setDiscount(e.target.value)}
                              disabled={busy}
                              placeholder={`Max ${policy.operatorDiscountMaxPaise / 100}`}
                            />
                          </label>
                        )}
                    </div>
                  )}
                  {quoting ? (
                    <div className="counter-quote-state" role="status">
                      Validating fares and pricing rules…
                    </div>
                  ) : quoteError ? (
                    <p className="crs-section-hint">
                      Resolve the pricing issue in Fare details to continue.
                    </p>
                  ) : quote ? (
                    <>
                      <div className="counter-fare-lines">
                        {quote.pricing.seatFares.map((s) => (
                          <div key={s.number}>
                            <span>Seat {s.number} · base fare</span>
                            <strong>{money(s.basePaise / 100)}</strong>
                          </div>
                        ))}
                        <div>
                          <span>Discount</span>
                          <strong>
                            −{money(quote.pricing.discountPaise / 100)}
                          </strong>
                        </div>
                        <div>
                          <span>
                            Tax · {quote.pricing.taxBasisPoints / 100}%
                          </span>
                          <strong>{money(quote.pricing.taxPaise / 100)}</strong>
                        </div>
                        <div>
                          <span>Additional charges</span>
                          <strong>
                            {money(quote.pricing.chargePaise / 100)}
                          </strong>
                        </div>
                      </div>
                      <p className="counter-quote-note">
                        <ShieldCheck size={12} />
                        Server quote · valid until {time(quote.expiresAt)} IST
                      </p>
                    </>
                  ) : (
                    <div className="counter-quote-state">
                      Select available seats to request a server-validated fare.
                    </div>
                  )}
                  {!trip.bookingOpen && (
                    <div className="counter-alert">
                      New bookings are stopped for this trip.
                    </div>
                  )}
                  {hold ? (
                    <div className="counter-hold-state">
                      <span>
                        <Clock size={14} />
                        Seats held for {Math.floor(seconds / 60)}:
                        {String(seconds % 60).padStart(2, "0")}
                      </span>
                      <button
                        className="text-btn"
                        disabled={busy}
                        onClick={() => setOperation("release-hold")}
                      >
                        Release hold
                      </button>
                    </div>
                  ) : null}
                </div>
              </Panel>
            ) : (
              <Panel
                title="Passenger & contact details"
                className="crs-passenger-placeholder"
              >
                <div
                  className="crs-contact-preview"
                  aria-label="Passenger form preview"
                >
                  <label>
                    Mobile
                    <input
                      type="tel"
                      disabled
                      placeholder="Booking contact mobile"
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      disabled
                      placeholder="Email · optional"
                    />
                  </label>
                  <label>
                    Passenger name
                    <input disabled placeholder="Passenger name" />
                  </label>
                  <label>
                    GSTIN
                    <input disabled placeholder="GST details" />
                  </label>
                </div>
                <p className="crs-section-hint">
                  <LockKeyhole size={13} />
                  Hold selected seats to enter passenger details.
                </p>
              </Panel>
            )}
          </div>
        </div>
      </div>
      {trip && (
        <div style={{ display: counterView === "bookings" ? "block" : "none" }}>
          <TripBookings
            trip={trip}
            revision={refreshVersion + ws.revision}
            onRefresh={() => void refreshAll()}
            onSourceCounts={setCounterSources}
          />
        </div>
      )}
      {policyOpen && (
        <PricingDialog
          policy={policy}
          onClose={() => setPolicyOpen(false)}
          onSaved={() => {
            setPolicyRevision((v) => v + 1);
            ws.notify("Counter pricing rules saved");
          }}
        />
      )}
      {chartOpen && trip && (
        <ManifestDialog trip={trip} onClose={() => setChartOpen(false)} />
      )}
      {review && quote && (
        <ConfirmAction
          title="Review counter booking"
          description="Create a pending booking. Seats are confirmed only after verified payment, approved agency funding, or operator confirmation of cash received."
          action="Create pending booking"
          busy={busy}
          onClose={() => setReview(false)}
          onConfirm={() => void create()}
        >
          <div className="detail-row">
            <span>Seats</span>
            <strong>{selected.join(", ")}</strong>
          </div>
          <div className="detail-row">
            <span>Booking contact</span>
            <strong>{phone}</strong>
          </div>
          <div className="detail-row">
            <span>Total payable</span>
            <strong>{money(quote.pricing.totalPaise / 100)}</strong>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </ConfirmAction>
      )}
      {operation && (
        <ConfirmAction
          title={
            operation === "stop"
              ? trip?.bookingOpen
                ? "Stop new bookings?"
                : "Resume new bookings?"
              : operation === "release-hold"
                ? "Release held seats?"
                : operation === "quota"
                  ? "Assign quota seats?"
                  : operation === "quota-release"
                    ? "Release quota seats?"
                    : operation === "block"
                      ? "Block selected seats?"
                      : "Unblock selected seats?"
          }
          description={
            operation === "stop"
              ? "This changes whether new holds and bookings are accepted. It does not cancel existing confirmed tickets or previously created pending payments."
              : operation === "release-hold"
                ? "The seats will become available to other booking channels. Passenger details will remain in this counter until you leave."
                : `Apply this action to ${selected.join(", ")} on ${trip?.route}. Confirmed and actively held seats cannot be reassigned.`
          }
          action={
            operation === "stop"
              ? trip?.bookingOpen
                ? "Stop booking"
                : "Resume booking"
              : operation === "release-hold"
                ? "Release hold"
                : operation === "quota"
                  ? "Assign quota"
                  : operation === "quota-release"
                    ? "Release quota"
                    : operation === "block"
                      ? "Block seats"
                      : "Unblock seats"
          }
          busy={busy}
          onClose={() => setOperation(null)}
          onConfirm={() => void executeOperation()}
        >
          {operation === "quota" && (
            <label className="counter-quota-label">
              Quota name
              <input
                value={quotaLabel}
                onChange={(e) => setQuotaLabel(e.target.value)}
                placeholder="e.g. Crew allocation"
              />
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </ConfirmAction>
      )}
      {leaveAction && (
        <ConfirmAction
          title="Leave booking counter?"
          description="Unsaved passenger details will be discarded. Any active hold will be released before you leave."
          action="Release hold & leave"
          busy={busy}
          onClose={() => setLeaveAction(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              if (hold) await releaseHold();
              setPassengers({});
              const proceed = leaveAction;
              setLeaveAction(null);
              proceed();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </ConfirmAction>
      )}
    </div>
  );
}
function TripBookings({
  trip,
  revision,
  onRefresh,
  onSourceCounts,
}: {
  trip: CounterTrip;
  revision: number;
  onRefresh: () => void;
  onSourceCounts?: (value: {
    tripId: string;
    counts: Record<string, number>;
  }) => void;
}) {
  const ws = useWorkspace(),
    can = (p: string) => ws.user.permissions.includes(p),
    [rows, setRows] = useState<CounterBooking[]>([]),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [source, setSource] = useState(""),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [active, setActive] = useState<CounterBooking | null>(null),
    [dialog, setDialog] = useState<
      "modify" | "payment" | "ticket" | "cancel" | null
    >(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => setPage(1), [trip.id, source]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    counterApi
      .bookings(trip.id, source, page, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        setRows(r.data.bookings);
        setCounts(r.data.sourceCounts);
        onSourceCounts?.({ tripId: trip.id, counts: r.data.sourceCounts });
        setPages(r.meta?.pages || 1);
        setTotal(r.meta?.total || 0);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [trip.id, revision, source, page, retry]);
  const open = (r: CounterBooking, d: typeof dialog) => {
    setActive(r);
    setDialog(d);
    setReason("");
    setError("");
  };
  return (
    <Panel
      title="Trip bookings"
      aside={<span className="count">{total} bookings</span>}
    >
      <div className="counter-source-counts">
        {Object.entries(sourceLabels).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={source === key}
            onClick={() => setSource(source === key ? "" : key)}
            className={source === key ? "selected" : ""}
          >
            <span>{label}</span>
            <strong>{counts[key] || 0}</strong>
          </button>
        ))}
      </div>
      <div className="counter-bookings-toolbar">
        <span className="muted">
          Booking source is assigned by its authenticated channel.
        </span>
        <label>
          Filter source
          <select
            aria-label="Filter booking source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">All booking sources</option>
            {Object.entries(sourceLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && !dialog && (
        <div role="alert" className="counter-alert error">
          {error}
          <button onClick={() => setRetry((v) => v + 1)}>Retry</button>
        </div>
      )}
      {loading && (
        <div className="table-loading" role="status">
          Loading trip bookings…
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Booking / PNR</th>
              <th>Passenger / seats</th>
              <th>Source</th>
              <th>Payable</th>
              <th>Booking status</th>
              <th>Payment</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong className="counter-booking-ref">{r.reference}</strong>
                  <small className="counter-cell-secondary">
                    {r.pnr ? `PNR ${r.pnr}` : "PNR not issued"}
                  </small>
                </td>
                <td>
                  {r.passengers.map((p) => (
                    <div key={p.seat}>
                      {p.name || "Passenger restricted"}
                      <span className="counter-seat-chip">{p.seat}</span>
                    </div>
                  ))}
                </td>
                <td>
                  <span className="counter-table-source">
                    {sourceLabels[r.source] || r.source}
                  </span>
                </td>
                <td>{money(r.totalPaise / 100)}</td>
                <td>
                  <Badge value={r.status} />
                </td>
                <td>
                  <Badge value={r.paymentStatus} />
                </td>
                <td>
                  <div className="counter-row-actions">
                    {can("bookings:write") &&
                      trip.capabilities.payment &&
                      r.status === "Pending payment" && (
                        <button
                          className="text-btn"
                          onClick={() => open(r, "payment")}
                        >
                          Pay (test)
                        </button>
                      )}
                    {can("bookings:write") &&
                      ["Pending payment", "Confirmed"].includes(r.status) && (
                        <button
                          className="text-btn"
                          onClick={() => open(r, "modify")}
                        >
                          Modify
                        </button>
                      )}
                    {((can("bookings:write") &&
                      r.status === "Pending payment") ||
                      (can("refunds:write") && r.status === "Confirmed")) && (
                      <button
                        className="text-btn counter-danger-text"
                        onClick={() => open(r, "cancel")}
                      >
                        Cancel
                      </button>
                    )}
                    {can("finance:read") && (
                      <button
                        className="text-btn"
                        onClick={() => open(r, "payment")}
                      >
                        Payment
                      </button>
                    )}
                    {can("manifest:read") && (
                      <button
                        className="text-btn"
                        disabled={r.status !== "Confirmed" || !r.pnr}
                        onClick={() => open(r, "ticket")}
                      >
                        <Ticket size={13} />
                        Ticket
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !loading && !error && (
          <div className="empty">
            <Ticket size={26} />
            <h3>No bookings for this trip</h3>
            <p>
              Counter bookings will appear here alongside bookings from
              connected channels.
            </p>
          </div>
        )}
      </div>
      <div className="table-footer">
        <span>
          {total} {source ? sourceLabels[source] + " " : ""}bookings
        </span>
        <div>
          <button
            className="icon-btn"
            aria-label="Previous bookings"
            disabled={page === 1 || loading}
            onClick={() => setPage((v) => v - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="page-number">{page}</span>
          <button
            className="icon-btn"
            aria-label="Next bookings"
            disabled={page >= pages || loading}
            onClick={() => setPage((v) => v + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {active && dialog === "modify" && (
        <ModifyDialog
          booking={active}
          trip={trip}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setRetry((v) => v + 1);
            onRefresh();
            ws.notify("Passenger details updated");
          }}
        />
      )}
      {active && dialog === "payment" && (
        <PaymentDialog
          booking={active}
          onClose={() => setDialog(null)}
          canPay={can("bookings:write") && trip.capabilities.payment}
          onUpdated={() => {
            setRetry((v) => v + 1);
            onRefresh();
          }}
        />
      )}
      {active && dialog === "ticket" && (
        <TicketDialog booking={active} onClose={() => setDialog(null)} />
      )}
      {active && dialog === "cancel" && (
        <ConfirmAction
          title={
            active.status === "Confirmed"
              ? "Request ticket cancellation?"
              : "Cancel pending booking?"
          }
          description={
            active.status === "Confirmed"
              ? "A cancellation and refund request will be recorded using the operator policy. Confirmed seats are not released and refunds are not completed without authoritative verification."
              : "This unpaid pending booking will be cancelled and its held seats released. No refund is being issued."
          }
          action={
            active.status === "Confirmed"
              ? "Request cancellation"
              : "Cancel pending booking"
          }
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (!reason.trim()) {
              setError("Enter a cancellation reason.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              await api(
                `/operator/bookings/${active.id}/${active.status === "Confirmed" ? "cancellation" : "cancel-pending"}`,
                { method: "POST", body: JSON.stringify({ reason }) },
              );
              setDialog(null);
              setRetry((v) => v + 1);
              onRefresh();
              ws.notify(
                active.status === "Confirmed"
                  ? "Cancellation request recorded. Refund remains pending."
                  : "Pending booking cancelled.",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="counter-quota-label">
            Cancellation reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </ConfirmAction>
      )}
    </Panel>
  );
}
