import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import { money, type Row } from "../../data/demo-data.ts";
import { exportCsv } from "../../utils/exportCsv";
import { normalize } from "../../utils/normalize.ts";
import { Badge } from "../ui/Badge";
import { Panel } from "../ui/Panel";

export function DataTable({
  rows,
  columns,
  onView,
  onEdit,
  title = "records",
  exportable = false,
  actionLabel = "View details",
  journeyDate,
  emptyTitle,
  emptyDescription,
  resourcePath,
  unsortableColumns = [],
}: {
  rows: Row[];
  columns: [string, string][];
  onView?: (r: Row) => void;
  onEdit?: (r: Row) => void;
  title?: string;
  exportable?: boolean;
  actionLabel?: string;
  journeyDate?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  resourcePath?: string;
  unsortableColumns?: string[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("");
  const [desc, setDesc] = useState(false);
  const ws = useWorkspace();
  const resource =
    resourcePath ||
    (
      {
        bookings: "bookings",
        buses: "buses",
        routes: "routes",
        fares: "fares",
        refunds: "refunds",
        settlements: "settlements",
        staff: "staff",
        trips: "trips",
      } as Record<string, string>
    )[title];
  const remote = !!resource && !ws.demo;
  const [remoteRows, setRemoteRows] = useState<Row[]>([]),
    [remoteTotal, setRemoteTotal] = useState(0),
    [remoteError, setRemoteError] = useState(""),
    [remoteLoading, setRemoteLoading] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!remote) return;
    const controller = new AbortController();
    setRemoteLoading(true);
    setRemoteError("");
    const params = new URLSearchParams({
      page: String(page),
      limit: "6",
      search: query,
      ...(journeyDate ? { journeyDate } : {}),
      ...(status !== "All statuses" ? { status } : {}),
      ...(sort ? { sort, order: desc ? "desc" : "asc" } : {}),
    });
    api<any[]>(`/operator/${resource}?${params}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setRemoteRows(
          result.data.map((row) => normalize(resource, row, ws.raw)),
        );
        setRemoteTotal(result.meta?.total || 0);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setRemoteError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRemoteLoading(false);
      });
    return () => controller.abort();
  }, [
    remote,
    resource,
    page,
    query,
    status,
    sort,
    desc,
    ws.revision,
    retry,
    journeyDate,
  ]);
  const filtered = (remote ? remoteRows : rows)
    .filter(
      (r) =>
        Object.values(r)
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (status === "All statuses" || r.status === status),
    )
    .sort((a, b) =>
      sort
        ? (desc ? -1 : 1) *
          (a[sort] || "").localeCompare(b[sort] || "", undefined, {
            numeric: true,
          })
        : 0,
    );
  const total = remote ? remoteTotal : filtered.length;
  const pages = Math.max(1, Math.ceil(total / 6));
  useEffect(() => setPage(1), [query, status]);
  const current = Math.min(page, pages);
  return (
    <Panel>
      <div className="table-toolbar">
        <div className="search">
          <Search size={16} />
          <input
            aria-label={`Search ${title}`}
            placeholder={`Search ${title}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              "All statuses",
              ...new Set(rows.map((r) => r.status).filter(Boolean)),
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {exportable && (
            <button
              className="btn"
              onClick={async () => {
                try {
                  if (!remote) {
                    exportCsv(filtered, title);
                    return;
                  }
                  const collected: Row[] = [];
                  let next = 1,
                    pages = 1;
                  do {
                    const params = new URLSearchParams({
                      page: String(next),
                      limit: "100",
                      search: query,
                      ...(journeyDate ? { journeyDate } : {}),
                      ...(status !== "All statuses" ? { status } : {}),
                    });
                    const result = await api<any[]>(
                      `/operator/${resource}?${params}`,
                    );
                    collected.push(
                      ...result.data.map((r) => normalize(resource, r, ws.raw)),
                    );
                    pages = result.meta?.pages || 1;
                    next++;
                  } while (next <= pages);
                  exportCsv(collected, title);
                  ws.notify("CSV exported");
                } catch (e) {
                  ws.notify((e as Error).message);
                }
              }}
            >
              <Download size={15} />
              Export CSV
            </button>
          )}
        </div>
      </div>
      {remoteError && (
        <div className="info-banner" role="alert">
          {remoteError}
          <button className="text-btn" onClick={() => setRetry((r) => r + 1)}>
            Retry
          </button>
        </div>
      )}
      {remoteLoading && (
        <div className="table-loading" role="status">
          Loading {title}…
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th
                  key={key}
                  aria-sort={
                    sort === key ? (desc ? "descending" : "ascending") : "none"
                  }
                >
                  <button
                    disabled={unsortableColumns.includes(key)}
                    onClick={() => {
                      setSort(key);
                      setDesc(sort === key ? !desc : false);
                    }}
                  >
                    {label}
                    <ChevronDown size={12} />
                  </button>
                </th>
              ))}
              {(onView || onEdit) && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {(remote
              ? filtered
              : filtered.slice((current - 1) * 6, current * 6)
            ).map((r, i) => (
              <tr key={r.id || i}>
                {columns.map(([key]) => (
                  <td key={key}>
                    {key === "status" || key === "checkin" ? (
                      <Badge value={r[key]} />
                    ) : [
                        "fare",
                        "weekday",
                        "weekend",
                        "single",
                        "singleWeekend",
                        "festival",
                        "amount",
                      ].includes(key) ? (
                      money(r[key])
                    ) : key === "passenger" ? (
                      <div className="person">
                        <span className="avatar small">
                          {r[key]
                            .split(" ")
                            .map((s) => s[0])
                            .join("")}
                        </span>
                        <div>
                          <strong>{r[key]}</strong>
                          <small>{r.pnr}</small>
                        </div>
                      </div>
                    ) : key === "route" ? (
                      <span className="route-text">{r[key]}</span>
                    ) : (
                      <span className={key === "id" ? "id" : ""}>{r[key]}</span>
                    )}
                  </td>
                ))}
                {(onView || onEdit) && (
                  <td>
                    <div className="row-actions">
                      <button
                        className="text-btn"
                        onClick={() => (onView ? onView(r) : onEdit?.(r))}
                      >
                        {onView ? actionLabel : "Edit"}
                        <ArrowUpRight size={13} />
                      </button>
                      {onView && onEdit && (
                        <button
                          className="icon-btn"
                          aria-label={`Edit ${r.id}`}
                          onClick={() => onEdit(r)}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && !remoteLoading && !remoteError && (
          <div className="empty">
            <Search size={24} />
            <h3>
              {!query && status === "All statuses" && emptyTitle
                ? emptyTitle
                : `No matching ${title}`}
            </h3>
            <p>
              {!query && status === "All statuses" && emptyDescription
                ? emptyDescription
                : "Try another search or choose a different status."}
            </p>
            {(query || status !== "All statuses" || !emptyTitle) && (
              <button
                className="btn"
                onClick={() => {
                  setQuery("");
                  setStatus("All statuses");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
      <div className="table-footer">
        <span>
          Showing {total ? (current - 1) * 6 + 1 : 0}–
          {Math.min(current * 6, total)} of {total} {title}
        </span>
        <div>
          <button
            className="icon-btn"
            aria-label="Previous page"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="page-number">{current}</span>
          <button
            className="icon-btn"
            aria-label="Next page"
            disabled={current >= pages}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </Panel>
  );
}
