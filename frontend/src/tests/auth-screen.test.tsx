// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthScreen } from "../features/auth/AuthScreen";
import { api, login } from "../api/client";

vi.mock("../api/client.ts", () => ({ api: vi.fn(), login: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  history.replaceState({}, "", "/");
});
afterEach(cleanup);

describe("Operator authentication", () => {
  it("associates validation with the field and focuses the first correction", async () => {
    render(<AuthScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const email = screen.getByLabelText("Email");
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });
  it("reveals a password without changing it and masks/clears it on navigation", async () => {
    render(<AuthScreen />);
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    await userEvent.type(password, "private-test-password");
    expect(password.type).toBe("password");
    await userEvent.click(
      screen.getByRole("button", { name: "Show password" }),
    );
    expect(password.type).toBe("text");
    expect(password.value).toBe("private-test-password");
    await userEvent.click(
      screen.getByRole("button", { name: "Forgot password?" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Back to sign in" }),
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe(
      "password",
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
  });
  it("prevents duplicate submits and retains credentials after a network failure", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(login).mockImplementation(
      () =>
        new Promise<void>((_resolve, no) => {
          reject = no;
        }),
    );
    render(<AuthScreen />);
    await userEvent.type(
      screen.getByLabelText("Email"),
      "operator@example.test",
    );
    await userEvent.type(
      screen.getByLabelText("Password"),
      "private-test-password",
    );
    await userEvent.dblClick(screen.getByRole("button", { name: "Sign in" }));
    expect(login).toHaveBeenCalledTimes(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Please wait…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () =>
      reject(
        new Error(
          "Cannot reach the operator API. Check your connection and try again.",
        ),
      ),
    );
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "operator@example.test",
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "private-test-password",
    );
    expect(
      (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("preserves forgot-password privacy and the account email", async () => {
    vi.mocked(api).mockResolvedValue({ data: {} });
    render(<AuthScreen />);
    await userEvent.type(
      screen.getByLabelText("Email"),
      "operator@example.test",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Forgot password?" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Send reset link" }),
    );
    expect(api).toHaveBeenCalledWith(
      "/auth/forgot-password",
      expect.objectContaining({
        body: JSON.stringify({ email: "operator@example.test" }),
      }),
    );
    expect(
      await screen.findByText("If your account exists, a reset link was sent."),
    ).toBeTruthy();
  });
  it("preserves the registration API and approval requirements", async () => {
    vi.mocked(api).mockResolvedValue({ data: {} });
    render(<AuthScreen />);
    await userEvent.click(
      screen.getByRole("button", { name: "Register your operator company" }),
    );
    // Mode navigation intentionally focuses the new heading on the next frame.
    // Wait for that transition before typing so it cannot steal input focus.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Register your company" }),
      ),
    );
    for (const [label, value] of [
      ["Full name", "Operator Owner"],
      ["Company name", "Test Travels"],
      ["Phone number", "9000000000"],
      ["Company address", "Pune"],
      ["Email", "operator@example.test"],
      ["Password", "Private-test-password"],
    ])
      await userEvent.type(screen.getByLabelText(label), value);
    await userEvent.click(
      screen.getByRole("button", { name: "Submit registration" }),
    );
    const [path, options] = vi.mocked(api).mock.calls[0];
    expect(path).toBe("/auth/register");
    expect(JSON.parse(options!.body as string)).toEqual({
      name: "Operator Owner",
      company: "Test Travels",
      phone: "9000000000",
      address: "Pune",
      email: "operator@example.test",
      password: "Private-test-password",
    });
    expect(
      await screen.findByText(
        "Registration submitted. A platform administrator must approve your operator account.",
      ),
    ).toBeTruthy();
  });
  it("submits a reset token only to the reset endpoint and returns to sign in", async () => {
    history.replaceState({}, "", "/?reset=isolated-reset-token");
    vi.mocked(api).mockResolvedValue({ data: {} });
    render(<AuthScreen />);
    await userEvent.type(
      screen.getByLabelText("Password"),
      "Private-test-password",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save password" }),
    );
    expect(api).toHaveBeenCalledWith(
      "/auth/reset-password",
      expect.objectContaining({
        body: JSON.stringify({
          token: "isolated-reset-token",
          password: "Private-test-password",
        }),
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeTruthy();
    expect(location.search).toBe("");
  });
});
