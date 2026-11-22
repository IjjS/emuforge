// A Lambda function's page and the form "Create Event Function" as a user meets them (test-criteria.md, issue 84,
// Flow checks; requirement R5, R6, R9, R10). Used by the `lambda-function-page*.spec.ts`,
// `lambda-function-create*.spec.ts` and `lambda-function-screens*.spec.ts` checks. The list and its delete dialog
// are `services/lambda/lambda-list.ts`; the emulator side (direct calls, `LambdaSeeded`) is `services/lambda/lambda.ts`.
//
// - The screens' words: R5 (the page), R6.2 to R6.5 (the form), R9.3, R9.4 and R10 (states and failures).
// - Readers: a section's key-value pair (the label's `dt` and its `dd`, the pattern of a container of key-value pairs;
//   else the line after the label in the section's text), the tabs, the form's fields and their messages, the
//   options of a select, and where a text lies against the form's buttons.
// - `EngineAnswers`: the answers the engine gave the page's AWS requests that were not a success, with the error code
//   and message they carried, from Playwright's response events; it only listens. A check compares what Studio shows
//   with them ("the engine's message").
//
// Every value a check compares with comes from the run: names from the check's own prefix, the rest from a direct
// answer or from the engine's own answer to the page.

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect, type Ctx } from '../../support/check';
import { ACTION, BREADCRUMB_GROUP, SIDE_NAVIGATION, heading } from '../../support/frame';
import { CREATE, CREATE_PATH, functionPath } from './lambda-list';

// ---------------------------------------------------------------------------------------------------------------
// A function's page (R5).
// ---------------------------------------------------------------------------------------------------------------

/** The tabs, in order; "Test" is the page itself, selected as it opens (issue 516). */
export const PAGE_TABS = ['Test', 'Code', 'Monitor', 'Configuration', 'Versions and aliases'];

/** The sections and their fields, in order (R5.3, R5.5). */
export const OVERVIEW = 'Function overview';
export const DESCRIPTION = 'Description';
export const LAST_MODIFIED = 'Last modified';
export const FUNCTION_ARN = 'Function ARN';
export const FUNCTION_URL = 'Function URL';
export const RUNTIME_SETTINGS = 'Runtime settings';
export const RUNTIME = 'Runtime';
export const HANDLER = 'Handler';
export const ARCHITECTURE = 'Architecture';

/** The status while a function is not ready (R5.2). */
export const BEING_CREATED = 'Being created';

/** "Function not found" (R5.6). */
export const NOT_FOUND = 'Function not found';
export function notFoundSentence(name: string): string {
  return `The emulator holds no function named “${name}”. It may have been deleted, or the emulator restarted.`;
}
/** The link of the "Function not found" content, and the list's crumb. */
export const EVENT_FUNCTIONS = 'Event Functions';

/** The failure states of a read (R10.1). */
export const LOADING_FUNCTION = 'Loading function';
export const FUNCTION_NOT_READ = 'The function could not be read.';
export const LIST_NOT_READ = 'The function list could not be read.';
export const RETRY = 'Retry';
export const CONNECTION_STATUS = 'Connection status';

/** An action's failures (R10.3). */
export const EMULATOR_DID_NOT_ANSWER = 'The emulator did not answer';
export function engineDidNotAnswer(origin: string): string {
  return `The EmuForge engine at ${origin} did not answer`;
}

/** The page's parts a check acts on or reads. */
export function functionPage(page: Page, name: string) {
  const main = page.getByRole('main');
  return {
    h1: heading(page, name),
    refresh: main.getByRole('button', { name: 'Refresh', exact: true }),
    tabs: main.getByRole('tab'),
    tab: (tab: string) => main.getByRole('tab', { name: tab, exact: true }),
    notFound: main.getByText(NOT_FOUND, { exact: true }),
    notFoundSentence: main.getByText(notFoundSentence(name), { exact: true }),
    notRead: main.getByText(FUNCTION_NOT_READ, { exact: true }),
    retry: main.getByRole('button', { name: RETRY, exact: true }),
    connectionStatus: main.getByRole('link', { name: CONNECTION_STATUS, exact: true }),
    section: (title: string) => main.getByRole('heading', { name: title, exact: true }),
  };
}

