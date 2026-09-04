"use client";

/* The last line of defence: an error in the ROOT layout itself.
 *
 * Everything else -- the header, the footer, the stylesheet, the language
 * cookie helper -- lives inside that layout, and if it has failed none of
 * it is available. So this file assumes nothing: no imports beyond React,
 * no site CSS, no translations, and its own <html> and <body>, because at
 * this point nothing else has rendered them.
 *
 * The styling is inline for the same reason. If the reason the layout
 * failed is that the stylesheet did not load, a class name here would be
 * decoration on a blank page.
 *
 * English only, deliberately. Reading the language cookie means running
 * code, and this is the one screen that has to work when running code is
 * what went wrong. */
export default function GlobalError(
  { error, reset }: { error: Error & { digest?: string }; reset: () => void }
) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: "100vh", display: "grid", placeItems: "center",
        background: "#eceff3", color: "#152341",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}>
        <main style={{ textAlign: "center", padding: 24, maxWidth: 520 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 16px", color: "#5c6779", lineHeight: 1.5 }}>
            The shop could not be loaded. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: "inherit", fontWeight: 600, cursor: "pointer",
              padding: "9px 18px", borderRadius: 8,
              border: "1px solid #6b4e00", background: "#f2b705", color: "#152341",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 16, fontSize: 12, color: "#8590a2",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              Error reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
