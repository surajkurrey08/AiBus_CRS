import { type Row } from "../data/demo-data.ts";

export function exportCsv(rows: Row[], name: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys, ...rows.map((r) => keys.map((k) => r[k]))]
    .map((row) =>
      row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
    )
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  a.download = `aibus-${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
