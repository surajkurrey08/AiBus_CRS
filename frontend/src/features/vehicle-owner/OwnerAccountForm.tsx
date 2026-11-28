import { useId, useState } from "react";
import { api } from "../../api/client";
import { Overlay } from "../../components";

export type Owner = {
  id: string;
  name: string;
  email?: string;
  loginEmail?: string;
};

export function OwnerAccountForm({
  owner,
  onClose,
  onCreated,
}: {
  owner?: Owner;
  onClose: () => void;
  onCreated: (owner: Owner) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const passwordHelpId = useId();

  return (
    <Overlay
      title={owner ? `Create login for ${owner.name}` : "Create vehicle owner"}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="car-editor-dialog"
    >
      <form
        className="car-editor-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const fields = new FormData(event.currentTarget);
          const password = String(fields.get("password") ?? "");
          const missing = [
            ...(!/[A-Z]/.test(password) ? ["1 uppercase letter"] : []),
            ...((password.match(/[a-z]/g)?.length ?? 0) < 4
              ? ["4 lowercase letters"]
              : []),
            ...(!/[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/.test(password)
              ? ["1 special character"]
              : []),
          ];
          if (missing.length) {
            setPasswordError(
              `Password must include at least ${missing.join(", ")}.`,
            );
            event.currentTarget
              .querySelector<HTMLInputElement>('input[name="password"]')
              ?.focus();
            return;
          }
          setBusy(true);
          setError("");
          try {
            const { data } = await api<Owner>("/operator/vehicle-owners", {
              method: "POST",
              body: JSON.stringify({
                ...(owner
                  ? { ownerId: owner.id }
                  : { name: fields.get("name") }),
                email: fields.get("email"),
                password,
              }),
            });
            onCreated(data);
          } catch (issue) {
            setError((issue as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="car-editor-body">
          {!owner && (
            <label>
              Owner name
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                disabled={busy}
              />
            </label>
          )}
          <label>
            Owner login email
            <input
              name="email"
              type="email"
              defaultValue={owner?.email}
              required
              maxLength={254}
              disabled={busy}
            />
          </label>
          <label>
            Initial password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordHelpId}
              onChange={() => setPasswordError("")}
              disabled={busy}
            />
          </label>
          <p className="car-editor-intro" id={passwordHelpId}>
            Use at least 8 characters, 1 uppercase letter, 4 lowercase letters
            and 1 special character. Share the initial password privately with
            the owner.
          </p>
          {passwordError && (
            <p className="counter-alert error" role="alert">
              {passwordError}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="car-editor-footer">
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Creating…" : "Create owner login"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
