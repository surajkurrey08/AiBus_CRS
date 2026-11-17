import { useId, useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import "./master-sections.css";
export type MasterSection = { id: string; label: string; group: string };
export function MasterSectionLayout({
  label,
  sections,
  selected,
  onSelect,
  children,
}: {
  label: string;
  sections: MasterSection[];
  selected: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const groups = [...new Set(sections.map((section) => section.group))];
  return (
    <div className="master-section-layout">
      <nav className="master-section-nav" aria-label={`${label} navigation`}>
        <label className="master-section-mobile">
          Choose section
          <select
            aria-label={`${label} section`}
            value={selected}
            onChange={(e) => onSelect(e.target.value)}
          >
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {sections
                  .filter((section) => section.group === group)
                  .map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div
          className="master-section-desktop"
          role="tablist"
          aria-label={`${label} sections`}
          aria-orientation="vertical"
        >
          {groups.map((group) => (
            <div
              className="master-section-group"
              role="presentation"
              key={group}
            >
              <p aria-hidden="true">{group}</p>
              {sections
                .filter((section) => section.group === group)
                .map((section) => (
                  <button
                    type="button"
                    key={section.id}
                    ref={(button) => {
                      buttons.current[section.id] = button;
                    }}
                    role="tab"
                    id={`${id}-tab-${section.id}`}
                    aria-selected={selected === section.id}
                    aria-controls={`${id}-panel`}
                    tabIndex={selected === section.id ? 0 : -1}
                    onClick={() => onSelect(section.id)}
                    onKeyDown={(e) => {
                      const ordered = groups.flatMap((group) =>
                        sections.filter((section) => section.group === group),
                      );
                      const index = ordered.findIndex(
                        (s) => s.id === section.id,
                      );
                      const next =
                        e.key === "ArrowDown"
                          ? (index + 1) % ordered.length
                          : e.key === "ArrowUp"
                            ? (index + ordered.length - 1) % ordered.length
                            : e.key === "Home"
                              ? 0
                              : e.key === "End"
                                ? ordered.length - 1
                                : -1;
                      if (next < 0) return;
                      e.preventDefault();
                      onSelect(ordered[next].id);
                      buttons.current[ordered[next].id]?.focus();
                    }}
                  >
                    <span>{section.label}</span>
                    {selected === section.id && (
                      <ChevronRight size={15} aria-hidden="true" />
                    )}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </nav>
      <div
        className="master-section-content"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${selected}`}
      >
        {children}
      </div>
    </div>
  );
}
