// The emulator side and the words of CloudWatch Logs' screens (test-criteria.md, issue 71), for the `logs-*.spec.ts`
// checks.
//
// - Direct calls: `directLogs` of `support/aws-clients-general.ts` (AWS JSON 1.1 straight to the emulator,
//   SigV4-signed with the key it wrote for this run, TLS verified against its `ca.pem`). A refusal is read from its
//   JSON `__type` and `message`; "the emulator's reason" a line asks for is the `message` of a direct call that is
//   refused the same way, compared with what the screen shows.
// - `LogsSeeded`: the log groups a check makes, every one named under the check's prefix `<p>`. When the check ends
//   it deletes every log group of the emulator whose name starts with `<p>`, those Studio's actions made included,
//   turning deletion protection off first where it is on.
// - The screens' words (requirement.md, section 4) and readers of what a screen shows.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { directLogs, type DirectAnswer } from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION, heading } from '../../support/frame';
import { creationDateText } from '../../support/service-screens';
import { waitFor } from '../../support/wait';

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/** A direct answer, parsed: its status, its JSON body (`{}` when empty), and for a refusal its type and message. */
export interface Answer {
  status: number;
  json: Record<string, unknown>;
  type: string | null;
  message: string | null;
}

function parsed(answer: DirectAnswer, what: string): Answer {
  if ('error' in answer) throw new EnvError(`${what}: ${answer.error}`);
  let json: Record<string, unknown> = {};
  if (answer.body.trim() !== '') {
    try {
      json = JSON.parse(answer.body) as Record<string, unknown>;
    } catch {
      json = { raw: answer.body };
    }
  }
  const type = typeof json.__type === 'string' ? (json.__type.split('#').at(-1) ?? null) : null;
  const message = typeof json.message === 'string' ? json.message : null;
  return { status: answer.status, json, type, message };
}

/** Sends `operation` with `input` straight to the emulator and logs its status. */
export async function logs(ctx: Ctx, port: number, operation: string, input: object = {}): Promise<Answer> {
  const answer = parsed(await directLogs(ctx, port, operation, input), `direct ${operation}`);
  ctx.log(`direct ${operation}: status ${String(answer.status)}${answer.type ? ` ${answer.type}` : ''}`);
  return answer;
}

/** Sends `operation` and fails the check unless the emulator answered 200. */
export async function logsOk(ctx: Ctx, port: number, operation: string, input: object = {}): Promise<Answer> {
  const answer = await logs(ctx, port, operation, input);
  if (answer.status !== 200) {
    throw new Error(`direct ${operation} answered ${String(answer.status)} ${JSON.stringify(answer.json)}`);
  }
  return answer;
}

/**
 * The emulator's reason for refusing `operation` with `input`, directly: the `message` of its refusal. Fails the
 * check when the emulator does not refuse it.
 */
export async function refusalDirect(ctx: Ctx, port: number, operation: string, input: object): Promise<string> {
  const answer = await logs(ctx, port, operation, input);
  if (answer.status === 200 || answer.message === null || answer.message === '') {
    throw new Error(`direct ${operation} was not refused with a reason: ${String(answer.status)} ${JSON.stringify(answer.json)}`);
  }
  return answer.message;
}

/** A log group as `DescribeLogGroups` reports it. */
export interface DirectGroup {
  logGroupName: string;
  creationTime?: number;
  retentionInDays?: number;
  logGroupClass?: string;
  deletionProtectionEnabled?: boolean;
}

/** Every log group whose name starts with `prefix`, directly, every page. */
export async function groupsDirect(ctx: Ctx, port: number, prefix: string): Promise<DirectGroup[]> {
  const groups: DirectGroup[] = [];
  let token: string | undefined;
  do {
    const answer = await logsOk(ctx, port, 'DescribeLogGroups', {
      logGroupNamePrefix: prefix,
      limit: 50,
      ...(token === undefined ? {} : { nextToken: token }),
    });
    groups.push(...((answer.json.logGroups ?? []) as DirectGroup[]));
    token = answer.json.nextToken as string | undefined;
  } while (token !== undefined);
  return groups;
}

/** The log groups named exactly `name`, directly: none, or one. */
export async function groupsNamedDirect(ctx: Ctx, port: number, name: string): Promise<DirectGroup[]> {
  return (await groupsDirect(ctx, port, name)).filter((group) => group.logGroupName === name);
}

