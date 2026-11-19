import type { EnvironmentVariable } from './api';

// The checks of the "Edit" dialogs of a function's page (issue 516, design "Task 5"; requirement "EmuForge's own
// text"): what Studio refuses before it sends `UpdateFunctionConfiguration`. Each limit is one the emulator refused
// past (probe 4). Everything else the emulator refuses is shown as it answers.

/** The reason on an action that changes a function while it is being created or updated. */
export const NOT_READY = 'Wait until the function is ready.';

export const MEMORY_MIN = 128;
export const MEMORY_MAX = 10240;
export const TIMEOUT_MIN = 1;
export const TIMEOUT_MAX = 900;
export const DESCRIPTION_MAX = 256;
export const HANDLER_MAX = 128;

/** The constraint texts, shown beside their fields from the start. */
export const HANDLER_RULE = '1 to 128 characters, no spaces.';
export const DESCRIPTION_RULE = 'Up to 256 characters.';
export const MEMORY_RULE = 'A whole number from 128 to 10240.';
export const TIMEOUT_RULE = 'A whole number from 1 to 900.';

export const HANDLER_EMPTY = 'Enter a handler.';
export const HANDLER_TOO_LONG = 'The handler can have up to 128 characters.';
export const HANDLER_SPACES = 'The handler cannot contain spaces.';
export const DESCRIPTION_TOO_LONG = 'The description can have up to 256 characters.';
export const MEMORY_OUT_OF_RANGE = 'Enter a whole number from 128 to 10240.';
export const TIMEOUT_OUT_OF_RANGE = 'Enter a whole number from 1 to 900.';
export const KEY_EMPTY = 'Enter a key.';
export const KEY_USED = 'This key is already used.';

/** A field's value as sent, or the message shown at the field. */
export type Checked<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

function wholeNumber(text: string, min: number, max: number, message: string): Checked<number> {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { error: message };
  }
  const value = Number(trimmed);
  return value >= min && value <= max ? { value } : { error: message };
}

/** "Memory (MB)": a whole number from 128 to 10240. */
export function checkMemory(text: string): Checked<number> {
  return wholeNumber(text, MEMORY_MIN, MEMORY_MAX, MEMORY_OUT_OF_RANGE);
}

/** "Timeout (seconds)": a whole number from 1 to 900. */
export function checkTimeout(text: string): Checked<number> {
  return wholeNumber(text, TIMEOUT_MIN, TIMEOUT_MAX, TIMEOUT_OUT_OF_RANGE);
}

/** "Description": up to 256 characters, sent as typed. */
export function checkDescription(text: string): Checked<string> {
  return text.length > DESCRIPTION_MAX ? { error: DESCRIPTION_TOO_LONG } : { value: text };
}

/** "Handler": filled, at most 128 characters, no white space; the rule that failed first, in that order. */
export function checkHandler(text: string): Checked<string> {
  if (text === '') {
    return { error: HANDLER_EMPTY };
  }
  if (text.length > HANDLER_MAX) {
    return { error: HANDLER_TOO_LONG };
  }
  if (/\s/.test(text)) {
    return { error: HANDLER_SPACES };
  }
  return { value: text };
}

/** One row of the variables' editor, as typed. */
export interface VariableRow {
  key: string;
  value: string;
}

/**
 * The message of each row's key, in the rows' order: "Enter a key." for a row without one, "This key is already
 * used." for a key an earlier row has; `undefined` for a row that is fine. An empty value is fine.
 */
export function checkVariableRows(rows: readonly VariableRow[]): (string | undefined)[] {
  const seen = new Set<string>();
  return rows.map(({ key }) => {
    if (key === '') {
      return KEY_EMPTY;
    }
    if (seen.has(key)) {
      return KEY_USED;
    }
    seen.add(key);
    return undefined;
  });
}

/** The variables sent for `rows`: the whole map, in the rows' order; none when there are no rows. */
export function variablesOf(rows: readonly VariableRow[]): EnvironmentVariable[] {
  return rows.map(({ key, value }) => ({ key, value }));
}
