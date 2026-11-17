import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// "Delete functions" opened from the function list, inside the area's layout as Studio's frame renders the area,
// against a fake engine behind the page's `fetch` (test-criteria.md, issue 84, "Unit —
// services/lambda/components/delete-functions-dialog.test.tsx"). The dialog is met as a user meets it: from "Actions",
// with its results in the area's Flashbar and the list read again behind it.

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

interface FakeFunction {
  name: string;
  description?: string;
  packageType?: string;
  runtime?: string;
  lastModified?: string;
  durable?: boolean;
}

interface Answer {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

interface SentRequest {
  method: string;
  url: URL;
}

const LIST_PATH = /^\/2015-03-31\/functions\/?$/;
const FUNCTION_PATH = /^\/2015-03-31\/functions\/([^/]+)$/;

function json(status: number, body: unknown): Answer {
  return { status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
}

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: JSON.stringify({ message }),
    headers: { 'content-type': 'application/json', 'x-amzn-errortype': code },
  };
}

function item(fn: FakeFunction): Record<string, unknown> {
  return {
    FunctionName: fn.name,
    Description: fn.description ?? '',
    ...(fn.packageType === undefined ? {} : { PackageType: fn.packageType }),
    ...(fn.runtime === undefined ? {} : { Runtime: fn.runtime }),
    ...(fn.lastModified === undefined ? {} : { LastModified: fn.lastModified }),
    ...(fn.durable === true ? { DurableConfig: { RetentionPeriodInDays: 14 } } : {}),
  };
}

class FakeEngine {
  /** The functions the emulator holds; listed in code point order of their names, as the emulator lists them. */
  functions: FakeFunction[] = [];
  /** Every AWS request, as sent. */
  readonly aws: SentRequest[] = [];
  /** The answer to the next AWS requests; by default the emulator's. */
  answer: (request: SentRequest) => EngineAnswer = (request) => this.emulator(request);

  /** `ListFunctions` with `MaxItems` and `Marker` (the first name greater than it), and `DeleteFunction`. */
  emulator({ method, url }: SentRequest): Answer {
    if (method === 'GET' && LIST_PATH.test(url.pathname)) {
      const size = Number(url.searchParams.get('MaxItems') ?? '50');
      const marker = url.searchParams.get('Marker');
      const sorted = [...this.functions].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const after = marker === null ? sorted : sorted.filter((fn) => fn.name > marker);
      const page = after.slice(0, size);
      const more = after.length > size;
      return json(200, {
        Functions: page.map(item),
        ...(more ? { NextMarker: page.at(-1)?.name } : {}),
      });
    }
    const one = FUNCTION_PATH.exec(url.pathname);
    if (method === 'DELETE' && one !== null) {
      const name = decodeURIComponent(one[1] ?? '');
      if (!this.functions.some((fn) => fn.name === name)) {
        return errorAnswer(404, 'ResourceNotFoundException', `Function not found: ${name}`);
      }
      this.functions = this.functions.filter((fn) => fn.name !== name);
      return { status: 204, body: '' };
    }
    return errorAnswer(400, 'UnexpectedRequest', `${method} ${url.pathname}`);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-84' }), { status: 200 });
    }
    const sent = { method: request.method, url };
    this.aws.push(sent);
    const answer = await Promise.race([
      Promise.resolve(this.answer(sent)),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(answer.status === 204 ? null : answer.body, {
      status: answer.status,
      ...(answer.headers === undefined ? {} : { headers: answer.headers }),
    });
  };

  /** The `ListFunctions` requests sent so far. */
  get lists(): URL[] {
    return this.aws.filter(({ method, url }) => method === 'GET' && LIST_PATH.test(url.pathname)).map((r) => r.url);
  }

  /** The `DeleteFunction` requests sent so far, by function name. */
  get deletes(): string[] {
    return this.aws
      .filter(({ method, url }) => method === 'DELETE' && FUNCTION_PATH.test(url.pathname))
      .map(({ url }) => decodeURIComponent(FUNCTION_PATH.exec(url.pathname)?.[1] ?? ''));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

/** The connection Studio hands the area, as a case sets it; each change re-renders the area as the frame does. */
class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;

  set(result: CheckResult | undefined) {
    this.value = { ...this.value, result };
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

const EMULATOR_PORT = 9305;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

function notStartedResult(): CheckResult {
  return {
    kind: 'emulator-unreachable',
    checkedAt: Date.now(),
    emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT },
    reason: 'not_started',
    message: '',
  };
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 8990;
let engine: FakeEngine;
let connection: Connection;
let engineOrigin: string;
let titles: string[];

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={(title) => {
        titles.push(title);
      }}
      onContentTarget={() => undefined}
      routeChanges={changes}
      connection={current}
    />
  );
}

function matchMedia(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  vi.stubGlobal('matchMedia', matchMedia);
  nextPort += 1;
  engineOrigin = engineEndpoint(nextPort);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin };
  titles = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path = '/aws/lambda/functions') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, router };
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

