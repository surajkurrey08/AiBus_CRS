import { ArrowUpRight, CalendarClock, MapPin, Warehouse } from "lucide-react";
import "./masters.css";
const modules = [
  {
    id: 12,
    name: "Bus Master",
    icon: Warehouse,
    description:
      "Manage buses, seat layouts, crew, owners and vehicle records.",
    items: "Vehicles · Seat charts · Crew · GPS configuration",
  },
  {
    id: 13,
    name: "Area Master",
    icon: MapPin,
    description:
      "Configure service cities, pickup points, drop points and landmarks.",
    items: "Cities · Pickup / drop points · POI · Route stops",
  },
  {
    id: 14,
    name: "Trip Master",
    icon: CalendarClock,
    description:
      "Manage routes, services, trip schedules and journey operations.",
    items: "Routes · Scheduled trips · Availability · Operations",
  },
] as const;
export function MasterHub({
  onOpen,
}: {
  onOpen: (module: 12 | 13 | 14) => void;
}) {
  return (
    <section className="masters-hub" aria-label="Master modules">
      {modules.map(({ id, name, icon: Icon, description, items }) => (
        <button
          className="masters-hub-card"
          key={id}
          aria-label={name}
          onClick={() => onOpen(id)}
        >
          <span className="masters-hub-top">
            <span className="masters-hub-icon">
              <Icon size={27} aria-hidden="true" />
            </span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </span>
          <strong>{name}</strong>
          <span className="masters-hub-description">{description}</span>
          <span className="masters-hub-items">{items}</span>
        </button>
      ))}
    </section>
  );
}
