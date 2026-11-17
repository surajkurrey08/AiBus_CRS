import { useEffect, useState } from "react";
import { loadAllRecords } from "../../../api/loadAll";
export function PartnerSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    loadAllRecords(
      "/operator/trip-master/partners?status=Active",
      controller.signal,
    )
      .then((r) => {
        if (!controller.signal.aborted) setRows(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <label>
      Agent / branch referral · optional
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Direct booking · no commission</option>
        {rows.map((r) => (
          <option value={r._id} key={r._id}>
            {r.name} · {r.kind}
          </option>
        ))}
      </select>
      {error && (
        <small className="muted">
          Referrals unavailable: {error}. Direct booking is available.
        </small>
      )}
    </label>
  );
}
