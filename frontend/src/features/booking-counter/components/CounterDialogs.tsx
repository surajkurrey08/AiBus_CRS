import { Download, Printer, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../api/client.ts";
import { Badge, Overlay } from "../../../components/index.ts";
import { money } from "../../../data/demo-data.ts";
import {
  ticketHtml,
  type CounterBooking,
  type CounterPassenger,
  type CounterTrip,
  type PricingPolicy,
} from "../api/counter.api.ts";
export function ConfirmAction({
  title,
  description,
  action,
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description: string;
  action: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Overlay title={title} onClose={onClose}>
      <div className="counter-dialog-body">
        <p>{description}</p>
        {children}
      </div>
      <div className="dialog-foot">
        <button className="btn" autoFocus disabled={busy} onClick={onClose}>
          Go back
        </button>
        <button className="btn primary" disabled={busy} onClick={onConfirm}>
          {busy ? "Working…" : action}
        </button>
      </div>
    </Overlay>
  );
}
export function PricingDialog({
  policy,
  onSaved,
  onClose,
}: {
  policy: PricingPolicy | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [tax, setTax] = useState(
      policy ? String(policy.taxBasisPoints / 100) : "",
    ),
    [charge, setCharge] = useState(String((policy?.chargePaise || 0) / 100)),
    [maxDiscount, setMaxDiscount] = useState(
      String((policy?.operatorDiscountMaxPaise || 0) / 100),
    ),
    [chargeTax, setChargeTax] = useState(policy?.chargesTaxable || false),
    [age, setAge] = useState(policy?.requireAge || false),
    [gender, setGender] = useState(policy?.requireGender || false),
    [mobile, setMobile] = useState(policy?.requireMobile ?? false),
    [gst, setGst] = useState(policy?.gstEnabled || false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Overlay title="Counter pricing rules" onClose={onClose}>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (
            tax.trim() === "" ||
            ![tax, charge, maxDiscount].every(
              (v) => Number.isFinite(Number(v)) && Number(v) >= 0,
            ) ||
            Number(tax) > 100
          ) {
            setError(
              "Enter a tax rate from 0 to 100 and non-negative charge/discount limits.",
            );
            return;
          }
          setBusy(true);
          try {
            await api("/operator/pricing-policy", {
              method: "PUT",
              body: JSON.stringify({
                taxBasisPoints: Math.round(Number(tax) * 100),
                chargePaise: Math.round(Number(charge) * 100),
                chargesTaxable: chargeTax,
                operatorDiscountMaxPaise: Math.round(Number(maxDiscount) * 100),
                requireAge: age,
                requireGender: gender,
                requireMobile: mobile,
                gstEnabled: gst,
                expectedVersion: policy?.version || 0,
              }),
            });
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="counter-dialog-body">
          <div className="counter-alert">
            <ShieldCheck size={18} />
            <p>
              Set your authorized operator rules. Tax is added to the discounted
              fare; existing bookings keep their recorded pricing.
            </p>
          </div>
          <div className="form-grid counter-form-grid">
            <label>
              Tax rate · %
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                placeholder="Enter your configured rate"
              />
            </label>
            <label>
              Additional charge per booking · INR
              <input
                type="number"
                min="0"
                step="0.01"
                value={charge}
                onChange={(e) => setCharge(e.target.value)}
              />
            </label>
            <label>
              Maximum authorized operator discount · INR
              <input
                type="number"
                min="0"
                step="0.01"
                value={maxDiscount}
                onChange={(e) => setMaxDiscount(e.target.value)}
              />
            </label>
          </div>
          {[
            [
              chargeTax,
              setChargeTax,
              "Include additional charges in the taxable amount",
            ],
            [age, setAge, "Require passenger age"],
            [gender, setGender, "Require passenger gender"],
            [mobile, setMobile, "Require a booking mobile number"],
            [gst, setGst, "Accept passenger GST details"],
          ].map(([checked, setter, label]) => (
            <label className="counter-check" key={String(label)}>
              <input
                type="checkbox"
                checked={Boolean(checked)}
                onChange={(e) =>
                  (setter as (v: boolean) => void)(e.target.checked)
                }
              />
              {String(label)}
            </label>
          ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save pricing rules"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
export function PassengerFields({
  seats,
  values,
  onChange,
  trip,
  requireAge = false,
  requireGender = false,
}: {
  seats: string[];
  values: Record<string, CounterPassenger>;
  onChange: (v: Record<string, CounterPassenger>) => void;
  trip: CounterTrip;
  requireAge?: boolean;
  requireGender?: boolean;
}) {
  return (
    <div className="counter-passengers">
      {seats.map((seat, i) => {
        const p = values[seat] || { name: "", seat };
        const set = (key: string, value: string | number | undefined) =>
          onChange({ ...values, [seat]: { ...p, seat, [key]: value } });
        return (
          <fieldset key={seat}>
            <legend>
              <span className="counter-seat-chip">{seat}</span>Passenger {i + 1}
            </legend>
            <div className="counter-fields">
              <label className="counter-wide">
                Full name
                <input
                  autoComplete="off"
                  aria-label={`Passenger full name ${seat}`}
                  id={`counter-passenger-name-${seat}`}
                  value={p.name}
                  onChange={(e) => set("name", e.target.value)}
                  maxLength={100}
                />
              </label>
              <label>
                Mobile · optional
                <input
                  type="tel"
                  maxLength={10}
                  aria-label={`Passenger mobile ${seat}`}
                  value={p.phone || ""}
                  onChange={(e) => set("phone", e.target.value || undefined)}
                  placeholder="Use booking contact"
                />
              </label>
              <label>
                Email · optional
                <input
                  type="email"
                  aria-label={`Passenger email ${seat}`}
                  value={p.email || ""}
                  onChange={(e) => set("email", e.target.value || undefined)}
                />
              </label>
              <label>
                Age{!requireAge && " · optional"}
                <input
                  type="number"
                  min="0"
                  max="120"
                  aria-label={`Passenger age ${seat}`}
                  value={p.age ?? ""}
                  onChange={(e) =>
                    set(
                      "age",
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                    )
                  }
                />
              </label>
              <label>
                Gender{!requireGender && " · optional"}
                <select
                  aria-label={`Passenger gender ${seat}`}
                  value={p.gender || ""}
                  onChange={(e) => set("gender", e.target.value || undefined)}
                >
                  <option value="">Choose gender</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="unspecified">Prefer not to say</option>
                </select>
              </label>
              <label>
                Boarding point
                <select
                  aria-label={`Boarding point ${seat}`}
                  value={p.boarding || ""}
                  onChange={(e) => set("boarding", e.target.value)}
                >
                  <option value="">Choose boarding point</option>
                  {trip.boarding.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.time ? ` · ${b.time}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Dropping point
                <select
                  aria-label={`Dropping point ${seat}`}
                  value={p.dropping || ""}
                  onChange={(e) => set("dropping", e.target.value)}
                >
                  <option value="">Choose dropping point</option>
                  {trip.dropping.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.time ? ` · ${b.time}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
export function ModifyDialog({
  booking,
  trip,
  onSaved,
  onClose,
}: {
  booking: CounterBooking;
  trip: CounterTrip;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(
      Object.fromEntries(booking.passengers.map((p) => [p.seat, p])),
    ),
    [phone, setPhone] = useState(
      booking.contact?.phone ||
        booking.passengers.find((p) => p.phone)?.phone ||
        "",
    ),
    [email, setEmail] = useState(booking.contact?.email || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Overlay title={`Modify booking · ${booking.reference}`} onClose={onClose}>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api(`/operator/bookings/${booking.id}/passengers`, {
              method: "PATCH",
              body: JSON.stringify({
                expectedVersion: booking.version,
                passengers: Object.values(values),
                contact: { phone, email: email || undefined },
                ...(booking.gst ? { gst: booking.gst } : {}),
              }),
            });
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="counter-dialog-body">
          <p className="muted">
            Passenger and contact details can be updated. Booked seats and the
            recorded fare stay fixed.
          </p>
          <div className="counter-fields">
            <label>
              Contact mobile
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label>
              Contact email · optional
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>
          <PassengerFields
            seats={booking.passengers.map((p) => p.seat)}
            values={values}
            onChange={setValues}
            trip={trip}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save passenger details"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
export function PaymentDialog({
  booking,
  onClose,
  canPay = false,
  onUpdated,
}: {
  booking: CounterBooking;
  onClose: () => void;
  canPay?: boolean;
  onUpdated?: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [paymentStatus, setPaymentStatus] = useState(booking.paymentStatus);
  useEffect(() => {
    let active = true;
    api(`/operator/bookings/${booking.id}/payments`)
      .then((r) => {
        if (active) setData(r.data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [booking.id, revision]);
  return (
    <Overlay title="Payment details" onClose={onClose}>
      <div className="counter-dialog-body">
        <h3>{booking.reference}</h3>
        <div className="detail-row">
          <span>Total payable</span>
          <strong>{money(booking.totalPaise / 100)}</strong>
        </div>
        <div className="detail-row">
          <span>Recorded payment status</span>
          <Badge value={paymentStatus} />
        </div>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : !data ? (
          <p role="status">Loading payment records…</p>
        ) : data.payments.length ? (
          data.payments.map((p: any) => (
            <div key={p._id} className="counter-payment-record">
              <strong>
                {money(p.amountPaise / 100)} · {p.status}
              </strong>
              <p>
                {p.providerId} · {p.externalId}
              </p>
              <small>
                {p.confirmedAt
                  ? new Date(p.confirmedAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    }) + " IST"
                  : "No confirmation received"}
              </small>
            </div>
          ))
        ) : (
          <div className="counter-alert">
            No captured payment recorded for this booking yet.
          </div>
        )}
        {booking.status === "Pending payment" &&
          paymentStatus !== "Paid" && (
            <div style={{ marginTop: "12px" }}>
              <button
                type="button"
                className="btn primary full"
                onClick={async () => {
                  try {
                    await api(`/operator/bookings/${booking.id}/confirm-direct`, { method: "POST" });
                    setPaymentStatus("Paid");
                    setRevision((v) => v + 1);
                    onUpdated?.();
                  } catch (e: any) {
                    setError(e.message || "Confirmation failed");
                  }
                }}
              >
                Confirm Booking & Mark Paid (Counter Cash)
              </button>
            </div>
          )}
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={onClose}>
          Close details
        </button>
      </div>
    </Overlay>
  );
}
export function TicketDialog({
  booking,
  onClose,
}: {
  booking: CounterBooking;
  onClose: () => void;
}) {
  const [html, setHtml] = useState(""),
    [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let active = true;
    ticketHtml(booking.id)
      .then((text) => {
        if (active) setHtml(text);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [booking.id]);
  return (
    <Overlay title="Confirmed e-ticket" onClose={onClose} drawer>
      <div className="counter-dialog-body">
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : !html ? (
          <p role="status">Validating confirmed ticket…</p>
        ) : (
          <iframe
            ref={frame}
            title="Confirmed printable ticket"
            className="counter-ticket-frame"
            sandbox="allow-same-origin allow-modals"
            srcDoc={html}
          />
        )}
      </div>
      <div className="dialog-foot">
        <button
          className="btn"
          disabled={!html}
          onClick={() => frame.current?.contentWindow?.print()}
        >
          <Printer size={15} />
          Print ticket
        </button>
        <button
          className="btn primary"
          disabled={!html}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([html], { type: "text/html;charset=utf-8" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = `aibus-ticket-${booking.pnr || booking.id}.html`;
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={15} />
          Download ticket
        </button>
      </div>
    </Overlay>
  );
}
export function ManifestDialog({
  trip,
  onClose,
}: {
  trip: CounterTrip;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<any[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`/operator/trips/${trip.id}/manifest`)
      .then((r) => {
        if (active) setRows(r.data.passengers);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [trip.id]);
  return (
    <Overlay title="Passenger chart" onClose={onClose} drawer>
      <div className="counter-dialog-body">
        <h3>{trip.route}</h3>
        <p className="muted">
          {trip.journeyDate} · {trip.registration}
        </p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : rows === null ? (
          <p role="status">Loading authorized passengers…</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Seat</th>
                  <th>Passenger</th>
                  <th>Boarding point</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={`${p.bookingId}-${p.seat}`}>
                    <td>{p.seat}</td>
                    <td>{p.name}</td>
                    <td>{p.boarding || "—"}</td>
                    <td>{p.phone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <div className="empty">No confirmed passengers on this trip.</div>
            )}
          </div>
        )}
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={onClose}>
          Close chart
        </button>
        <button
          className="btn primary"
          disabled={!rows?.length}
          onClick={() => window.print()}
        >
          <Printer size={15} />
          Print chart
        </button>
      </div>
    </Overlay>
  );
}
