"use client";
import { useState } from "react";

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

/** Reusable password field with a show/hide eye-icon toggle — same
 * pattern already used in the admin LoginForm, pulled out here so the
 * new seller register/login forms don't duplicate the SVGs and toggle
 * logic a second and third time. */
export default function PasswordField({
  id, label, value, onChange, autoComplete, minLength, required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          id={id} type={show ? "text" : "password"} required={required} minLength={minLength}
          autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)}
          style={{ paddingRight: 40 }}
        />
        <button type="button" onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
          style={{
            position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
            width: 32, height: 32, border: 0, background: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--muted)", borderRadius: 6,
          }}>
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}
