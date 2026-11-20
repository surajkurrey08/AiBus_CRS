import { useEffect, useState } from "react";
import { api } from "../../../api/client";
export function CatalogCityPicker({
  onSelect,
}: {
  onSelect: (city: Record<string, string>) => void;
}) {
  const [search, setSearch] = useState(""),
    [rows, setRows] = useState<Record<string, string>[]>([]);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    if (search.trim().length < 2) {
      setRows([]);
      setLoading(false);
      return () => abort.abort();
    }
    setLoading(true);
    setError("");
    setRows([]);
    const timer = setTimeout(() => {
      void api(
        `/operator/area-master/catalog?search=${encodeURIComponent(search)}&limit=25`,
        { signal: abort.signal },
      )
        .then((result) => {
          if (!abort.signal.aborted) setRows(result.data);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [search]);
  return (
    <fieldset>
      <legend>Select from AIBUS City Master</legend>
      <label>
        Find a catalog city
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Enter city or state (at least 2 characters)"
        />
      </label>
      {loading && <p role="status">Searching cities…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && search.trim().length >= 2 && !error && !rows.length && (
        <p>No catalog cities found. You can enter a local city below.</p>
      )}
      {!!rows.length && (
        <label>
          Catalog results
          <select
            defaultValue=""
            onChange={(e) => {
              const city = rows.find((c) => c._id === e.target.value);
              if (city) onSelect(city);
            }}
          >
            <option value="">Choose a city</option>
            {rows.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name} · {c.state} · {c.cityId}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}
