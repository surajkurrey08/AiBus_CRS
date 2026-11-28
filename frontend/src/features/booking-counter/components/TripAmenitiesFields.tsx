import {
  Armchair,
  BatteryCharging,
  Briefcase,
  Coffee,
  GlassWater,
  Lightbulb,
  Navigation,
  Newspaper,
  Snowflake,
  Sparkles,
  Usb,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";

const amenityMeta: { name: string; icon: ReactNode }[] = [
  { name: "AC", icon: <Snowflake size={14} /> },
  { name: "Wi-Fi", icon: <Wifi size={14} /> },
  { name: "USB charging", icon: <Usb size={14} /> },
  { name: "Type-C charging", icon: <BatteryCharging size={14} /> },
  { name: "Luggage space", icon: <Briefcase size={14} /> },
  { name: "Water bottle", icon: <GlassWater size={14} /> },
  { name: "Reclining seats", icon: <Armchair size={14} /> },
  { name: "Reading light", icon: <Lightbulb size={14} /> },
  { name: "Onboard toilet", icon: <Sparkles size={14} /> },
  { name: "GPS tracking", icon: <Navigation size={14} /> },
  { name: "Snacks", icon: <Coffee size={14} /> },
  { name: "Newspaper", icon: <Newspaper size={14} /> },
];

const iconMap = new Map(amenityMeta.map((item) => [item.name, item.icon]));

export function TripAmenitiesFields({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const names = [...new Set([...amenityMeta.map((item) => item.name), ...value])];
  return (
    <fieldset className="trip-amenities" disabled={disabled}>
      <legend>Amenities</legend>
      {names.map((name) => {
        const checked = value.includes(name);
        return (
          <label
            key={name}
            className={`crs-amenity-pill${checked ? " checked" : ""}`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, name]
                    : value.filter((item) => item !== name),
                )
              }
            />
            <span className="crs-amenity-icon" aria-hidden="true">
              {iconMap.get(name) || <Sparkles size={14} />}
            </span>
            <span>{name}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
