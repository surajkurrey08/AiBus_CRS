import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./overlay.css";
let openDialogs = 0;
let previousBodyOverflow = "";

export function Overlay({
  title,
  onClose,
  children,
  drawer = false,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  drawer?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    if (openDialogs++ === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const el = ref.current;
    return () => {
      el?.close();
      if (--openDialogs === 0)
        document.body.style.overflow = previousBodyOverflow;
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-label={title}
      className={`${drawer ? "drawer" : "modal"} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-head">
        <h3>{title}</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
