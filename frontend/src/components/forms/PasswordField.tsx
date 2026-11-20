import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import "./PasswordField.css";

/** Masked by default; visibility never changes or persists the input value. */
export const PasswordField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function PasswordField(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-control">
      <input {...props} ref={ref} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="password-visibility"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? (
          <EyeOff size={18} aria-hidden="true" />
        ) : (
          <Eye size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  );
});
