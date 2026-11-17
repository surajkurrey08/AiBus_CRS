import { api } from "./client";
export async function loadAllRecords(path: string, signal?: AbortSignal) {
  const rows: Record<string, any>[] = [];
  let page = 1;
  let pages = 1;
  do {
    const result = await api<Record<string, any>[]>(
      `${path}${path.includes("?") ? "&" : "?"}limit=100&page=${page}`,
      { signal },
    );
    if (!Array.isArray(result.data))
      throw new Error("Master records could not be loaded");
    rows.push(...result.data);
    pages = result.meta?.pages || 1;
    page++;
  } while (page <= pages);
  return rows;
}
