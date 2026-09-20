"use client";
import type { FormAttribute } from "@/lib/taxonomy/types";
import { MULTI_VALUE } from "@/lib/taxonomy/types";

/* ONE ATTRIBUTE, DRAWN FROM ITS CONFIGURATION.
 *
 * Section 28 of the brief, and the whole point of the rebuild: there is no
 * branch here on a category, a subcategory or a product type. This
 * component has never heard of sofas. It is handed a row out of
 * `attributes` and draws the control that row's field_type names, so a
 * product type added next year through the attribute builder renders
 * correctly without anybody touching this file.
 *
 * A SELECT WITH NO OPTIONS BECOMES A TEXT BOX. The specification names 546
 * attributes and lists the values of almost none of them -- it says a
 * shirt has a "Collar Type" without ever saying what the collar types are.
 * An empty dropdown is a field nobody can fill, so it falls back to free
 * text, and the day somebody adds the options in the attribute builder it
 * becomes a dropdown everywhere it appears. The server-side validator
 * makes the same decision, in lib/taxonomy/validate.ts, or the two would
 * disagree about what is allowed.
 */

export default function AttributeField({
  attr, value, onChange, error, disabled,
}: {
  attr: FormAttribute;
  /** Always a list, even for single-valued fields, so one shape covers
   * both and the caller never has to ask which it is holding. */
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = `attr-${attr.id}`;
  const one = value[0] ?? "";
  const set = (v: string) => onChange(v === "" ? [] : [v]);

  const label = (
    <label htmlFor={id}>
      {attr.name}
      {attr.unit && <span className="attr-unit"> ({attr.unit})</span>}
      {attr.required && <span className="attr-req" aria-hidden="true"> *</span>}
    </label>
  );

  /* The props every control shares. aria-invalid and aria-describedby are
     how somebody using a screen reader finds out which field was refused
     -- without them the error text below is just unattached prose. */
  const common = {
    id, disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-err` : undefined,
    required: attr.required || undefined,
  };

  /* `err` on the WRAPPER, not just the message. The stylesheet hides
     .field .msg by default and reveals it with .field.err .msg -- so
     without this class the error is in the DOM, correctly announced to a
     screen reader, and drawn at zero by zero pixels. A sighted seller
     would get a toast saying something was wrong and no way to see which
     field it was. */
  return (
    <div className={"field" + (error ? " err" : "")}>
      {label}
      {renderControl()}
      {error && <p className="msg" id={`${id}-err`}>{error}</p>}
    </div>
  );

  function renderControl() {
    switch (attr.field_type) {
      case "boolean":
        /* A checkbox cannot say "not answered" -- unticked and "no" look
           identical -- so an optional boolean is three explicit choices
           and a required one is two. A sofa whose Reclining nobody filled
           in must not claim it does not recline. */
        return (
          <select {...common} value={one}
            onChange={(e) => set(e.target.value)}>
            {!attr.required && <option value="">—</option>}
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );

      case "select":
        if (!attr.options.length) return textInput();   // see the note above
        return (
          <select {...common} value={one} onChange={(e) => set(e.target.value)}>
            <option value="">—</option>
            {attr.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        );

      case "multiselect":
      case "tags": {
        if (!attr.options.length) {
          // Free-form list: comma separated, which is how somebody types a
          // handful of tags without a widget getting in the way.
          return (
            <input {...common} type="text"
              value={value.join(", ")}
              placeholder="Separate with commas"
              onChange={(e) => onChange(
                e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
          );
        }
        return (
          <div className="attr-checks" role="group" aria-labelledby={id}>
            {attr.options.map((o) => (
              <label key={o.value} className="attr-check">
                <input type="checkbox" disabled={disabled}
                  checked={value.includes(o.value)}
                  onChange={(e) => onChange(e.target.checked
                    ? [...value, o.value]
                    : value.filter((v) => v !== o.value))} />
                {o.label}
              </label>
            ))}
          </div>
        );
      }

      case "color":
        /* Both a swatch and a box. The swatch is how somebody picks a
           colour; the box is how they type "Navy" when the shop's colours
           are names rather than hexes, which in a clothing catalogue they
           usually are. */
        return (
          <div className="attr-color">
            <input type="color" disabled={disabled}
              value={/^#[0-9a-f]{6}$/i.test(one) ? one : "#000000"}
              onChange={(e) => set(e.target.value)}
              aria-label={`${attr.name} swatch`} />
            <input {...common} type="text" value={one}
              onChange={(e) => set(e.target.value)} placeholder="Black, or #101010" />
          </div>
        );

      case "number": case "decimal": case "currency": case "range":
        return (
          <input {...common} type="number" value={one}
            min={attr.validation.min} max={attr.validation.max}
            step={attr.validation.step ?? (attr.field_type === "number" ? 1 : "any")}
            onChange={(e) => set(e.target.value)} />
        );

      case "date":
        return <input {...common} type="date" value={one}
          onChange={(e) => set(e.target.value)} />;

      case "datetime":
        return <input {...common} type="datetime-local" value={one}
          onChange={(e) => set(e.target.value)} />;

      case "textarea": case "richtext":
        return <textarea {...common} rows={4} value={one}
          maxLength={attr.validation.maxLength}
          onChange={(e) => set(e.target.value)} />;

      case "dimensions":
        /* Width x height x depth in one row, stored as one string. Three
           separate attributes would have been the alternative, but the
           specification lists "Dimensions" as a single field and splitting
           it would put three rows on a form that asked for one. */
        return <input {...common} type="text" value={one}
          placeholder="W x H x D"
          onChange={(e) => set(e.target.value)} />;

      default:
        return textInput();
    }
  }

  function textInput() {
    return (
      <input {...common} type="text" value={one}
        maxLength={attr.validation.maxLength}
        onChange={(e) => set(e.target.value)} />
    );
  }
}

/** Whether this attribute holds several values at once -- re-exported so a
 * form can ask without reaching into the types module. */
export function isMultiValue(attr: FormAttribute): boolean {
  return MULTI_VALUE.has(attr.field_type) ||
    (attr.field_type === "multiselect");
}
