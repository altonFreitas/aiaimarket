"use client";
import { useId, useState } from "react";

/* A password box with a show/hide eye.
 *
 * One component for every password field in the app -- the admin login,
 * the seller forms, the customer account, adding a staff account and
 * resetting one. The toggle is a real button with aria-pressed rather
 * than a decorated span: it changes state, so it has to be reachable from
 * a keyboard and announceable. type="button" because these live inside
 * forms, where the default would submit them.
 *
 * The positioning lives in globals.css as .pw-wrap / .pw-eye rather than
 * inline, so the six callers cannot drift apart. */
export default function PasswordField({
  id: idProp, label, value, onChange, autoComplete, minLength, required,
  placeholder, hint,
}: {
  id?: string;
  /** Omit to render the input alone -- for a table row, where a label
   * above it would break the layout and repeat the column heading. */
  label?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  placeholder?: string;
  hint?: React.ReactNode;
}) {
  const generated = useId();
  const id = idProp || generated;
  const [show, setShow] = useState(false);

  const input = (
    <div className="pw-wrap">
      <input
        id={id} type={show ? "text" : "password"} required={required} minLength={minLength}
        autoComplete={autoComplete} placeholder={placeholder}
        value={value} onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="pw-eye" onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );

  if (!label) return input;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a17.6 17.6 0 0 1-2.16 3.19m-3.3 2.87A9.12 9.12 0 0 1 12 20c-7 0-11-8-11-8a17.6 17.6 0 0 1 4.22-5.94" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}
