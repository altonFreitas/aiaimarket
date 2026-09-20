import type { FieldType } from "./fieldTypes";

/** A category or subcategory. Both are rows in `categories`; a subcategory
 * is one with a parent. */
export interface TaxonomyNode {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
}

export interface ProductType {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  display_order: number;
}

/** An attribute as the form needs it: the attribute itself, plus what THIS
 * product type says about it (required, where in the order) and the
 * options it offers. */
export interface FormAttribute {
  id: string;
  name: string;
  slug: string;
  field_type: FieldType;
  unit: string | null;
  is_variant: boolean;
  required: boolean;
  display_order: number;
  admin_only: boolean;
  validation: AttributeValidation;
  options: { label: string; value: string }[];
}

/** What `attributes.validation` may carry. Every key optional -- each field
 * type uses the ones that mean something to it. */
export interface AttributeValidation {
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  /** A regular expression the value must match, as a string. */
  pattern?: string;
}

/** One answer a product gives. `value` is always the stored text; `num` is
 * the same thing as a number where it is one. */
export interface AttributeValue {
  attribute_id: string;
  value: string;
  value_num: number | null;
}

/** Which field types hold more than one value at once. */
export const MULTI_VALUE: ReadonlySet<FieldType> =
  new Set<FieldType>(["multiselect", "tags"]);

/** Which field types are numbers, and so also get value_num. */
export const NUMERIC: ReadonlySet<FieldType> =
  new Set<FieldType>(["number", "decimal", "currency", "range"]);