/**
 * Opens the page of `name` and waits for its `h1`, the name, and for the page to be read: the tab "Code" of a function
 * the emulator holds, or "Function not found" or "The function could not be read." The `h1` is shown while "Loading
 * function" is still up, before the tabs exist.
 */
export async function openFunction(page: Page, name: string): Promise<void> {
  await page.goto(functionPath(name));
  await expect(heading(page, name), `the function page's h1 "${name}"`).toBeVisible();
  const f = functionPage(page, name);
  await expect(f.tab('Code').or(f.notFound).or(f.notRead), `the function page of "${name}", read`).toBeVisible();
}

/**
 * The value shown for `label` in the section titled `section` of the page's main, white space collapsed; `null` when
 * the section or the label is not there. A key-value pair is the label's `dt` and the `dd` after it; a section
 * without `dt` elements is read by its text: the line after the line that is exactly the label.
 */
export async function pairValue(page: Page, section: string, label: string): Promise<string | null> {
  return page.evaluate(
    ([title, key]) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const main = document.querySelector('main, [role="main"]');
      if (!main) return null;
      const titleEl = [...main.querySelectorAll('h1, h2, h3, h4, h5, h6')].find(
        (h) => norm((h as HTMLElement).innerText) === title,
      );
      if (!titleEl) return null;
      // The nearest element around the section's title that holds the label as a `dt`, or as a line of its text.
      for (let at: Element | null = titleEl.parentElement; at && at !== main.parentElement; at = at.parentElement) {
        const dts = [...at.querySelectorAll('dt')];
        const dt = dts.find((d) => norm((d as HTMLElement).innerText) === key);
        if (dt) {
          let dd: Element | null = dt.nextElementSibling;
          while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling;
          if (!dd) dd = dt.parentElement?.querySelector('dd') ?? null;
          return dd ? norm((dd as HTMLElement).innerText) : '';
        }
        if (dts.length === 0) {
          const lines = (at as HTMLElement).innerText
            .split('\n')
            .map(norm)
            .filter((l) => l !== '');
          const i = lines.indexOf(key);
          if (i >= 0 && lines.indexOf(title) >= 0 && lines.indexOf(title) < i) return lines[i + 1] ?? '';
        }
      }
      return null;
    },
    [section, label],
  );
}

/** The first line of `pairValue`: the value without what the page shows under it (the status under "Description"). */
export async function pairFirstLine(page: Page, section: string, label: string): Promise<string | null> {
  return page.evaluate(
    ([title, key]) => {
      const norm = (s: string) => s.replace(/[ \t ]+/g, ' ').trim();
      const main = document.querySelector('main, [role="main"]');
      if (!main) return null;
      const titleEl = [...main.querySelectorAll('h1, h2, h3, h4, h5, h6')].find(
        (h) => norm((h as HTMLElement).innerText) === title,
      );
      if (!titleEl) return null;
      for (let at: Element | null = titleEl.parentElement; at && at !== main.parentElement; at = at.parentElement) {
        const dt = [...at.querySelectorAll('dt')].find((d) => norm((d as HTMLElement).innerText) === key);
        if (!dt) continue;
        let dd: Element | null = dt.nextElementSibling;
        while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling;
        if (!dd) return '';
        return (
          (dd as HTMLElement).innerText
            .split('\n')
            .map(norm)
            .find((l) => l !== '') ?? ''
        );
      }
      return null;
    },
    [section, label],
  );
}

