import { buildSeatLayout } from "./utils/buildSeatLayout";
import { Armchair, Upload } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { Overlay } from "../../components/index.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";

export function LayoutEditor({
  busId,
  busRecord,
  showUpload = true,
  onSaved,
}: {
  busId: string;
  busRecord?: Record<string, any>;
  showUpload?: boolean;
  onSaved?: () => void;
}) {
  const ws = useWorkspace(),
    [open, setOpen] = useState(false),
    [layoutType, setLayoutType] = useState(
      (
        busRecord?.type || ws.raw.buses?.find((b) => b._id === busId)?.type
      )?.includes("Seater")
        ? "seater"
        : "sleeper",
    ),
    [decks, setDecks] = useState(
      ws.raw.buses?.find((b) => b._id === busId)?.type?.includes("Seater")
        ? "1"
        : "2",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const bus = busRecord || ws.raw.buses?.find((b) => b._id === busId);
  return (
    <div className="layout-tools">
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Armchair size={15} />
        Configure seat layout
      </button>
      {showUpload && (
        <label className="btn">
          <Upload size={15} />
          Upload bus image
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={async (e) => {
              const image = e.target.files?.[0];
              if (!image) return;
              const body = new FormData();
              body.set("image", image);
              try {
                await api(`/operator/buses/${busId}/images`, {
                  method: "POST",
                  body,
                });
                ws.notify("Bus image uploaded");
              } catch (e) {
                ws.notify((e as Error).message);
              }
            }}
          />
        </label>
      )}
      {open && (
        <Overlay title="Configure seat layout" onClose={() => setOpen(false)}>
          <form
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                if (!bus) throw new Error("Bus record not loaded");
                const existing = await api<{
                  seats?: { number: string; farePaise: number }[];
                } | null>(`/operator/buses/${busId}/layout`);
                const seats = buildSeatLayout(
                  bus.capacity,
                  layoutType,
                  Number(decks),
                ).map((seat) => ({
                  ...seat,
                  farePaise:
                    existing.data?.seats?.find(
                      (saved) => saved.number === seat.number,
                    )?.farePaise ?? 0,
                }));
                await api(`/operator/buses/${busId}/layout`, {
                  method: "PUT",
                  body: JSON.stringify({ name: `${bus.name} layout`, seats }),
                });
                setOpen(false);
                onSaved?.();
                ws.notify(
                  "Layout saved. New trips will use this seat configuration.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Layout type
                <select
                  value={layoutType}
                  onChange={(e) => setLayoutType(e.target.value)}
                >
                  <option value="sleeper">Sleeper · 2+1</option>
                  <option value="seater">Seater · 2+2</option>
                  <option value="mixed">Mixed seater / sleeper</option>
                </select>
              </label>
              <label>
                Decks
                <select
                  value={decks}
                  onChange={(e) => setDecks(e.target.value)}
                >
                  <option value="1">Lower deck only</option>
                  <option value="2">Lower and upper decks</option>
                </select>
              </label>
              <label>
                Seat capacity
                <input value={bus?.capacity || ""} disabled />
              </label>
              <p className="muted">
                Set double-side and single-side prices in the Fares tab before
                scheduling. This form configures seat positions only. Existing
                trips keep their saved layouts and fares.
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-foot">
              <button className="btn primary" disabled={busy}>
                {busy ? "Saving layout…" : "Save layout"}
              </button>
            </div>
          </form>
        </Overlay>
      )}
    </div>
  );
}
