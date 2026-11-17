import { useRef, useState } from "react";
import {
  checkPayment,
  payWithRazorpay,
  type PaymentResult,
} from "../api/razorpay";

export function RazorpayPaymentActions({
  bookingId,
  onUpdated,
}: {
  bookingId: string;
  onUpdated?: (result: PaymentResult) => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const lock = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  async function run(check: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const dialog = host.current?.closest("dialog");
    try {
      const result = await (check
        ? checkPayment(bookingId)
        : payWithRazorpay(bookingId, () => dialog?.close()));
      setMessage(
        result.status === "Confirmed"
          ? "Test payment verified. Booking confirmed; the ticket and manifest are now available."
          : result.status === "Reconciliation required"
            ? "Payment received, but the seats could not be confirmed. Contact your administrator; do not pay again."
            : result.message || `Booking status: ${result.status}`,
      );
      onUpdated?.(result);
    } catch (e) {
      setError(
        `${(e as Error).message} If you attempted payment, use Check payment status before paying again.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
      if (dialog?.isConnected && !dialog.open) dialog.showModal();
    }
  }
  return (
    <div className="razorpay-payment-actions" ref={host}>
      <p className="counter-availability-note">
        Razorpay Test Mode · No real money is collected.
      </p>
      <div className="counter-controls">
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void run(false)}
        >
          {busy ? "Processing…" : "Pay with Razorpay (test)"}
        </button>
        <button className="btn" disabled={busy} onClick={() => void run(true)}>
          Check payment status
        </button>
      </div>
      {error && (
        <p className="counter-alert error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="counter-alert" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
