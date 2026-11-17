export function MiniStats({ items }: { items: string[][] }) {
  return (
    <div className="mini-stats">
      {items.map(([value, label]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
