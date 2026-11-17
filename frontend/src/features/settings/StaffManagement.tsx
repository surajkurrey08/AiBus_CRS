import { Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { DataTable, Panel, RecordForm } from "../../components/index.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import type { Row } from "../../data/demo-data.ts";
import { normalize } from "../../utils/normalize.ts";

export function LiveStaff() {
  const ws = useWorkspace(),
    [form, setForm] = useState<Row | null>(null);
  if (!ws.user.permissions.includes("staff:write"))
    return (
      <Panel>
        <div className="empty">
          Only operator administrators can manage staff access.
        </div>
      </Panel>
    );
  return (
    <>
      <div className="section-heading">
        <h3>Team access</h3>
        <button className="btn primary" onClick={() => setForm({})}>
          <Plus size={15} />
          Add staff
        </button>
      </div>
      <DataTable
        rows={(ws.raw.staff || []).map((r) => normalize("staff", r))}
        columns={[
          ["name", "Name"],
          ["email", "Email"],
          ["role", "Role"],
          ["status", "Status"],
        ]}
        title="staff"
        onEdit={(r) => setForm(r)}
      />
      {form && (
        <RecordForm
          title={form.id ? "Edit staff access" : "Add staff"}
          fields={
            form.id
              ? ["name", "role", "status"]
              : ["name", "email", "password", "role"]
          }
          record={form}
          onClose={() => setForm(null)}
          onSave={async (values) => {
            const payload = form.id
              ? {
                  name: values.name,
                  role: values.role,
                  active: values.status === "Active",
                }
              : values;
            await api("/operator/staff" + (form.id ? "/" + form.id : ""), {
              method: form.id ? "PATCH" : "POST",
              body: JSON.stringify(payload),
            });
            setForm(null);
            await ws.refresh();
            ws.notify("Staff access saved");
          }}
        />
      )}
    </>
  );
}
