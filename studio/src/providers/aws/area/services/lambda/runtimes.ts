// The one list of runtimes Studio offers (issue 516, requirement "S3 (task 4)"): ten of the identifiers the emulator
// ran (probe 6), in the order the create form and "Edit" of "Runtime settings" offer them. `nodejs16.x`,
// `python3.8` and older ones also run, but AWS no longer lets a function be created with them, so none is offered.

/** The language of a runtime, which decides its starter code. */
export type RuntimeLanguage = 'nodejs' | 'python';

/** A runtime Studio offers: the console's name, the API's identifier and its language. */
export interface OfferedRuntime {
  label: string;
  value: string;
  language: RuntimeLanguage;
}

/** The ten runtimes offered, in order; the first is chosen at start. */
export const RUNTIMES: readonly OfferedRuntime[] = [
  { label: 'Node.js 24.x', value: 'nodejs24.x', language: 'nodejs' },
  { label: 'Node.js 22.x', value: 'nodejs22.x', language: 'nodejs' },
  { label: 'Node.js 20.x', value: 'nodejs20.x', language: 'nodejs' },
  { label: 'Node.js 18.x', value: 'nodejs18.x', language: 'nodejs' },
  { label: 'Python 3.14', value: 'python3.14', language: 'python' },
  { label: 'Python 3.13', value: 'python3.13', language: 'python' },
  { label: 'Python 3.12', value: 'python3.12', language: 'python' },
  { label: 'Python 3.11', value: 'python3.11', language: 'python' },
  { label: 'Python 3.10', value: 'python3.10', language: 'python' },
  { label: 'Python 3.9', value: 'python3.9', language: 'python' },
];

/** The offered runtime of identifier `runtime`, or `undefined` for one Studio does not offer. */
export function offeredRuntime(runtime: string | undefined): OfferedRuntime | undefined {
  return RUNTIMES.find(({ value }) => value === runtime);
}

/** One option of a runtime field: its label and its identifier. */
export interface RuntimeOption {
  label: string;
  value: string;
}

/**
 * The options of a runtime field for a function whose runtime is `current`: the ten, and after them `current` as
 * the emulator names it when it is another one, so the function's own runtime stays selectable.
 */
export function runtimeOptions(current?: string): RuntimeOption[] {
  const options = RUNTIMES.map(({ label, value }) => ({ label, value }));
  if (current !== undefined && current !== '' && offeredRuntime(current) === undefined) {
    options.push({ label: current, value: current });
  }
  return options;
}
