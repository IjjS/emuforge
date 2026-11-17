import { creationDateText, NO_DATE } from '../../components/format-date';
import { AWS_PATH } from '../../../identity';

// How the Lambda screens write a function's values (issue 84, requirement R4.2, R5.3, R5.5), and the routes their
// controls lead to (R0, R8). Times are written by the area's shared `components/format-date.ts` (issue 386, R7).

/** Shown for a value the answer lacks. */
export const NONE = '-';

/** Lambda's route in the area, `/aws/lambda`. */
export const LAMBDA_PATH = `${AWS_PATH}/lambda`;

/** The function list, "Event Functions". */
export const FUNCTIONS_PATH = `${LAMBDA_PATH}/functions`;

/** "Create Event Function". */
export const CREATE_FUNCTION_PATH = `${FUNCTIONS_PATH}/create`;

/** A function's own page; the segment `function/` keeps a function named `create` off the create form's route. */
export function functionPath(name: string): string {
  return `${FUNCTIONS_PATH}/function/${encodeURIComponent(name)}`;
}

/** The tabs of a function's page other than "Code", each a route of its own (R8). */
export type FunctionTab = 'test' | 'monitor' | 'configuration' | 'aliases' | 'versions';

export function functionTabPath(name: string, tab: FunctionTab): string {
  return `${functionPath(name)}/${tab}`;
}

// The console's name of each runtime identifier of the user guide's table (`lambda-runtimes`), ".x" kept where the
// identifier ends in ".x", as the capture writes "Node.js 24.x".
const RUNTIME_NAMES: Readonly<Record<string, string>> = {
  'nodejs24.x': 'Node.js 24.x',
  'nodejs22.x': 'Node.js 22.x',
  'nodejs20.x': 'Node.js 20.x',
  'nodejs18.x': 'Node.js 18.x',
  'nodejs16.x': 'Node.js 16.x',
  'python3.14': 'Python 3.14',
  'python3.13': 'Python 3.13',
  'python3.12': 'Python 3.12',
  'python3.11': 'Python 3.11',
  'python3.10': 'Python 3.10',
  'python3.9': 'Python 3.9',
  'python3.8': 'Python 3.8',
  java25: 'Java 25',
  java21: 'Java 21',
  java17: 'Java 17',
  'java17.al2023': 'Java 17',
  java11: 'Java 11',
  'java11.al2023': 'Java 11',
  'java8.al2': 'Java 8',
  'java8.al2023': 'Java 8',
  java8: 'Java 8',
  dotnet10: '.NET 10',
  dotnet8: '.NET 8',
  dotnet6: '.NET 6',
  'ruby3.4': 'Ruby 3.4',
  'ruby3.3': 'Ruby 3.3',
  'ruby3.2': 'Ruby 3.2',
  'provided.al2023': 'OS-only Runtime',
  'provided.al2': 'OS-only Runtime',
  provided: 'OS-only Runtime',
};

/** "Runtime": the console's name for an identifier of the table, any other value as it came, "-" for none. */
export function runtimeText(runtime: string | undefined): string {
  if (runtime === undefined || runtime === '') {
    return NONE;
  }
  return Object.hasOwn(RUNTIME_NAMES, runtime) ? (RUNTIME_NAMES[runtime] ?? runtime) : runtime;
}

/** "Type": "Durable" for a function with `DurableConfig`, "Standard" otherwise (question 6). */
export function typeText(durable: boolean): string {
  return durable ? 'Durable' : 'Standard';
}

/** A text value as it came, "-" when empty or missing: "Description", "Package type", "Handler", the ARN. */
export function valueText(value: string | undefined): string {
  return value === undefined || value === '' ? NONE : value;
}

/** "Architecture": the architectures, comma-separated; "-" for none. */
export function architecturesText(architectures: readonly string[] | undefined): string {
  return architectures === undefined || architectures.length === 0 ? NONE : architectures.join(', ');
}

/**
 * "Last modified": an instant as the area writes a time, in `timeZone` (the browser's when omitted); a value that is
 * not a time as it came; "-" for none.
 */
export function lastModifiedText(lastModified: Date | string | undefined, timeZone?: string): string {
  if (lastModified === undefined || lastModified === '') {
    return NO_DATE;
  }
  return typeof lastModified === 'string' ? lastModified : creationDateText(lastModified, timeZone);
}
