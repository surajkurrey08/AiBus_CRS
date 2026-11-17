import { type ReactNode } from "react";

export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <h3>{title}</h3>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
