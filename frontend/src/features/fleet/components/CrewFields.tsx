import { useEffect, useState } from "react";
import { loadAllRecords } from "../../../api/loadAll";
export function CrewFields({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [crew, setCrew] = useState<Record<string, any>[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadAllRecords("/operator/bus-master/crew", controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted)
          setCrew(rows.filter((row) => row.status === "Active"));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  return (
    <fieldset className="fleet-crew-picker">
      <legend>Assign crew (optional)</legend>
      {loading ? (
        <p role="status">Loading crew...</p>
      ) : error ? (
        <p className="error">
          {error}{" "}
          <button
            type="button"
            className="text-btn"
            onClick={() => setRevision((v) => v + 1)}
          >
            Retry crew
          </button>
        </p>
      ) : crew.length ? (
        crew.map((member) => (
          <label key={member._id}>
            <input
              type="checkbox"
              checked={selected.includes(member._id)}
              disabled={!selected.includes(member._id) && selected.length >= 10}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, member._id]
                    : selected.filter((id) => id !== member._id),
                )
              }
            />
            <span>
              {member.name}{" "}
              <small>
                {member.role} · {member.phone}
              </small>
            </span>
          </label>
        ))
      ) : (
        <p className="muted">
          Add drivers, conductors or pickup staff in Bus Master to assign them
          here.
        </p>
      )}
    </fieldset>
  );
}