function table() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

function tableElement(): HTMLElement {
  return table().getElement();
}

const norm = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

interface Row {
  name: string;
  description: string;
  packageType: string;
  runtime: string;
  type: string;
  lastModified: string;
}

/** The data rows' cells as text, by the column headings. */
function rows(): Row[] {
  return (table().findRows() ?? []).map((row) => {
    const cells = [...row.getElement().querySelectorAll('td, th')].map((cell) => norm(cell.textContent));
    // The first cell holds the check box.
    return {
      name: cells[1] ?? '',
      description: cells[2] ?? '',
      packageType: cells[3] ?? '',
      runtime: cells[4] ?? '',
      type: cells[5] ?? '',
      lastModified: cells[6] ?? '',
    };
  });
}

function names(): string[] {
  return rows().map((row) => row.name);
}

async function expectNames(expected: string[]) {
  await waitFor(() => {
    expect(names()).toEqual(expected);
  });
}

/** Matches the element whose whole text is `text`, and none of its children alone. */
function byWholeText(text: string) {
  return (_: string, element: Element | null): boolean =>
    element !== null &&
    norm(element.textContent) === text &&
    [...element.children].every((child) => norm(child.textContent) !== text);
}

function action(name: string): HTMLElement {
  return within(tableElement()).getByRole('button', { name });
}

/** A Cloudscape button is disabled by `disabled`, or with a reason by `aria-disabled`. */
function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function checkbox(name: string): HTMLInputElement {
  return within(tableElement()).getByRole('checkbox', { name });
}

function select(name: string) {
  fireEvent.click(checkbox(name));
}

/** Opens "Actions" and chooses "Delete"; the dialog renders into the area's root once that commit is done. */
async function openDeleteDialog(): Promise<HTMLElement> {
  fireEvent.click(action('Actions'));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  return screen.findByRole('dialog', { name: 'Delete functions' });
}

const ORDERS: FakeFunction = { name: 'orders', packageType: 'Zip', runtime: 'nodejs22.x' };
const REPORT: FakeFunction = { name: 'report', packageType: 'Zip', runtime: 'python3.13' };
const STEPS: FakeFunction = { name: 'steps', packageType: 'Zip', runtime: 'nodejs24.x' };

/** The list shown with three functions, `selected` checked, and the dialog opened from "Actions", "Delete". */
async function openDialogFor(selected: string[]): Promise<HTMLElement> {
  engine.functions = [ORDERS, REPORT, STEPS];
  open();
  await expectNames(['orders', 'report', 'steps']);
  for (const name of selected) {
    select(name);
  }
  return openDeleteDialog();
}

function field(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByLabelText('To confirm deletion, type "confirm" in the field.');
}

function type(dialog: HTMLElement, text: string) {
  fireEvent.change(field(dialog), { target: { value: text } });
}

function footerButton(dialog: HTMLElement, text: string): HTMLElement {
  const found = within(dialog)
    .getAllByRole('button', { name: text })
    .find((button) => norm(button.textContent) === text);
  expect(found).toBeDefined();
  return found as HTMLElement;
}

function deleteButton(dialog: HTMLElement): HTMLElement {
  return footerButton(dialog, 'Delete');
}

/** The area's Flashbar items: their type, and their header and content as text, each `''` when there is none. */
function flashItems(): { type: string; header: string; content: string }[] {
  return (PAGE.findFlashbar()?.findItems() ?? []).map((flash) => {
    const element = flash.getElement();
    const type = ['success', 'error', 'info', 'warning'].find((kind) =>
      [...element.querySelectorAll('*'), element].some((node) =>
        [...node.classList].some((name) => name.startsWith(`awsui_flash-type-${kind}_`)),
      ),
    );
    return {
      type: type ?? 'unknown',
      header: norm(flash.findHeader()?.getElement().textContent ?? null),
      content: norm(flash.findContent()?.getElement().textContent ?? null),
    };
  });
}

