import { AWS_PATH } from '../../../identity';

// How the IAM screens write what the emulator holds (issue 82, requirement R4.2, R5.3), and the routes their
// controls lead to (R0, R8). Every value comes from the emulator's answer and is untrusted text.

/** Shown for a value the answer lacks, an empty description, or a trust policy that cannot be read. */
export const NO_VALUE = '-';

/** IAM's route in the area, `/aws/iam`. */
export const IAM_PATH = `${AWS_PATH}/iam`;

/** The role list. */
export const ROLES_PATH = `${IAM_PATH}/roles`;

/** "Create role". */
export const CREATE_ROLE_PATH = `${ROLES_PATH}/create`;

/** A role's own page, the link of its name: the name as one path segment, percent-encoded. */
export function rolePath(name: string): string {
  return `${ROLES_PATH}/details/${encodeURIComponent(name)}`;
}

/** The tabs of a role's page that lead to their own routes (R8). */
export type RoleTab = 'trust-relationships' | 'tags' | 'last-accessed' | 'revoke-sessions';

/** A tab of a role's page. */
export function roleTabPath(name: string, tab: RoleTab): string {
  return `${rolePath(name)}/${tab}`;
}

/** A service-linked role's path starts so; the emulator goes by the path (requirement R2, R7). */
export const SERVICE_LINKED_PATH_PREFIX = '/aws-service-role/';

export function isServiceLinked(path: string | undefined): boolean {
  return path?.startsWith(SERVICE_LINKED_PATH_PREFIX) ?? false;
}

/**
 * A policy document as the SDK gives it, percent-encoded once, read as the JSON document it encodes; `undefined`
 * when it is missing or is not JSON. A text that is not valid percent-encoding is read as it came.
 */
export function readPolicyDocument(document: string | undefined): unknown {
  if (document === undefined) {
    return undefined;
  }
  let decoded = document;
  try {
    decoded = decodeURIComponent(document);
  } catch {
    // Not percent-encoded: read as it came.
  }
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    return undefined;
  }
}

const SERVICE_SUFFIX = '.amazonaws.com';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The principals of one statement, in the document's order, each written as the role list writes it. */
function principalsOf(principal: unknown): string[] {
  if (principal === '*') {
    return ['*'];
  }
  if (!isRecord(principal)) {
    return [];
  }
  return Object.entries(principal).flatMap(([kind, value]) => {
    const values = (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string');
    return values.map((item) =>
      kind === 'Service'
        ? `AWS Service: ${item.endsWith(SERVICE_SUFFIX) ? item.slice(0, -SERVICE_SUFFIX.length) : item}`
        : `${kind}: ${item}`,
    );
  });
}

/**
 * "Trusted entities" (R4.2): every principal of every statement of the trust policy, in the document's order, each
 * once, joined by ", "; " (Service-linked role)" at the end for a role under `/aws-service-role/`. "-" for a document
 * without a principal, or one that cannot be read as JSON.
 */
export function trustedEntitiesText(document: string | undefined, path: string | undefined): string {
  const parsed = readPolicyDocument(document);
  const statement = isRecord(parsed) ? parsed.Statement : undefined;
  const statements = Array.isArray(statement) ? (statement as unknown[]) : isRecord(statement) ? [statement] : [];
  const principals = [...new Set(statements.flatMap((item) => (isRecord(item) ? principalsOf(item.Principal) : [])))];
  if (principals.length === 0) {
    return NO_VALUE;
  }
  const text = principals.join(', ');
  return isServiceLinked(path) ? `${text} (Service-linked role)` : text;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Last activity" (R4.2): "Today" less than a day ago, "1 day ago", "<n> days ago"; "-" for no date. */
export function lastActivityText(date: Date | undefined, now: Date = new Date()): string {
  if (date === undefined || Number.isNaN(date.getTime())) {
    return NO_VALUE;
  }
  const days = Math.floor((now.getTime() - date.getTime()) / DAY_MS);
  if (days < 1) {
    return 'Today';
  }
  return days === 1 ? '1 day ago' : `${String(days)} days ago`;
}

const HOUR_S = 3600;

/** "Maximum session duration" (R5.3): "1 hour", "<n> hours" for whole hours, else "<n> seconds"; "-" for none. */
export function maxSessionDurationText(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return NO_VALUE;
  }
  if (seconds > 0 && seconds % HOUR_S === 0) {
    const hours = seconds / HOUR_S;
    return hours === 1 ? '1 hour' : `${String(hours)} hours`;
  }
  return `${String(seconds)} seconds`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** "Creation date" (R5.3): `YYYY-MM-DD HH:MM:SS UTC`, in UTC whatever the machine's time zone; "-" for none. */
export function utcDateText(date: Date | undefined): string {
  if (date === undefined || Number.isNaN(date.getTime())) {
    return NO_VALUE;
  }
  const day = `${String(date.getUTCFullYear())}-${twoDigits(date.getUTCMonth() + 1)}-${twoDigits(date.getUTCDate())}`;
  const time = `${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}:${twoDigits(date.getUTCSeconds())}`;
  return `${day} ${time} UTC`;
}

/** A policy's "Type" (R5.3, R6.4), the console's words. */
export type PolicyType = 'AWS managed' | 'Customer managed' | 'Customer inline';

/** A managed policy's type from its ARN: "AWS managed" when the ARN's account is `aws`. */
export function managedPolicyType(arn: string): PolicyType {
  return arn.split(':')[4] === 'aws' ? 'AWS managed' : 'Customer managed';
}

/** A policy of a role: a managed one attached by its ARN, or an inline one by its name. */
export type PolicyRef = { kind: 'managed'; name: string; arn: string } | { kind: 'inline'; name: string };

export function policyTypeText(policy: PolicyRef): PolicyType {
  return policy.kind === 'inline' ? 'Customer inline' : managedPolicyType(policy.arn);
}

/** "Description" (R5.3): "-" when empty or missing, otherwise as it came. */
export function descriptionText(description: string | undefined): string {
  return description === undefined || description === '' ? NO_VALUE : description;
}