/** The tags of the log group `name`, directly. */
export async function tagsDirect(ctx: Ctx, port: number, name: string): Promise<Record<string, string>> {
  const answer = await logsOk(ctx, port, 'ListTagsLogGroup', { logGroupName: name });
  return (answer.json.tags ?? {}) as Record<string, string>;
}

/** A log stream as `DescribeLogStreams` reports it. */
export interface DirectStream {
  logStreamName: string;
  lastEventTimestamp?: number;
  lastIngestionTime?: number;
}

/** Every log stream of `group`, directly, every page. */
export async function streamsDirect(ctx: Ctx, port: number, group: string): Promise<DirectStream[]> {
  const streams: DirectStream[] = [];
  let token: string | undefined;
  do {
    const answer = await logsOk(ctx, port, 'DescribeLogStreams', {
      logGroupName: group,
      limit: 50,
      ...(token === undefined ? {} : { nextToken: token }),
    });
    streams.push(...((answer.json.logStreams ?? []) as DirectStream[]));
    token = answer.json.nextToken as string | undefined;
  } while (token !== undefined);
  return streams;
}

/** The stream `stream` of `group`, directly; fails the check when the emulator holds none of that name. */
export async function streamDirect(ctx: Ctx, port: number, group: string, stream: string): Promise<DirectStream> {
  const found = (await streamsDirect(ctx, port, group)).find((each) => each.logStreamName === stream);
  if (found === undefined) throw new Error(`the emulator holds no stream ${stream} in ${group}`);
  return found;
}

/** The messages of `stream`, oldest first, directly (up to 10,000 events). */
export async function messagesDirect(ctx: Ctx, port: number, group: string, stream: string): Promise<string[]> {
  const answer = await logsOk(ctx, port, 'GetLogEvents', {
    logGroupName: group,
    logStreamName: stream,
    startFromHead: true,
    limit: 10_000,
  });
  return ((answer.json.events ?? []) as { message: string }[]).map((event) => event.message);
}

/** The messages a direct `FilterLogEvents` of `group` with `pattern` returns, every page. */
export async function searchDirect(ctx: Ctx, port: number, group: string, pattern: string): Promise<string[]> {
  const messages: string[] = [];
  let token: string | undefined;
  do {
    const answer = await logsOk(ctx, port, 'FilterLogEvents', {
      logGroupName: group,
      filterPattern: pattern,
      ...(token === undefined ? {} : { nextToken: token }),
    });
    messages.push(...((answer.json.events ?? []) as { message: string }[]).map((event) => event.message));
    token = answer.json.nextToken as string | undefined;
  } while (token !== undefined);
  return messages;
}

/** Waits until a condition read directly holds, within `boundMs`; returns its last value. */
export async function eventually<T>(boundMs: number, read: () => Promise<T>, holds: (v: T) => boolean): Promise<T> {
  let last = await read();
  const found = await waitFor(boundMs, async () => {
    last = await read();
    return holds(last) ? last : undefined;
  });
  return found ?? last;
}

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

/** What a seeded log group is made with. */
export interface GroupSeed {
  logClass?: 'STANDARD' | 'INFREQUENT_ACCESS';
  retention?: number;
  protection?: boolean;
  tags?: Record<string, string>;
}

/** An event to put: its time in milliseconds and its message. */
export interface SeedEvent {
  timestamp: number;
  message: string;
}

/** The log groups a check makes under its prefix; every log group of that prefix is deleted when the check ends. */
export class LogsSeeded {
  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  /** `CreateLogGroup name` with `seed`'s class, protection and tags, then its retention; returns the name. */
  async group(name: string, seed: GroupSeed = {}): Promise<string> {
    if (!name.startsWith(this.prefix)) throw new Error(`${name} is not under the check's prefix ${this.prefix}`);
    await logsOk(this.ctx, this.port, 'CreateLogGroup', {
      logGroupName: name,
      ...(seed.logClass === undefined ? {} : { logGroupClass: seed.logClass }),
      ...(seed.protection === true ? { deletionProtectionEnabled: true } : {}),
      ...(seed.tags === undefined ? {} : { tags: seed.tags }),
    });
    if (seed.retention !== undefined) {
      await logsOk(this.ctx, this.port, 'PutRetentionPolicy', { logGroupName: name, retentionInDays: seed.retention });
    }
    return name;
  }

  /** `CreateLogStream stream` in `group`, then its `events` in one put when there are any. */
  async stream(group: string, stream: string, events: SeedEvent[] = []): Promise<void> {
    await logsOk(this.ctx, this.port, 'CreateLogStream', { logGroupName: group, logStreamName: stream });
    if (events.length > 0) await this.events(group, stream, events);
  }

