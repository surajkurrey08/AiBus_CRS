import { ArrowUpRight, CalendarClock, MapPin, Car } from "lucide-react";
import "./masters.css";
const modules = [
  {
    id: 12,
    name: "Car Master",
    icon: Car,
    description:
      "Manage 4-seater and 7-seater cars, categories, and fleet records.",
    items: "Vehicles · 4/7-Passenger Capacities · Maintenance · Status",
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
    name: "Car Trip Master",
    icon: CalendarClock,
    description:
      "Manage One-Way and Round-Trip car trip schedules and journey operations.",
    items: "One Way · Round Trip · Seat inventory · Fares in paise",
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
