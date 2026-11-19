import { useEffect, useState } from "react";
import { api, type Identity } from "../../api/client";
import { Panel } from "../../components/ui/Panel";
import { PlatformTable } from "../../components/platform/PlatformTable";
import { Evidence } from "../../components/platform/PlatformDetails";
import { FinanceReviewForm } from "../finance/FinanceReviewForm";
import { canPlatform } from "./PlatformWorkspace";
export function OperationsConsole({ user }: { user: Identity }) {
  const [health, setHealth] = useState<any>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [job, setJob] = useState<any>(null),
    [report, setReport] = useState("daily-trips");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    api("/platform/operations/health", { signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setHealth(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [revision]);
  return (
    <>
      <Panel
        title="Operations health"
        aside={
          <button className="btn" onClick={() => setRevision((r) => r + 1)}>
            Refresh health
          </button>
        }
      >
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : !health ? (
          <p role="status">Checking application health...</p>
        ) : (
          <>
            <p>{health.monitoring}</p>
            <Evidence
              data={{
                dependenciesReady: health.dependenciesReady,
                mongoConnected: health.mongoConnected,
                realtime: health.realtime,
                thresholds: health.thresholds,
                metrics: health.metrics,
              }}
            />
            <h4>Background jobs</h4>
            {!health.jobs.length && (
              <p>
                No durable worker heartbeat has been recorded. Verify worker
                startup and indexes.
              </p>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>State</th>
                    <th>Last success</th>
                    <th>Lag alert</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {health.jobs.map((j: any) => (
                    <tr key={j._id}>
                      <td>{j.key}</td>
                      <td>{j.state}</td>
                      <td>{j.lastSucceededAt || "Not recorded"}</td>
                      <td>
                        {j.overdue ? "Review worker lag" : "Within threshold"}
                      </td>
                      <td>
                        {j.state === "Manual review" &&
                          canPlatform(user, "platform:settings:write") && (
                            <button className="btn" onClick={() => setJob(j)}>
                              Review restart
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
      <PlatformTable
        exportable={false}
        title="Reservation and recovery exceptions"
        path="/platform/operations/issues"
        columns={[
          ["operatorId", "Operator"],
          ["code", "Exception"],
          ["category", "Category"],
          ["status", "Status"],
          ["lastSeenAt", "Last observed"],
        ]}
        operators={canPlatform(user, "platform:operators:read")}
        statuses={["Open", "Resolved"]}
        revision={revision}
      />
      <p>
        Payment, refund, wallet and ledger exceptions require financial read
        permission. Use the existing Finance workspace for verified recovery;
        these observations never repair history.
      </p>
      <PlatformTable
        title="Recent job runs"
        path="/platform/operations/jobs"
        columns={[
          ["jobKey", "Job"],
          ["status", "Result"],
          ["startedAt", "Started"],
          ["finishedAt", "Finished"],
          ["code", "Code"],
        ]}
        dates={false}
        revision={revision}
      />
      {canPlatform(user, "platform:reports:read") && (
        <>
          <label>
            Operational report
            <select value={report} onChange={(e) => setReport(e.target.value)}>
              {[
                "daily-trips",
                "scheduled-completed",
                "departure-delays",
                "arrival-delays",
                "bus-utilization",
                "seat-occupancy",
                "route-performance",
                "passenger-boarding",
                "cancellation-trends",
                "distance",
                "mileage",
                "stoppage-duration",
                "crew-assignments",
                "booking-source",
                ...(user.permissions.includes("platform:finance:read")
                  ? ["fuel-expenses"]
                  : []),
              ].map((n) => (
                <option key={n} value={n}>
                  {n.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
          <PlatformTable
            requirePeriodAndOperator
            key={report}
            title="Operational evidence (choose operator and dates)"
            path={`/platform/operations/reports/${report}`}
            operators={canPlatform(user, "platform:operators:read")}
            columns={[
              ["date", "Date"],
              ["route", "Route"],
              ["registration", "Bus"],
              ...((
                {
                  "departure-delays": [
                    ["departureDelayMinutes", "Departure delay (min)"],
                  ],
                  "arrival-delays": [
                    ["arrivalDelayMinutes", "Arrival delay (min)"],
                  ],
                  "seat-occupancy": [
                    ["bookedSeats", "Booked"],
                    ["totalSeats", "Seats"],
                    ["occupancyPercent", "Occupancy %"],
                  ],
                  "passenger-boarding": [
                    ["checkedIn", "Checked in"],
                    ["confirmedPassengers", "Passengers"],
                  ],
                  "fuel-expenses": [["fuelExpensePaise", "Fuel expense"]],
                  distance: [["distanceKm", "Distance km"]],
                  mileage: [["mileageKmPerLitre", "Mileage km/l"]],
                  "stoppage-duration": [["stoppageMinutes", "Stopped min"]],
                  "crew-assignments": [["crew", "Crew"]],
                  "cancellation-trends": [
                    ["cancellations", "Cancelled bookings"],
                  ],
                  "booking-source": [
                    ["operatorBookings", "Operator"],
                    ["agentBookings", "Agency"],
                    ["customerBookings", "Customer"],
                    ["externalBookings", "External"],
                  ],
                } as Record<string, [string, string][]>
              )[report] || [
                ["status", "Stage"],
                ["distanceKm", "Distance km"],
              ]),
            ]}
          />
        </>
      )}
      {job && (
        <FinanceReviewForm
          intent="platform"
          title="Review worker restart"
          description={`Rearm ${job.key} after investigating its failure. Existing run history and financial idempotency keys are preserved.`}
          fields={[
            { name: "reason", label: "Review reason" },
            {
              name: "password",
              label: "Current administrator password",
              type: "password",
            },
          ]}
          onClose={() => setJob(null)}
          onSave={async (values) => {
            await api(`/platform/operations/jobs/${job._id}/rearm`, {
              method: "POST",
              body: JSON.stringify(values),
            });
            setJob(null);
            setRevision((r) => r + 1);
          }}
        />
      )}
    </>
  );
}