  /** `PutLogEvents` of `events`, in the order given (oldest first), into `stream`. */
  async events(group: string, stream: string, events: SeedEvent[]): Promise<void> {
    const answer = await logsOk(this.ctx, this.port, 'PutLogEvents', {
      logGroupName: group,
      logStreamName: stream,
      logEvents: events,
    });
    if (answer.json.rejectedLogEventsInfo !== undefined) {
      throw new Error(`the emulator did not store every seeded event: ${JSON.stringify(answer.json.rejectedLogEventsInfo)}`);
    }
  }

  /**
   * Deletes every log group of the emulator under the check's prefix, then reads the prefix again. A group that could
   * not be unprotected or deleted does not stop the rest; the groups still there at the end are an error that names
   * them, with what the emulator answered for each.
   */
  async dispose(): Promise<void> {
    const refused = new Map<string, string>();
    /** Sends one cleanup call for `name` and notes an answer other than 200, or a call that did not get through. */
    const send = async (name: string, operation: string, input: object): Promise<boolean> => {
      try {
        const answer = await logs(this.ctx, this.port, operation, input);
        if (answer.status === 200) return true;
        refused.set(name, `${operation} answered ${String(answer.status)} ${JSON.stringify(answer.json)}`);
      } catch (e) {
        refused.set(name, `${operation}: ${(e as Error).message}`);
      }
      return false;
    };
    for (const group of await groupsDirect(this.ctx, this.port, this.prefix)) {
      const name = group.logGroupName;
      if (group.deletionProtectionEnabled === true) {
        const off = await send(name, 'PutLogGroupDeletionProtection', {
          logGroupIdentifier: name,
          deletionProtectionEnabled: false,
        });
        if (!off) continue;
      }
      await send(name, 'DeleteLogGroup', { logGroupName: name });
    }
    const left = (await groupsDirect(this.ctx, this.port, this.prefix)).map((group) => group.logGroupName);
    if (left.length > 0) {
      throw new Error(
        `the log groups under ${this.prefix} that could not be removed: ${left
          .map((name) => `${name} (${refused.get(name) ?? 'deleted with 200 and still reported'})`)
          .join('; ')}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Paths and words.
// ---------------------------------------------------------------------------------------------------------------

export const LOG_GROUPS_PATH = '/aws/logs/log-groups';
export const CREATE_LOG_GROUP_PATH = `${LOG_GROUPS_PATH}/create`;
export const LOG_STREAMS_PATH = '/aws/logs/log-streams';
export const LOG_EVENTS_PATH = '/aws/logs/log-events';

/** A name as one segment of an address (requirement, section 3): percent-encoded, `.` and `..` behind a `*`. */
function segment(name: string): string {
  return name === '.' || name === '..' ? `*${name}` : encodeURIComponent(name);
}
/** S3's path for the log group `group`. */
export function groupPath(group: string): string {
  return `${LOG_GROUPS_PATH}/group/${segment(group)}`;
}
/** S4's path for the stream `stream` of `group`. */
export function streamPath(group: string, stream: string): string {
  return `${groupPath(group)}/stream/${segment(stream)}`;
}
/** S5's and S6's address with the log group `group` chosen. */
export function withGroup(path: string, group: string): string {
  return `${path}?${new URLSearchParams({ group }).toString()}`;
}

export const NAVIGATION_HEADER = 'CloudWatch Logs';
export const LOG_GROUPS = 'Log groups';
export const LOG_STREAMS = 'Log streams';
export const LOG_EVENTS = 'Log events';
export const CREATE_LOG_GROUP = 'Create log group';
export const DELETE = 'Delete';
export const SAVE = 'Save';
export const CANCEL = 'Cancel';
export const NEVER_EXPIRE = 'Never expire';
export const NO_GROUPS_MATCH = 'No log groups match';
export const GROUP_NOT_FOUND = 'Log group not found';
export const STREAM_NOT_FOUND = 'Log stream not found';
export const NO_STREAMS = 'No log streams';
export const NO_STREAMS_MATCH = 'No log streams match';
export const NO_EVENTS = 'No log events';
export const CHOOSE_A_GROUP = 'Choose a log group.';
export const LISTED_BY_NAME = 'Streams that start with the prefix are listed by name.';
export const PROTECTION_IS_ON = 'Deletion protection is on. Turn it off before deleting this log group.';
export const STANDARD_ONLY = 'The emulator reads and searches log events only in log groups of the Standard class.';
export const EDIT_RETENTION = 'Edit retention';
export const TURN_ON_PROTECTION = 'Turn on deletion protection';
export const MANAGE_TAGS = 'Manage tags';
export const ADD_TAG = 'Add tag';
export const SEARCH_LOG_EVENTS = 'Search log events';
export const SEARCH = 'Search';
export const CREATE_LOG_STREAM = 'Create log stream';
export const DELETE_LOG_STREAM = 'Delete log stream';
export const PUT_LOG_EVENTS = 'Put log events';
export const ADD_MESSAGE = 'Add message';
export const LOAD_OLDER = 'Load older events';
export const LOAD_NEWER = 'Load newer events';
export const NO_NEWER = 'No newer events.';

export function groupCreated(name: string): string {
  return `Log group ${name} created.`;
}
export function groupDeleted(name: string): string {
  return `Log group ${name} deleted.`;
}
export function retentionSet(name: string, retention: string): string {
  return `Retention of ${name} set to ${retention}.`;
}
export function protectionTurnedOn(name: string): string {
  return `Deletion protection turned on for ${name}.`;
}
export function tagsSaved(name: string): string {
  return `Tags of ${name} saved.`;
}
export function streamCreated(name: string): string {
  return `Log stream ${name} created.`;
}
export function streamDeleted(name: string): string {
  return `Log stream ${name} deleted.`;
}
/** "1 log event put to s." or "2 log events put to s." */
export function eventsPut(count: number, stream: string): string {
  return `${String(count)} log ${count === 1 ? 'event' : 'events'} put to ${stream}.`;
}

/** The retention a screen shows for `days` of a direct answer. */
export function retentionText(days: number | undefined): string {
  if (days === undefined) return NEVER_EXPIRE;
  return days === 1 ? '1 day' : `${String(days)} days`;
}
/** The class a screen shows for the `logGroupClass` of a direct answer. */
export function classText(logClass: string | undefined): string {
  return { STANDARD: 'Standard', INFREQUENT_ACCESS: 'Infrequent Access', DELIVERY: 'Delivery' }[logClass ?? ''] ?? '-';
}
/** The deletion protection a screen shows. */
export function protectionText(enabled: boolean | undefined): string {
  return enabled === true ? 'On' : 'Off';
}
/**
 * The date a screen shows for the time `ms` of a direct answer, in the zone of the machine the check and its
 * browser run on: "October 30, 2026, 23:18:34 (UTC+09:00)"; "-" without a time.
 */
export function dateText(ms: number | undefined): string {
  if (ms === undefined) return '-';
  const offsetMinutes = -new Date(ms).getTimezoneOffset();
  const two = (n: number) => String(Math.trunc(n)).padStart(2, '0');
  const size = Math.abs(offsetMinutes);
  const label = `UTC${offsetMinutes < 0 ? '-' : '+'}${two(size / 60)}:${two(size % 60)}`;
  return creationDateText(new Date(ms).toISOString(), { offsetMinutes, label });
}
/** The date `YYYY-MM-DD` and the time `HH:MM:SS` of `ms` in the machine's zone, as the search form takes them. */
export function localDateAndTime(ms: number): { date: string; time: string } {
  const at = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
    time: `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`,
  };
}

/** The service's entries as the requirement's table has them (section 3, "The service's entries"): label and path. */
export const ENTRIES: { label: string; path: string; screen: boolean }[] = [
  { label: 'Log groups', path: '/aws/logs/log-groups', screen: true },
  { label: 'Log streams', path: '/aws/logs/log-streams', screen: true },
  { label: 'Deliveries', path: '/aws/logs/deliveries', screen: false },
  { label: 'Delivery destinations', path: '/aws/logs/delivery-destinations', screen: false },
  { label: 'Delivery sources', path: '/aws/logs/delivery-sources', screen: false },
  { label: 'Destinations', path: '/aws/logs/destinations', screen: false },
  { label: 'Export tasks', path: '/aws/logs/export-tasks', screen: false },
  { label: 'Import tasks', path: '/aws/logs/import-tasks', screen: false },
  { label: 'Index policies', path: '/aws/logs/index-policies', screen: false },
  { label: 'Integrations', path: '/aws/logs/integrations', screen: false },
  { label: 'Log anomaly detectors', path: '/aws/logs/log-anomaly-detectors', screen: false },
  { label: 'Lookup tables', path: '/aws/logs/lookup-tables', screen: false },
  { label: 'Metric filters', path: '/aws/logs/metric-filters', screen: false },
  { label: 'Queries', path: '/aws/logs/queries', screen: false },
  { label: 'Query definitions', path: '/aws/logs/query-definitions', screen: false },
  { label: 'Resource policies', path: '/aws/logs/resource-policies', screen: false },
  { label: 'Scheduled queries', path: '/aws/logs/scheduled-queries', screen: false },
  { label: 'Subscription filters', path: '/aws/logs/subscription-filters', screen: false },
];

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
/** A selector of Cloudscape's, usable inside a scoped locator (no leading `body`). */
function rel(selector: { toSelector(): string }): string {
  return selector.toSelector().replace(/^body /, '');
}
/** The part of a selector below its component's root, for a locator that is that root. */
function inside(selector: { toSelector(): string }): string {
  return rel(selector).replace(/^\[class\*="awsui_root_\w+"\] /, '');
}

export const TABLE = rel(wrapper.findTable());
/** The data rows of a table, below its root: a loading or an empty table has none. */
const TABLE_ROWS = inside(wrapper.findTable().findRows());
/** The column headings of a table, below its root, the selection column's (without a text) included. */
const TABLE_HEADERS = inside(wrapper.findTable().findColumnHeaders());
const TABLE_EMPTY = inside(wrapper.findTable().findEmptySlot());
const MODAL = wrapper.findModal().toSelector();
const HEADING_TEXT = rel(wrapper.findHeader().findHeadingText());
const TEXT_FILTER = rel(wrapper.findTextFilter().findInput().findNativeInput());
const NEXT_PAGE = rel(wrapper.findPagination().findNextPageButton());
const PREVIOUS_PAGE = rel(wrapper.findPagination().findPreviousPageButton());
const ALERT = rel(wrapper.findAlert());
const CONTAINER = rel(wrapper.findContainer());
const FORM_FIELD = rel(wrapper.findFormField());
const FORM_FIELD_LABEL = inside(wrapper.findFormField().findLabel());
const SELECT = rel(wrapper.findSelect());
const SELECT_TRIGGER = inside(wrapper.findSelect().findTrigger());
const SELECT_OPEN = inside(wrapper.findSelect().findDropdown().findOpenDropdown());
const SELECT_FILTER = inside(wrapper.findSelect().findFilteringInput().findNativeInput());
const DATE_INPUT = rel(wrapper.findDateInput().findNativeInput());
const TIME_INPUT = rel(wrapper.findTimeInput().findNativeInput());
const EDITOR_ROWS = rel(wrapper.findAttributeEditor().findRows());
/** An option of a select by its value. */
function optionByValue(value: string): string {
  return inside(wrapper.findSelect().findDropdown().findOptionByValue(value));
}
/** The native input of field `column` (1 the first) of row `row` (1 the first) of an attribute editor. */
function editorInput(row: number, column: number): string {
  return rel(wrapper.findAttributeEditor().findRow(row).findField(column).findControl().findInput().findNativeInput());
}
/** The native text area of the one field of row `row` (1 the first) of an attribute editor. */
function editorTextarea(row: number): string {
  return rel(
    wrapper.findAttributeEditor().findRow(row).findField(1).findControl().findTextarea().findNativeTextarea(),
  );
}
/** The remove button of row `row` (1 the first) of an attribute editor. */
function editorRemove(row: number): string {
  return rel(wrapper.findAttributeEditor().findRow(row).findRemoveButton());
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opens `path` and waits for its `h1` `name`. */
export async function open(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await expect(heading(page, h1), `the h1 "${h1}" at ${path}`).toBeVisible({ timeout: 15_000 });
}

/** The data rows of the table `table`, found with Cloudscape's selector: what a row holds is looked for inside them. */
export function rowsIn(table: Locator): Locator {
  return table.locator(TABLE_ROWS);
}

/** The cell of data row `row` under heading `column` (each 1 the first) of a table, below its root. */
function bodyCell(row: number, column: number): string {
  return inside(wrapper.findTable().findBodyCell(row, column));
}

/**
 * The data rows of the table `table` as shown, each a record of its column headings' texts to its cells' texts (the
 * selection column has no heading and is left out). Headings, rows and cells are found with Cloudscape's selectors:
 * the cell under the heading `c` of the row `r` is `findBodyCell(r, c)`. No row is left out: a cell that is not there
 * under a named heading leaves its row without that heading, which no expectation of a text equals. A table that is
 * loading, empty or failed has no data row.
 */
export async function rowsOf(table: Locator): Promise<Record<string, string>[]> {
  const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
  const headers = (await table.locator(TABLE_HEADERS).allTextContents()).map(norm);
  const count = await rowsIn(table).count();
  return Promise.all(
    Array.from({ length: count }, async (_, r) => {
      const row: Record<string, string> = {};
      await Promise.all(
        headers.map(async (header, c) => {
          if (header === '') return;
          const [text] = await table.locator(bodyCell(r + 1, c + 1)).allTextContents();
          if (text !== undefined) row[header] = norm(text);
        }),
      );
      return row;
    }),
  );
}

/** Waits until the rows of `table`, mapped by `pick`, equal `want`. */
export async function expectRows<T>(
  table: Locator,
  pick: (row: Record<string, string>) => T,
  want: T[],
  what: string,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => (await rowsOf(table)).map(pick), { message: what, timeout }).toEqual(want);
}

/** Waits until `table` shows no data row and its empty state reads `text`. */
export async function expectEmpty(table: Locator, text: string): Promise<void> {
  await expect(table.locator(TABLE_EMPTY), `the table's empty state "${text}"`).toHaveText(text, { timeout: 15_000 });
  expect(await rowsOf(table), 'the rows beside the empty state').toEqual([]);
}

/** The flash items of type `type`, as one locator. */
export function flashItems(page: Page, type: 'success' | 'error' | 'info' | 'warning'): Locator {
  return page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector());
}

/** Waits until one flash item of `type`, and no more, holds every text of `texts`: the items' own texts are read. */
export async function expectFlash(page: Page, type: 'success' | 'error', ...texts: string[]): Promise<void> {
  const items = flashItems(page, type);
  await expect
    .poll(async () => (await items.allInnerTexts()).filter((shown) => texts.every((text) => shown.includes(text))).length, {
      message: `one ${type} flash holding ${texts.map((t) => `"${t}"`).join(', ')}`,
      timeout: 15_000,
    })
    .toBe(1);
}

/** Whether a request the page sent to the engine is the CloudWatch Logs operation `operation`. */
export function isOperation(headers: Record<string, string>, operation: string): boolean {
  return headers['x-amz-target'] === `Logs_20140328.${operation}`;
}

/** The answer to the page's `operation` whose JSON input satisfies `input` (any input when omitted). */
function answerTo(page: Page, operation: string, input?: (body: Record<string, unknown>) => boolean) {
  return page.waitForResponse(
    (r) => {
      if (!isOperation(r.request().headers(), operation)) return false;
      if (input === undefined) return true;
      try {
        return input(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
}

/** Runs `act` and waits for the page's answer to its `operation`. */
export async function answered(page: Page, operation: string, act: () => Promise<void>): Promise<void> {
  const answer = answerTo(page, operation);
  await act();
  await answer;
}

/** The form field of `scope` labelled exactly `label`. */
export function field(scope: Locator, label: string): Locator {
  return scope
    .locator(FORM_FIELD)
    .filter({ has: scope.page().locator(FORM_FIELD_LABEL).filter({ hasText: new RegExp(`^${escaped(label)}$`) }) })
    .last();
}

/**
 * In the one select inside `scope`: opens it, types `find` into its own search when given (a list read from the
 * emulator, narrowed to what the check made), and chooses the option whose value is `value`.
 */
export async function chooseOption(scope: Locator, value: string, find?: string): Promise<void> {
  const select = scope.locator(SELECT).first();
  await select.locator(SELECT_TRIGGER).click(ACTION);
  if (find !== undefined) await select.locator(SELECT_FILTER).fill(find, ACTION);
  const option = select.locator(optionByValue(value));
  await expect(option, `the option ${value === '' ? '(the first, fixed one)' : value}`).toBeVisible({ timeout: 20_000 });
  await option.click(ACTION);
  await expect(select.locator(SELECT_OPEN), 'the list after the choice').toHaveCount(0);
}

/** The select inside `scope`, for what it shows as chosen. */
export function selectOf(scope: Locator): Locator {
  return scope.locator(SELECT).first().locator(SELECT_TRIGGER);
}

/** The alerts of `scope`. */
export function alerts(scope: Locator): Locator {
  return scope.locator(ALERT);
}

/** The open dialog: Cloudscape's modal that is shown (one that is closed stays in the page, hidden). */
export function dialogOf(page: Page): Locator {
  return page.locator(MODAL).filter({ visible: true });
}

/** In the open dialog: types `name` into its one text field and chooses `action`. */
export async function confirmWith(page: Page, name: string, action: string): Promise<void> {
  const dialog = dialogOf(page);
  await expect(dialog, 'the dialog').toBeVisible();
  await dialog.getByRole('textbox').fill(name, ACTION);
  await dialog.getByRole('button', { name: action, exact: true }).click(ACTION);
}

/** The text `text`, whole, inside a container of the page's content (a state in the place of the data). */
export function stateText(page: Page, text: string): Locator {
  return page.getByRole('main').locator(CONTAINER).getByText(text, { exact: true });
}

/**
 * The place of the events on a log stream's page: the container of the page's content whose heading reads
 * "Log events". A state in the place of the events (a refusal, "not found") is looked for inside it.
 */
export function eventArea(page: Page): Locator {
  return page
    .getByRole('main')
    .locator(CONTAINER)
    .filter({ has: page.locator(HEADING_TEXT).filter({ hasText: new RegExp(`^${escaped(LOG_EVENTS)}$`) }) });
}

// --- S1, Log groups ---------------------------------------------------------------------------------------------

/** The parts of S1 a check acts on. */
export function groupList(page: Page) {
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  return {
    main,
    table,
    filter: table.locator(TEXT_FILTER),
    radio: (name: string) => rowsIn(table).getByRole('radio', { name, exact: true }),
    link: (name: string) => rowsIn(table).getByRole('link', { name, exact: true }),
    del: main.getByRole('button', { name: DELETE, exact: true }),
    next: main.locator(NEXT_PAGE),
    previous: main.locator(PREVIOUS_PAGE),
  };
}

/**
 * Types `text` into the log group list's filter and waits for the page's `DescribeLogGroups` of that pattern to be
 * answered, so nothing that follows meets the list while it is read again. `text` differs from the filter's text.
 */
export async function filterGroups(page: Page, text: string): Promise<void> {
  const answer = answerTo(page, 'DescribeLogGroups', (body) => (body.logGroupNamePattern ?? '') === text);
  await groupList(page).filter.fill(text, ACTION);
  await answer;
}

/** Waits until the names the log group list shows are `want`, in that order. */
export async function expectGroups(page: Page, want: string[]): Promise<void> {
  await expectRows(groupList(page).table, (r) => r['Log group name'], want, `the log groups listed: ${want.join(', ')}`);
}

// --- S2, Create log group ---------------------------------------------------------------------------------------

/** The parts of S2 a check acts on. */
export function createScreen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    name: main.getByRole('textbox', { name: 'Log group name', exact: true }),
    logClass: field(main, 'Log class'),
    retention: field(main, 'Retention'),
    protection: main.getByRole('checkbox', { name: 'Deletion protection', exact: true }),
    addTag: main.getByRole('button', { name: ADD_TAG, exact: true }),
    tagKey: (row: number) => main.locator(editorInput(row, 1)),
    tagValue: (row: number) => main.locator(editorInput(row, 2)),
    submit: main.getByRole('button', { name: CREATE_LOG_GROUP, exact: true }),
  };
}

// --- S3, a log group's page -------------------------------------------------------------------------------------

/** The parts of S3 a check acts on. */
export function groupScreen(page: Page) {
  const main = page.getByRole('main');
  const streams = page.getByRole('region', { name: LOG_STREAMS, exact: true });
  const streamTable = streams.locator(TABLE);
  return {
    main,
    button: (name: string) => main.getByRole('button', { name, exact: true }),
    searchEvents: main.getByRole('link', { name: SEARCH_LOG_EVENTS, exact: true }),
    tags: main.locator(TABLE).filter({ has: page.locator(HEADING_TEXT).filter({ hasText: /^Tags$/ }) }),
    streams,
    streamTable,
    streamLink: (name: string) => rowsIn(streamTable).getByRole('link', { name, exact: true }),
    streamRadio: (name: string) => rowsIn(streamTable).getByRole('radio', { name, exact: true }),
  };
}

/** The 1-based row of the open tag editor whose key reads `key`; fails the check when no row holds it. */
export async function tagRow(dialog: Locator, key: string): Promise<number> {
  const count = await dialog.locator(EDITOR_ROWS).count();
  for (let row = 1; row <= count; row++) {
    if ((await dialog.locator(editorInput(row, 1)).inputValue()) === key) return row;
  }
  throw new Error(`the tag editor holds no row with the key ${key}`);
}

/** The parts of the tag editor of `scope` (a dialog) a check acts on. */
export function tagEditor(scope: Locator) {
  return {
    rows: scope.locator(EDITOR_ROWS),
    key: (row: number) => scope.locator(editorInput(row, 1)),
    value: (row: number) => scope.locator(editorInput(row, 2)),
    remove: (row: number) => scope.locator(editorRemove(row)),
    add: scope.getByRole('button', { name: ADD_TAG, exact: true }),
  };
}

// --- The streams listing (S3's section and S6) ------------------------------------------------------------------

/**
 * Types `prefix` into the filter of the streams table `table` and waits for the page's `DescribeLogStreams` of that
 * prefix to be answered. `prefix` differs from the filter's text and is not empty.
 */
export async function filterStreams(page: Page, table: Locator, prefix: string): Promise<void> {
  const answer = answerTo(page, 'DescribeLogStreams', (body) => body.logStreamNamePrefix === prefix);
  await table.locator(TEXT_FILTER).fill(prefix, ACTION);
  await answer;
}

/** Waits until the stream names the table `table` shows are `want`, in that order. */
export async function expectStreams(table: Locator, want: string[]): Promise<void> {
  await expectRows(table, (r) => r['Log stream name'], want, `the log streams listed: ${want.join(', ') || 'none'}`);
}

// --- S4, a log stream's page ------------------------------------------------------------------------------------

/** The parts of S4 a check acts on. */
export function streamScreen(page: Page) {
  const main = page.getByRole('main');
  const dialog = dialogOf(page);
  return {
    main,
    older: main.getByRole('button', { name: LOAD_OLDER, exact: true }),
    newer: main.getByRole('button', { name: LOAD_NEWER, exact: true }),
    /** What the control `Load newer events` says beside itself once a read returned nothing. */
    newerStatus: main.getByRole('group', { name: LOAD_NEWER, exact: true }).getByRole('status'),
    put: main.getByRole('button', { name: PUT_LOG_EVENTS, exact: true }),
    dialog,
    message: (row: number) => dialog.locator(editorTextarea(row)),
    addMessage: dialog.getByRole('button', { name: ADD_MESSAGE, exact: true }),
    putInDialog: dialog.getByRole('button', { name: PUT_LOG_EVENTS, exact: true }),
  };
}

/** The messages of the events the stream's page shows, in order, each as written (line breaks kept). */
export async function shownMessages(page: Page): Promise<string[]> {
  return eventArea(page).getByRole('log', { name: LOG_EVENTS, exact: true }).locator('pre').allTextContents();
}

/** Waits until the messages the stream's page shows are `want`, in that order. */
export async function expectMessages(page: Page, want: string[], what: string): Promise<void> {
  await expect.poll(() => shownMessages(page), { message: what, timeout: 20_000 }).toEqual(want);
}

// --- S5, Log events ---------------------------------------------------------------------------------------------

/** The parts of S5 a check acts on. */
export function searchScreen(page: Page) {
  const main = page.getByRole('main');
  const results = main.locator(TABLE).first();
  return {
    main,
    group: field(main, 'Log group'),
    stream: field(main, 'Log stream'),
    pattern: main.getByRole('textbox', { name: 'Filter pattern', exact: true }),
    startDate: field(main, 'Start date').locator(DATE_INPUT),
    startTime: field(main, 'Start time').locator(TIME_INPUT),
    endDate: field(main, 'End date').locator(DATE_INPUT),
    endTime: field(main, 'End time').locator(TIME_INPUT),
    search: main.getByRole('button', { name: SEARCH, exact: true }),
    results,
    empty: results.locator(TABLE_EMPTY),
    next: main.locator(NEXT_PAGE),
    streamLink: (name: string) => rowsIn(results).getByRole('link', { name, exact: true }),
  };
}

/** Types `value` into the masked date or time field `input`, key by key, and waits until it holds it. */
export async function typeMasked(input: Locator, value: string): Promise<void> {
  await input.click(ACTION);
  await input.pressSequentially(value);
  await expect(input, `the field holds ${value}`).toHaveValue(value);
}

/** Presses "Search" and waits for the page's `FilterLogEvents` to be answered. */
export async function search(page: Page): Promise<void> {
  await answered(page, 'FilterLogEvents', () => searchScreen(page).search.click(ACTION));
}

/** Waits until the search results show `want`, each a message with its stream, in that order. */
export async function expectResults(page: Page, want: { stream: string; message: string }[], what: string): Promise<void> {
  await expectRows(
    searchScreen(page).results,
    (r) => ({ stream: r['Log stream'], message: r.Message }),
    want,
    what,
    20_000,
  );
}
