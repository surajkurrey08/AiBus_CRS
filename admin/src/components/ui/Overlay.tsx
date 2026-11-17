import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Overlay({
  title,
  onClose,
  children,
  drawer = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const el = ref.current;
    return () => el?.close();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-label={title}
      className={drawer ? "drawer" : "modal"}
      onCancel={onClose}
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
