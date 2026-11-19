import type { AttributeValue } from '@aws-sdk/client-dynamodb';

import { base64ToBytes } from './item-json';

// The filter of S2's "Items" (issue 512, design.md): conditions on attributes, each a name, a comparison and for most
// comparisons a typed value, joined with `AND` into a `FilterExpression`. Every name and value goes in as a
// placeholder of the filter's own (`#f{i}`, `:f{i}`, `:f{i}u`), never into the expression, so a reserved word, a
// period or a space in a name is one top-level attribute, and the placeholders never meet a query's (`#pk`, `#sk`,
// `:pk`, `:sk1`, `:sk2`). Only what the expression uses is sent: the emulator refuses a placeholder given and not used.

/** A comparison of a condition. */
export type Comparison =
  | '='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'between'
  | 'begins_with'
  | 'contains'
  | 'not_contains'
  | 'exists'
  | 'not_exists';

/** A value's type: String, Number, Binary, Boolean, Null. */
export type ValueType = 'S' | 'N' | 'B' | 'BOOL' | 'NULL';

/** One condition as its row holds it. */
export interface Condition {
  name: string;
  comparison: Comparison;
  type: ValueType;
  /** The value as written: a String's text, a Number's text, a Binary's base64. */
  value: string;
  /** The upper bound of "Between", as written. */
  upper: string;
  /** A Boolean's choice. */
  bool: boolean;
}

/** A new row: no name, "Equal to", "String", no value, a Boolean's choice "true". */
export const NEW_CONDITION: Condition = { name: '', comparison: '=', type: 'S', value: '', upper: '', bool: true };

/** The type names the screen gives. */
export const TYPE_LABELS: Readonly<Record<ValueType, string>> = {
  S: 'String',
  N: 'Number',
  B: 'Binary',
  BOOL: 'Boolean',
  NULL: 'Null',
};

const EVERY_TYPE: readonly ValueType[] = ['S', 'N', 'B', 'BOOL', 'NULL'];
const ORDERED: readonly ValueType[] = ['S', 'N', 'B'];

/** Each comparison: its label and the types it is offered for, each seen to work on the emulator (requirement.md). */
export const COMPARISONS: readonly { value: Comparison; label: string; types: readonly ValueType[] }[] = [
  { value: '=', label: 'Equal to', types: EVERY_TYPE },
  { value: '<>', label: 'Not equal to', types: EVERY_TYPE },
  { value: '<', label: 'Less than', types: ORDERED },
  { value: '<=', label: 'Less than or equal to', types: ORDERED },
  { value: '>', label: 'Greater than', types: ORDERED },
  { value: '>=', label: 'Greater than or equal to', types: ORDERED },
  { value: 'between', label: 'Between', types: ORDERED },
  { value: 'begins_with', label: 'Begins with', types: ['S', 'B'] },
  { value: 'contains', label: 'Contains', types: ORDERED },
  { value: 'not_contains', label: 'Does not contain', types: ORDERED },
  { value: 'exists', label: 'Exists', types: [] },
  { value: 'not_exists', label: 'Does not exist', types: [] },
];

/** The types `comparison` is offered for; none for "Exists" and "Does not exist". */
export function typesOf(comparison: Comparison): readonly ValueType[] {
  return COMPARISONS.find((each) => each.value === comparison)?.types ?? [];
}

/** The comparison takes a name only, no type and no value. */
export function takesNoValue(comparison: Comparison): boolean {
  return typesOf(comparison).length === 0;
}

/** The type a row shows for `comparison`: its own when the comparison offers it, else "String". */
export function typeFor(comparison: Comparison, type: ValueType): ValueType {
  return typesOf(comparison).includes(type) ? type : 'S';
}

/** The messages under a condition's fields, each while its check fails. */
export interface ConditionErrors {
  name?: string;
  value?: string;
  upper?: string;
}

const NAME_MISSING = 'Enter an attribute name.';
const NOT_BASE64 = 'Enter the value in base64.';

/**
 * The checks "Run" makes of `conditions`, by position; an empty list when every one passes. Everything else (a Number
 * that is no number, an empty value, bounds in the wrong order, a key attribute in a query's filter) is the
 * emulator's rule, shown as it answers.
 */
export function checkConditions(conditions: readonly Condition[]): (ConditionErrors | undefined)[] {
  const errors = conditions.map((condition) => {
    const found: ConditionErrors = {};
    if (condition.name === '') {
      found.name = NAME_MISSING;
    }
    const type = typeFor(condition.comparison, condition.type);
    if (!takesNoValue(condition.comparison) && type === 'B') {
      if (base64ToBytes(condition.value) === undefined) {
        found.value = NOT_BASE64;
      }
      if (condition.comparison === 'between' && base64ToBytes(condition.upper) === undefined) {
        found.upper = NOT_BASE64;
      }
    }
    return Object.keys(found).length === 0 ? undefined : found;
  });
  return errors.some((each) => each !== undefined) ? errors : [];
}

/** A condition's Binary value was not base64; nothing was sent. */
export class FilterValueError extends Error {
  constructor(position: number) {
    super(`The value of condition ${String(position + 1)} is not base64 text.`);
    this.name = 'FilterValueError';
  }
}

/** The value written as `type`; throws `FilterValueError` for a Binary that is not base64. */
function valueOf(type: ValueType, text: string, bool: boolean, position: number): AttributeValue {
  switch (type) {
    case 'S':
      return { S: text };
    case 'N':
      return { N: text };
    case 'B': {
      const bytes = base64ToBytes(text);
      if (bytes === undefined) {
        throw new FilterValueError(position);
      }
      return { B: bytes };
    }
    case 'BOOL':
      return { BOOL: bool };
    case 'NULL':
      return { NULL: true };
  }
}

/** The members a filter adds to a `Scan` or a `Query`. */
export interface FilterMembers {
  expression: string;
  names: Record<string, string>;
  values: Record<string, AttributeValue>;
}

/** The part of the expression of condition `i`, by its comparison. */
function partOf(comparison: Comparison, name: string, value: string): string {
  switch (comparison) {
    case 'between':
      return `${name} BETWEEN ${value} AND ${value}u`;
    case 'begins_with':
      return `begins_with(${name}, ${value})`;
    case 'contains':
      return `contains(${name}, ${value})`;
    case 'not_contains':
      return `NOT contains(${name}, ${value})`;
    case 'exists':
      return `attribute_exists(${name})`;
    case 'not_exists':
      return `attribute_not_exists(${name})`;
    default:
      return `${name} ${comparison} ${value}`;
  }
}

/**
 * The `FilterExpression` of `conditions` and its placeholders, or `undefined` for none. Condition `i` (from 0) sends
 * its name as `#f{i}`, its value as `:f{i}` and the upper bound of "Between" as `:f{i}u`; the parts are joined with
 * ` AND ` in the rows' order.
 */
export function filterMembers(conditions: readonly Condition[]): FilterMembers | undefined {
  if (conditions.length === 0) {
    return undefined;
  }
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const parts = conditions.map((condition, position) => {
    const name = `#f${String(position)}`;
    const value = `:f${String(position)}`;
    names[name] = condition.name;
    if (!takesNoValue(condition.comparison)) {
      const type = typeFor(condition.comparison, condition.type);
      values[value] = valueOf(type, condition.value, condition.bool, position);
      if (condition.comparison === 'between') {
        values[`${value}u`] = valueOf(type, condition.upper, condition.bool, position);
      }
    }
    return partOf(condition.comparison, name, value);
  });
  return { expression: parts.join(' AND '), names, values };
}