/** "Delete functions" is not shown: Cloudscape keeps a closed modal in the document, hidden. */
async function dialogClosed() {
  await waitFor(() => {
    const shown = PAGE.findAllModals().filter(
      (modal) => modal.isVisible() && norm(modal.findHeader().getElement().textContent) === 'Delete functions',
    );
    expect(shown).toEqual([]);
  });
}

describe('the dialog as it opens', () => {
  it('opened for two functions while connected: the title, both names as a list, the sentence with the endpoint, the field, "Cancel" and a disabled "Delete"', async () => {
    const dialog = await openDialogFor(['orders', 'steps']);

    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((entry) => norm(entry.textContent)),
    ).toEqual(['orders', 'steps']);
    expect(
      within(dialog).getByText(
        byWholeText(
          `They will be deleted from your local emulator at ${EMULATOR_ENDPOINT}, with their code and settings. This cannot be undone.`,
        ),
      ),
    ).toBeInTheDocument();
    expect(field(dialog)).toHaveAttribute('placeholder', 'confirm');
    expect(field(dialog)).toHaveValue('');
    expect(footerButton(dialog, 'Cancel')).toBeInTheDocument();
    expect(isDisabled(deleteButton(dialog))).toBe(true);
  });

  it('opened while not connected: the sentence holds no endpoint', async () => {
    engine.functions = [ORDERS];
    open();
    await expectNames(['orders']);
    connection.set(notStartedResult());
    select('orders');
    const dialog = await openDeleteDialog();

    expect(
      within(dialog).getByText(
        byWholeText(
          'They will be deleted from your local emulator, with their code and settings. This cannot be undone.',
        ),
      ),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(EMULATOR_ENDPOINT);
  });
});

