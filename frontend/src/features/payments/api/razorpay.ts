import { api } from "../../../api/client";

export interface PaymentResult {
  status: string;
  paymentStatus?: string;
  reference?: string;
  pnr?: string | null;
  message?: string;
}
interface CheckoutOrder {
  mode: "test";
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: "INR";
  reference: string;
  status?: string;
}
interface CheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
type Checkout = {
  open: () => void;
  on: (event: string, handler: (result: any) => void) => void;
};
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => Checkout;
  }
}
let loading: Promise<void> | null = null;
export function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      reject(
        new Error(
          "Razorpay checkout took too long to load. Check your connection and try again.",
        ),
      );
    }, 20000);
    script.onload = () => {
      clearTimeout(timer);
      window.Razorpay
        ? resolve()
        : reject(new Error("Razorpay checkout is unavailable."));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(
        new Error(
          "Could not load Razorpay checkout. Check your connection or browser blocker.",
        ),
      );
    };
    document.head.append(script);
  }).finally(() => {
    loading = null;
  });
  return loading;
}
export async function checkPayment(bookingId: string) {
  return (
    await api<PaymentResult>(
      `/operator/bookings/${bookingId}/payment/reconcile`,
      { method: "POST" },
    )
  ).data;
}
export async function payWithRazorpay(
  bookingId: string,
  beforeOpen?: () => void,
): Promise<PaymentResult> {
  await loadRazorpayCheckout();
  const { data: order } = await api<CheckoutOrder>(
    `/operator/bookings/${bookingId}/payment`,
    { method: "POST" },
  );
  if (order.status === "Confirmed")
    return { status: "Confirmed", reference: order.reference };
  if (
    order.mode !== "test" ||
    !order.keyId.startsWith("rzp_test_") ||
    !window.Razorpay
  )
    throw new Error("Expected a Razorpay Test Mode order.");
  return new Promise((resolve, reject) => {
    let submitted = false;
    const checkout = new window.Razorpay!({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: order.currency,
      name: "Aibus · Test Mode",
      description: `Booking ${order.reference}`,
      theme: { color: "#c4522b" },
      handler: async (response: CheckoutResponse) => {
        if (submitted) return;
        submitted = true;
        try {
          resolve(
            (
              await api<PaymentResult>(
                `/operator/bookings/${bookingId}/payment/verify`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                  }),
                },
              )
            ).data,
          );
        } catch (e) {
          reject(e);
        }
      },
      modal: {
        ondismiss: () => {
          if (submitted) return;
          submitted = true;
          resolve({
            status: "Pending payment",
            message:
              "Checkout closed. Check payment status before retrying if a payment was attempted.",
          });
        },
      },
    });
    beforeOpen?.();
    checkout.open();
  });
}
