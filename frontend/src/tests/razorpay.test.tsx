// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { RazorpayPaymentActions } from "../features/payments/components/RazorpayPaymentActions";

vi.mock("../api/client", () => ({ api: vi.fn() }));
const order = {
  mode: "test",
  keyId: "rzp_test_fixture",
  orderId: "order_fixture",
  amountPaise: 171100,
  currency: "INR",
  reference: "AB-TEST",
};
const proof = {
  razorpay_order_id: order.orderId,
  razorpay_payment_id: "pay_fixture",
  razorpay_signature: "a".repeat(64),
};
let checkoutOptions: any;
beforeEach(() => {
  vi.clearAllMocks();
  window.Razorpay = class {
    constructor(options: any) {
      checkoutOptions = options;
    }
    on() {}
    open() {
      void checkoutOptions.handler(proof);
    }
  };
  vi.mocked(api).mockImplementation(async (path) => ({
    data: path.endsWith("/payment")
      ? order
      : { status: "Confirmed", paymentStatus: "Paid", reference: "AB-TEST" },
  }));
});
afterEach(() => {
  cleanup();
  delete window.Razorpay;
  document
    .querySelectorAll('script[src*="checkout.razorpay.com"]')
    .forEach((s) => s.remove());
});
describe("Razorpay checkout", () => {
  it("uses a backend order and confirms only after posting the checkout proof to the backend", async () => {
    const user = userEvent.setup(),
      updated = vi.fn();
    render(
      <RazorpayPaymentActions bookingId="booking-1" onUpdated={updated} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Pay with Razorpay (test)" }),
    );
    await screen.findByText(/Test payment verified/);
    expect(checkoutOptions).toMatchObject({
      key: "rzp_test_fixture",
      order_id: "order_fixture",
      amount: 171100,
      currency: "INR",
    });
    expect(api).toHaveBeenCalledWith(
      "/operator/bookings/booking-1/payment/verify",
      { method: "POST", body: JSON.stringify(proof) },
    );
    expect(updated).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Confirmed" }),
    );
  });
  it("keeps a failed backend verification as an error instead of trusting Checkout success", async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/verify")) throw Error("Invalid payment signature");
      return { data: order };
    });
    const user = userEvent.setup(),
      updated = vi.fn();
    render(
      <RazorpayPaymentActions bookingId="booking-1" onUpdated={updated} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Pay with Razorpay (test)" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Invalid payment signature",
    );
    expect(updated).not.toHaveBeenCalled();
  });
  it("closes and restores the app dialog so the provider checkout is not trapped behind a native modal", async () => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function () {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function () {
        this.removeAttribute("open");
      },
    });
    let wasClosed = false;
    window.Razorpay = class {
      constructor(options: any) {
        checkoutOptions = options;
      }
      on() {}
      open() {
        wasClosed = !document.querySelector("dialog")!.open;
        void checkoutOptions.handler(proof);
      }
    };
    const user = userEvent.setup();
    render(
      <dialog open>
        <RazorpayPaymentActions bookingId="booking-1" />
      </dialog>,
    );
    await user.click(
      screen.getByRole("button", { name: "Pay with Razorpay (test)" }),
    );
    await screen.findByText(/Test payment verified/);
    await waitFor(() =>
      expect(document.querySelector("dialog")!.open).toBe(true),
    );
    expect(wasClosed).toBe(true);
  });
  it("can check captured status after a lost checkout callback without opening checkout", async () => {
    const user = userEvent.setup();
    render(<RazorpayPaymentActions bookingId="booking-1" />);
    await user.click(
      screen.getByRole("button", { name: "Check payment status" }),
    );
    await screen.findByText(/Test payment verified/);
    expect(api).toHaveBeenCalledWith(
      "/operator/bookings/booking-1/payment/reconcile",
      { method: "POST" },
    );
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("reports checkout script failure and never starts an order when checkout cannot load", async () => {
    delete window.Razorpay;
    const user = userEvent.setup();
    render(<RazorpayPaymentActions bookingId="booking-1" />);
    await user.click(
      screen.getByRole("button", { name: "Pay with Razorpay (test)" }),
    );
    document
      .querySelector(
        'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
      )!
      .dispatchEvent(new Event("error"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load Razorpay checkout",
    );
    expect(api).not.toHaveBeenCalled();
  });
});
