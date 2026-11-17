import { Panel } from "../../components/index.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
export function TripCalendar({
  date,
  onChange,
}: {
  date: string;
  onChange: (v: string) => void;
}) {
  const ws = useWorkspace(),
    start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  return (
    <Panel
      title="Trip schedule"
      aside={
        <span className="muted">
          Week of{" "}
          {start.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          })}
        </span>
      }
    >
      <div className="schedule">
        {days.map((d) => {
          const value = d.toISOString().slice(0, 10);
          return (
            <button
              key={value}
              className={value === date ? "selected" : ""}
              onClick={() => onChange(value)}
            >
              <span>
                {d.toLocaleDateString("en-IN", {
                  weekday: "short",
                  timeZone: "UTC",
                })}
              </span>
              <strong>{d.getUTCDate()}</strong>
              <small>
                {
                  (ws.raw.trips || []).filter(
                    (t) => t.journeyDate === value && t.status !== "Cancelled",
                  ).length
                }{" "}
                trips
              </small>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
