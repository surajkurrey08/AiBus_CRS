import type { ReactNode } from "react";
import "../../styles/counter-crs.css";

export function MiniBusCabin({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <div className="mini-bus-cabin counter-crs" role="group" aria-label="Mini bus seat layout"
      style={{ width: `min(100%, ${Math.max(264, columns * 66 + 50)}px)` }}>
      <div className="mini-bus-nose" aria-hidden="true" />
      <div className="mini-bus-windshield">Front of mini bus</div>
      <div className="mini-bus-seat-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {children}
      </div>
      <div className="mini-bus-rear" aria-hidden="true" />
    </div>
  );
}