/** The texts of the page's tabs, in order. */
export async function tabNames(page: Page): Promise<string[]> {
  return (await page.getByRole('main').getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/** Whether a link with exactly `text` as its name, or `href`, is in the page's main. */
export async function isLinkInMain(page: Page, text: string): Promise<boolean> {
  return page.evaluate((wanted) => {
    const main = document.querySelector('main, [role="main"]');
    if (!main) return false;
    return [...main.querySelectorAll('a')].some(
      (a) => (a.textContent ?? '').trim() === wanted || a.getAttribute('href') === wanted,
    );
  }, text);
}

/**
 * The link named `name` of the page's content: in the main, neither in the side navigation nor in the crumbs. `null`
 * when there is none.
 */
export async function contentLink(page: Page, name: string): Promise<Locator | null> {
  const links = page.getByRole('link', { name, exact: true });
  const outside = await links.evaluateAll(
    (els, [nav, crumbs]) =>
      els.map(
        (el) => el.closest(nav) === null && el.closest(crumbs) === null && el.closest('main, [role="main"]') !== null,
      ),
    [SIDE_NAVIGATION, BREADCRUMB_GROUP],
  );
  const at = outside.indexOf(true);
  return at < 0 ? null : links.nth(at);
}

// ---------------------------------------------------------------------------------------------------------------
// The form "Create Event Function" (R6.2 to R6.5).
// ---------------------------------------------------------------------------------------------------------------

export const FUNCTION_NAME = 'Function name';
export const EXECUTION_ROLE = 'Execution role';
export const CREATE_DEFAULT_ROLE = 'Create default role';
export const USE_ANOTHER_ROLE = 'Use another role';
export const EXISTING_ROLE = 'Existing role';
export const CANCEL = 'Cancel';

/** The runtimes offered, in order, with what the form sends and the handler of its starter code (R6.2, R6.5). */
export const RUNTIMES: { label: string; id: string; handler: string }[] = [
  { label: 'Node.js 24.x', id: 'nodejs24.x', handler: 'index.handler' },
  { label: 'Node.js 22.x', id: 'nodejs22.x', handler: 'index.handler' },
  { label: 'Node.js 20.x', id: 'nodejs20.x', handler: 'index.handler' },
  { label: 'Node.js 18.x', id: 'nodejs18.x', handler: 'index.handler' },
  { label: 'Python 3.14', id: 'python3.14', handler: 'lambda_function.lambda_handler' },
  { label: 'Python 3.13', id: 'python3.13', handler: 'lambda_function.lambda_handler' },
  { label: 'Python 3.12', id: 'python3.12', handler: 'lambda_function.lambda_handler' },
  { label: 'Python 3.11', id: 'python3.11', handler: 'lambda_function.lambda_handler' },
  { label: 'Python 3.10', id: 'python3.10', handler: 'lambda_function.lambda_handler' },
  { label: 'Python 3.9', id: 'python3.9', handler: 'lambda_function.lambda_handler' },
];
export function runtimeOf(label: string): { label: string; id: string; handler: string } {
  const r = RUNTIMES.find((x) => x.label === label);
  if (!r) throw new Error(`no runtime ${label} in services/lambda/lambda-page.ts`);
  return r;
}

/** The field messages (R6.4). */
export const ENTER_NAME = 'Enter a function name.';
export const NAME_TOO_LONG = 'The name can have up to 64 characters.';
export const NAME_ALPHABET = 'Use only letters, digits, hyphens (-) and underscores (_).';
export const CHOOSE_ROLE = 'Choose a role.';

/** The roles select's states (R6.2, R9.4). */
export const LOADING_ROLES = 'Loading roles';
export const NO_ROLES = 'No roles';

/** The Flashbar item once `CreateFunction` answered 201 (R6.5); `role` is the role "Create default role" made. */
export function createdFlash(name: string, role: string | null): string {
  return role === null
    ? `Function “${name}” is being created in the local emulator.`
    : `Function “${name}” is being created in the local emulator, with the execution role “${role}”.`;
}

/** The failure of `CreateFunction` above the buttons (R10.3), and the sentence about a role left behind (R6.5). */
export const CREATE_FAILED = 'Creating the function failed';
export const ROLE_STILL_THERE = 'was created in the local emulator and is still there.';
export function roleStillThere(role: string): string {
  return `The role “${role}” was created in the local emulator and is still there.`;
}

/** The form's parts a check acts on or reads. */
export function createForm(page: Page) {
  const main = page.getByRole('main');
  return {
    h1: heading(page, CREATE),
    name: main.getByLabel(FUNCTION_NAME, { exact: true }),
    /** The select "Runtime": its trigger, named by the field's label and the chosen option. */
    runtime: main.getByRole('button', { name: /^Runtime(\s|$)/ }),
    /** The select "Existing role". */
    existingRole: main.getByRole('button', { name: /^Existing role(\s|$)/ }),
    radio: (label: string) => main.getByRole('radio', { name: label, exact: true }),
    cancel: main.getByRole('button', { name: CANCEL, exact: true }),
    create: main.getByRole('button', { name: CREATE, exact: true }),
    options: page.getByRole('option'),
    option: (label: string) => page.getByRole('option', { name: new RegExp(`^${escapeRe(label)}(\\s|$)`) }),
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opens the form at `CREATE_PATH` with `query` and waits for its `h1`. */
export async function openCreateForm(page: Page, query = ''): Promise<void> {
  await page.goto(`${CREATE_PATH}${query}`);
  await expect(heading(page, CREATE), `the h1 "${CREATE}"`).toBeVisible();
}

/** Chooses the option `label` of the select "Runtime". */
export async function chooseRuntime(page: Page, label: string): Promise<void> {
  const f = createForm(page);
  await f.runtime.click(ACTION);
  await f.option(label).first().click(ACTION);
  await expect(f.runtime, `"${RUNTIME}" shows ${label}`).toContainText(label);
}

/** Chooses "Use another role", then the role `role` of the select "Existing role". */
export async function chooseExistingRole(page: Page, role: string): Promise<void> {
  const f = createForm(page);
  await f.radio(USE_ANOTHER_ROLE).check(ACTION);
  await f.existingRole.click(ACTION);
  await f.option(role).first().click(ACTION);
  await expect(f.existingRole, `"${EXISTING_ROLE}" shows ${role}`).toContainText(role);
}

/** What a complete form is filled with. */
export interface FormValues {
  name: string;
  runtime?: string;
  architecture?: 'x86_64' | 'arm64';
  /** The role of "Use another role"; without it "Create default role" stays chosen. */
  role?: string;
}

/** Fills the form as `values` says, leaving each choice not named as the form opens. */
export async function fillForm(page: Page, values: FormValues): Promise<void> {
  const f = createForm(page);
  await f.name.fill(values.name, ACTION);
  if (values.runtime !== undefined) await chooseRuntime(page, values.runtime);
  if (values.architecture !== undefined) await f.radio(values.architecture).check(ACTION);
  if (values.role !== undefined) await chooseExistingRole(page, values.role);
}

/** Problems with the form showing `values` still (every field as it was filled). */
export async function formKeeps(page: Page, values: FormValues): Promise<string[]> {
  const f = createForm(page);
  const problems: string[] = [];
  const name = await f.name.inputValue(ACTION).catch(() => null);
  if (name !== values.name) problems.push(`"${FUNCTION_NAME}" holds ${JSON.stringify(name)}, not ${values.name}`);
  const runtime = values.runtime ?? RUNTIMES[0].label;
  const shownRuntime = await f.runtime.innerText(ACTION).catch(() => '');
  if (!shownRuntime.includes(runtime)) problems.push(`"${RUNTIME}" shows "${shownRuntime}", not ${runtime}`);
  const architecture = values.architecture ?? 'x86_64';
  if (
    !(await f
      .radio(architecture)
      .isChecked(ACTION)
      .catch(() => false))
  ) {
    problems.push(`"${architecture}" is not chosen`);
  }
  const choice = values.role === undefined ? CREATE_DEFAULT_ROLE : USE_ANOTHER_ROLE;
  if (
    !(await f
      .radio(choice)
      .isChecked(ACTION)
      .catch(() => false))
  )
    problems.push(`"${choice}" is not chosen`);
  if (values.role !== undefined) {
    const shownRole = await f.existingRole.innerText(ACTION).catch(() => '');
    if (!shownRole.includes(values.role)) problems.push(`"${EXISTING_ROLE}" shows "${shownRole}", not ${values.role}`);
  }
  return problems;
}

/**
 * Whether `message` is shown under the field labelled `label`: an element whose text is exactly `message`, and the
 * first element around it that holds a `label` holds the one with the text `label`.
 */
export async function messageUnder(page: Page, label: string, message: string): Promise<boolean> {
  return page.evaluate(
    ([field, wanted]) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const main = document.querySelector('main, [role="main"]');
      if (!main) return false;
      const holders = [...main.querySelectorAll('*')].filter(
        (el) =>
          norm((el as HTMLElement).innerText ?? '') === wanted &&
          ![...el.children].some((c) => norm((c as HTMLElement).innerText ?? '') === wanted),
      );
      return holders.some((el) => {
        for (let at = el.parentElement; at && at !== main; at = at.parentElement) {
          const labels = [...at.querySelectorAll('label')];
          if (labels.length > 0) return labels.some((l) => norm(l.innerText) === field);
        }
        return false;
      });
    },
    [label, message],
  );
}

/** Whether every one of `parts` is in one text block of the main that lies above the button "Create Event Function". */
export async function shownAboveButtons(page: Page, parts: string[]): Promise<boolean> {
  return page.evaluate(
    ([wanted, button]) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const main = document.querySelector('main, [role="main"]');
      if (!main) return false;
      const create = [...main.querySelectorAll('button')].find((b) => norm(b.innerText) === button);
      if (!create) return false;
      const top = create.getBoundingClientRect().top;
      // The smallest elements that hold every part.
      const holders = [...main.querySelectorAll('*')].filter((el) => {
        const text = norm((el as HTMLElement).innerText ?? '');
        return wanted.every((p) => text.includes(p)) && !el.contains(create);
      });
      return holders.some((el) => el.getBoundingClientRect().bottom <= top + 0.5);
    },
    [parts, CREATE] as [string[], string],
  );
}

/** The texts of the options the open select lists now, in order, each white space collapsed. */
export async function optionTexts(page: Page): Promise<string[]> {
  return (await page.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/**
 * The labels of the options the open select lists now, in order: `optionTexts` without what the select adds to the
 * chosen option for a screen reader ("<label> Selected <label>").
 */
export async function optionLabels(page: Page): Promise<string[]> {
  return (await optionTexts(page)).map((t) => {
    const at = t.indexOf(' Selected ');
    return at > 0 && t.slice(at + ' Selected '.length) === t.slice(0, at) ? t.slice(0, at) : t;
  });
}

/** The first word of each option the open select lists: a role's name (R6.2: its name, then its path). */
export async function optionNames(page: Page): Promise<string[]> {
  return (await optionTexts(page)).map((t) => t.split(' ')[0]);
}

// ---------------------------------------------------------------------------------------------------------------
// The engine's answers to the page.
// ---------------------------------------------------------------------------------------------------------------

/** One answer of the engine to an AWS request of the page that was not a success. */
export interface EngineAnswer {
  method: string;
  path: string;
  /** IAM's `Action`, from the request's body; `null` for a Lambda request. */
  action: string | null;
  status: number;
  code: string | null;
  message: string | null;
}

/** The engine's answers of status 400 or more to the page's AWS requests, from Playwright's response events. */
export class EngineAnswers {
  readonly answers: EngineAnswer[] = [];
  private readonly pending: Promise<unknown>[] = [];

  private constructor(private readonly ctx: Ctx) {}

  static attach(ctx: Ctx, context: BrowserContext, engineOrigin: string): EngineAnswers {
    const record = new EngineAnswers(ctx);
    context.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin !== engineOrigin || url.pathname.startsWith('/__emuforge/') || response.status() < 400) return;
      const request = response.request();
      const action = new URLSearchParams(request.postData() ?? '').get('Action');
      record.pending.push(
        response
          .text()
          .then((body) => {
            const { code, message } = codeAndMessage(response.headers()['x-amzn-errortype'], body);
            const answer: EngineAnswer = {
              method: request.method(),
              path: url.pathname,
              action,
              status: response.status(),
              code,
              message,
            };
            record.answers.push(answer);
            ctx.log(
              `engine answered ${answer.method} ${answer.path}${action ? ` ${action}` : ''}: ${answer.status} ${code ?? ''}`,
            );
          })
          .catch(() => undefined),
      );
    });
    return record;
  }

  /** Waits until every answer read so far has been recorded. */
  async settle(): Promise<void> {
    for (;;) {
      const now = this.pending.splice(0);
      if (now.length === 0) return;
      await Promise.allSettled(now);
    }
  }

  /** The latest answer whose code is one of `codes`; `null` when none came. */
  latest(codes: string[]): EngineAnswer | null {
    return [...this.answers].reverse().find((a) => a.code !== null && codes.includes(a.code)) ?? null;
  }
}

/** The error code and message of an answer's header and JSON or XML body. */
function codeAndMessage(header: string | undefined, body: string): { code: string | null; message: string | null } {
  let code: string | null = header ? (header.split(':')[0] ?? null) : null;
  let message: string | null = null;
  try {
    const json = JSON.parse(body) as {
      __type?: string;
      code?: string;
      Code?: string;
      message?: string;
      Message?: string;
    };
    code = code ?? json.__type?.split('#').at(-1) ?? json.code ?? json.Code ?? null;
    message = json.message ?? json.Message ?? null;
  } catch {
    const tag = (name: string) => {
      const m = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(body);
      return m
        ? m[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&')
        : null;
    };
    code = code ?? tag('Code');
    message = tag('Message');
  }
  return { code, message };
}