describe('the field', () => {
  it('`confirm` enables "Delete"; `Confirm`, `confirm ` and `confir` do not', async () => {
    const dialog = await openDialogFor(['orders']);

    type(dialog, 'confirm');
    expect(isDisabled(deleteButton(dialog))).toBe(false);
    for (const text of ['Confirm', 'confirm ', 'confir']) {
      type(dialog, text);
      expect(isDisabled(deleteButton(dialog))).toBe(true);
    }
  });

  it('typed one character at a time: the field stays the same element, keeps focus and holds what was typed', async () => {
    const dialog = await openDialogFor(['orders']);
    const input = field(dialog);
    input.focus();

    for (const text of ['c', 'co', 'con', 'conf', 'confi', 'confir', 'confirm']) {
      fireEvent.change(input, { target: { value: text } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(input.isConnected).toBe(true);
      expect(document.activeElement).toBe(input);
    }
    expect(input).toHaveValue('confirm');
    expect(isDisabled(deleteButton(dialog))).toBe(false);
  });

  it('Enter with `confirm` typed does what "Delete" does; with anything else nothing is sent', async () => {
    const dialog = await openDialogFor(['orders']);

    type(dialog, 'confir');
    fireEvent.keyDown(field(dialog), { key: 'Enter', keyCode: 13 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.deletes).toEqual([]);

    type(dialog, 'confirm');
    fireEvent.keyDown(field(dialog), { key: 'Enter', keyCode: 13 });
    await dialogClosed();
    expect(engine.deletes).toEqual(['orders']);
  });
});

describe('"Delete"', () => {
  it('one DeleteFunction per function in order; meanwhile "Delete" is disabled and shows progress, and a second press sends nothing', async () => {
    const releases: (() => void)[] = [];
    const dialog = await openDialogFor(['orders', 'steps']);
    engine.answer = (request) =>
      request.method === 'DELETE'
        ? new Promise<Answer>((resolve) => {
            releases.push(() => {
              resolve(engine.emulator(request));
            });
          })
        : engine.emulator(request);

    type(dialog, 'confirm');
    fireEvent.click(deleteButton(dialog));
    await waitFor(() => {
      expect(engine.deletes).toEqual(['orders']);
    });
    expect(isDisabled(deleteButton(dialog))).toBe(true);
    expect(deleteButton(dialog).querySelector('[class*="awsui_spinner"], [class*="awsui_icon"]')).not.toBeNull();
    fireEvent.click(deleteButton(dialog));
    fireEvent.keyDown(field(dialog), { key: 'Enter', keyCode: 13 });
    releases.shift()?.();
    await waitFor(() => {
      expect(engine.deletes).toEqual(['orders', 'steps']);
    });
    releases.shift()?.();
    await dialogClosed();
    expect(engine.deletes).toEqual(['orders', 'steps']);
  });

  it('every request succeeds: the dialog closes, "2 functions were deleted from the local emulator.", and the list is read again', async () => {
    const dialog = await openDialogFor(['orders', 'steps']);
    const sent = engine.lists.length;

    type(dialog, 'confirm');
    fireEvent.click(deleteButton(dialog));
    await dialogClosed();
    await waitFor(() => {
      expect(flashItems()).toEqual([
        { type: 'success', header: '', content: '2 functions were deleted from the local emulator.' },
      ]);
    });
    expect(engine.lists.length).toBeGreaterThan(sent);
    await expectNames(['report']);
  });

  it('one function deleted: "1 function was deleted from the local emulator."', async () => {
    const dialog = await openDialogFor(['report']);

    type(dialog, 'confirm');
    fireEvent.click(deleteButton(dialog));
    await waitFor(() => {
      expect(flashItems()).toEqual([
        { type: 'success', header: '', content: '1 function was deleted from the local emulator.' },
      ]);
    });
    await expectNames(['orders', 'steps']);
  });

  it('one of two fails with a code and a message: an error item "Deleting <name> failed" with them, a success item for the other, the list read again', async () => {
    const dialog = await openDialogFor(['orders', 'steps']);
    // Deleted elsewhere meanwhile.
    engine.functions = engine.functions.filter((fn) => fn.name !== 'orders');
    const sent = engine.lists.length;

    type(dialog, 'confirm');
    fireEvent.click(deleteButton(dialog));
    await dialogClosed();
    await waitFor(() => {
      expect(flashItems()).toEqual([
        {
          type: 'error',
          header: 'Deleting orders failed',
          content: 'ResourceNotFoundException: Function not found: orders',
        },
        { type: 'success', header: '', content: '1 function was deleted from the local emulator.' },
      ]);
    });
    expect(engine.deletes).toEqual(['orders', 'steps']);
    expect(engine.lists.length).toBeGreaterThan(sent);
    await expectNames(['report']);
  });

  it('a request answers 501: "Not implemented by the emulator" as information; AccessDenied: "Access denied" with "DeleteFunction was refused: " and the message', async () => {
    let dialog = await openDialogFor(['orders']);
    engine.answer = (request) =>
      request.method === 'DELETE'
        ? errorAnswer(501, 'NotImplemented', 'DeleteFunction is not implemented')
        : engine.emulator(request);
    type(dialog, 'confirm');
    fireEvent.click(deleteButton(dialog));
    await waitFor(() => {
      expect(flashItems()).toEqual([
        {
          type: 'info',
          header: 'Not implemented by the emulator',
          content: 'The emulator answered 501 Not Implemented for DeleteFunction.',
        },
      ]);
    });

    await expectNames(['orders', 'report', 'steps']);
    // The delete failed, so the function is still on the page and still selected (R4.3).
    expect(checkbox('orders')).toBeChecked();
    dialog = await openDeleteDialog();
    engine.answer = (request) =>
      request.method === 'DELETE'
        ? errorAnswer(403, 'AccessDeniedException', 'not allowed to delete orders')
        : engine.emulator(request);
    type(dialog, 'confirm');
    fireEvent.click(deleteButton(dialog));
    await waitFor(() => {
      expect(flashItems()).toEqual([
        {
          type: 'error',
          header: 'Access denied',
          content: 'DeleteFunction was refused: not allowed to delete orders',
        },
      ]);
    });
  });
});

describe('closing without deleting', () => {
  it.each(['Cancel', 'Esc'])('%s: the dialog closes, no request, focus on "Actions"', async (how) => {
    const dialog = await openDialogFor(['orders']);
    type(dialog, 'confirm');

    if (how === 'Cancel') {
      fireEvent.click(footerButton(dialog, 'Cancel'));
    } else {
      fireEvent.keyDown(field(dialog), { key: 'Escape', keyCode: 27 });
    }
    await dialogClosed();
    expect(engine.deletes).toEqual([]);
    await waitFor(() => {
      expect(document.activeElement).toBe(action('Actions'));
    });
  });
});
