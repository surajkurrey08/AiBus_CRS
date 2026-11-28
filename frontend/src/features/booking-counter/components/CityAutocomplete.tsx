import { MapPin, X } from "lucide-react";
import { useId, useMemo, useState, type RefObject } from "react";

interface CityAutocompleteProps {
  label: string;
  ariaLabel: string;
  clearAriaLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSelectCity?: (city: string) => void;
  cities: string[];
  preferredCities?: string[];
  disabled?: boolean;
  clearDisabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/** Searchable city combobox showing matching route/via cities as the user types. */
export function CityAutocomplete({
  label,
  ariaLabel,
  clearAriaLabel,
  placeholder,
  value,
  onChange,
  onSelectCity,
  cities,
  preferredCities = [],
  disabled = false,
  clearDisabled = false,
  inputRef,
}: CityAutocompleteProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    const preferredSet = new Set(preferredCities.map((c) => c.trim().toLowerCase()));
    const merged: { city: string; preferred: boolean }[] = [];
    const seen = new Set<string>();

    for (const raw of [...preferredCities, ...cities]) {
      const city = raw.trim();
      const key = city.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({ city, preferred: preferredSet.has(key) });
    }

    const filtered = query
      ? merged.filter((item) => item.city.toLowerCase().includes(query))
      : merged;

    filtered.sort((a, b) => {
      if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
      if (query) {
        const aStarts = a.city.toLowerCase().startsWith(query);
        const bStarts = b.city.toLowerCase().startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
      }
      return a.city.localeCompare(b.city);
    });

    return filtered.slice(0, 12);
  }, [cities, preferredCities, value]);

  const showMenu = open && !disabled && suggestions.length > 0;
  const clampedIndex =
    suggestions.length > 0 ? Math.min(Math.max(activeIndex, 0), suggestions.length - 1) : -1;

  function pickCity(city: string) {
    onChange(city);
    setOpen(false);
    setActiveIndex(0);
    onSelectCity?.(city);
  }

  function renderHighlighted(city: string) {
    const query = value.trim();
    if (!query) return city;
    const idx = city.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return city;
    return (
      <>
        {city.slice(0, idx)}
        <strong>{city.slice(idx, idx + query.length)}</strong>
        {city.slice(idx + query.length)}
      </>
    );
  }

  return (
    <label className="crs-city-field">
      {label}
      <div className="counter-input">
        <MapPin size={14} />
        <input
          ref={inputRef}
          aria-label={ariaLabel}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showMenu}
          aria-controls={showMenu ? listId : undefined}
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (!suggestions.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActiveIndex((prev) => (prev + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
            } else if (e.key === "Enter" && showMenu && clampedIndex >= 0) {
              const candidate = suggestions[clampedIndex]?.city;
              if (candidate && candidate.toLowerCase() !== value.trim().toLowerCase()) {
                e.preventDefault();
                pickCity(candidate);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
        {value && (
          <button
            type="button"
            aria-label={clearAriaLabel}
            disabled={clearDisabled}
            onClick={() => {
              onChange("");
              setOpen(true);
              setActiveIndex(0);
              inputRef?.current?.focus();
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {showMenu && (
        <ul className="crs-city-suggest" id={listId} role="listbox" aria-label={`${label} suggestions`}>
          {suggestions.map((item, index) => (
            <li
              key={item.city}
              role="option"
              aria-selected={index === clampedIndex}
              className={index === clampedIndex ? "is-active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pickCity(item.city);
              }}
            >
              <span className="crs-city-name">
                <MapPin size={12} />
                <span>{renderHighlighted(item.city)}</span>
              </span>
              {item.preferred && <span className="crs-city-tag">Route stop</span>}
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
