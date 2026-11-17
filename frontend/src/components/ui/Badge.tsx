export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${["Cancelled", "Inactive"].includes(value) ? "red" : ["Pending", "Awaiting", "Scheduled", "Requested", "Not connected"].includes(value) ? "amber" : "green"}`}
    >
      <i />
      {value}
    </span>
  );
}
