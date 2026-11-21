/// <reference types="node" />
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// The function list rendered inside the area's layout, as Studio's frame renders the area, against a fake engine
// behind the page's `fetch` (test-criteria.md, issue 84, "Unit — services/lambda/pages/function-list-page.test.tsx").

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
let nextPort = 8960;
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
  return { ...result, router, client };
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

/** The `h1` as shown: "Event Functions (3)". */
function headingText(): string {
  return norm(screen.getByRole('heading', { level: 1 }).textContent);
}

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

function emptySlot(): HTMLElement | null {
  return table().findEmptySlot()?.getElement() ?? null;
}

function slot(): HTMLElement {
  const found = emptySlot();
  expect(found).not.toBeNull();
  return found as HTMLElement;
}

function action(name: string): HTMLElement {
  return within(tableElement()).getByRole('button', { name });
}

/** A Cloudscape button is disabled by `disabled`, or with a reason by `aria-disabled`. */
function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function propertyFilter() {
  const found = table().findPropertyFilter();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

function filterInput(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Search by attributes or search by keyword' });
}

function typeFilter(text: string) {
  fireEvent.change(filterInput(), { target: { value: text } });
}

/** "Apply the filter `text`": typed, then Enter. */
function applyFilter(text: string) {
  typeFilter(text);
  fireEvent.keyDown(filterInput(), { key: 'Enter', keyCode: 13 });
}

function tokens(): string[] {
  return (propertyFilter().findTokens() ?? []).map((token) => norm(token.findLabel().getElement().textContent));
}

function resultsCount(): string | null {
  const count = propertyFilter().findResultsCount();
  return count === null ? null : norm(count.getElement().textContent);
}

function checkbox(name: string): HTMLInputElement {
  return within(tableElement()).getByRole('checkbox', { name });
}

function select(name: string) {
  fireEvent.click(checkbox(name));
}

function nextPage(): HTMLElement {
  return screen.getByRole('button', { name: 'Next page' });
}

function previousPage(): HTMLElement {
  return screen.getByRole('button', { name: 'Previous page' });
}

/** Every text said in a polite live region from now on, in order. */
function recordAnnouncements(): string[] {
  const said: string[] = [];
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const region =
        mutation.target instanceof Element
          ? mutation.target.closest('[aria-live="polite"]')
          : mutation.target.parentElement?.closest('[aria-live="polite"]');
      if (region !== null && region !== undefined) {
        for (const node of mutation.addedNodes) {
          const text = (node.textContent ?? '').trim();
          if (text !== '') {
            said.push(text);
          }
        }
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  return said;
}

/** Opens "Actions" and chooses "Delete"; the dialog renders into the area's root once that commit is done. */
async function openDeleteDialog(): Promise<HTMLElement> {
  fireEvent.click(action('Actions'));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  return screen.findByRole('dialog', { name: 'Delete functions' });
}

const visibleDialog = () => PAGE.findAllModals().find((dialog) => dialog.isVisible());
const flashTexts = () =>
  (PAGE.findFlashbar()?.findItems() ?? []).map((item) =>
    norm(`${item.findHeader()?.getElement().textContent ?? ''} ${item.findContent()?.getElement().textContent ?? ''}`),
  );
function selectionAt(index: number, label: string) {
  const selection = table().findRowSelectionArea(index)?.find('input[type="checkbox"]')?.getElement();
  if (!selection) throw new Error('Expected a function selection control');
  expect(selection).toHaveAccessibleName(label);
  return selection;
}
async function confirmDialog() {
  const menu = table().findHeaderSlot()?.findHeader()?.findActions()?.findButtonDropdown();
  if (!menu) throw new Error('Expected the function list action menu');
  const menuButton = menu.findNativeButton().getElement();
  expect(menuButton).toHaveAccessibleName('Actions');
  menuButton.focus();
  act(() => menu.openDropdown());
  const entry = menu.findItemById('delete')?.find('[role="menuitem"]')?.getElement();
  if (!entry) throw new Error('Expected the Delete menu action');
  expect(entry).toHaveAccessibleName('Delete');
  fireEvent.click(entry);
  return waitFor(() => {
    const dialog = visibleDialog();
    if (!dialog) throw new Error('Expected the bulk deletion confirmation');
    expect(dialog.findHeader().getElement()).toHaveTextContent('Delete functions');
    const content = dialog.findContent();
    const field = content.findFormField();
    const input = field?.findControl()?.findInput();
    const [cancel, submit] = dialog.findFooter()?.findAllButtons() ?? [];
    if (!input || !submit || !cancel) throw new Error('Expected the confirmation controls');
    expect(field?.findLabel()?.getElement()).toHaveTextContent('To confirm deletion, type "confirm" in the field.');
    expect(cancel.getElement()).toHaveAccessibleName('Cancel');
    expect(submit.getElement()).toHaveAccessibleName('Delete');
    return {
      input,
      cancel,
      submit,
      menuButton,
      names: content.findAll('li').map((item) => norm(item.getElement().textContent)),
    };
  });
}

const NODE: FakeFunction = {
  name: 'orders',
  description: 'Takes the orders',
  packageType: 'Zip',
  runtime: 'nodejs22.x',
  lastModified: '2026-11-17T02:22:16.474+0000',
};
const PY: FakeFunction = {
  name: 'report',
  packageType: 'Zip',
  runtime: 'python3.13',
  lastModified: '2026-11-16T10:00:00.000+0000',
};
const DURABLE: FakeFunction = {
  name: 'steps',
  description: 'Runs the steps',
  packageType: 'Zip',
  runtime: 'nodejs24.x',
  lastModified: '2026-11-15T08:30:00.000+0000',
  durable: true,
};
const THREE = [NODE, PY, DURABLE];

function many(count: number, from = 'f'): FakeFunction[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `${from}-${String(index + 1).padStart(2, '0')}`,
    packageType: 'Zip',
    runtime: 'python3.14',
  }));
}

async function openLoaded(functions: FakeFunction[] = THREE, path?: string) {
  engine.functions = functions;
  const opened = open(path);
  await expectNames([...functions.map((fn) => fn.name)].sort());
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------

describe('the function list, loaded', () => {
  it('three functions: the h1 with "(3)", the actions in order, the columns in order, one row per function in the answer’s order, each name a link and the row header', async () => {
    await openLoaded();

    expect(headingText()).toBe('Event Functions (3)');
    const order = ['Refresh', 'Actions', 'Create Event Function'].map((name) => action(name));
    order.reduce((before, button) => {
      expect(before.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      return button;
    });
    const headings = (table().findColumnHeaders() ?? []).map((header) => norm(header.getElement().textContent));
    // The first heading is the selection column's.
    expect(headings.slice(1)).toEqual([
      'Function name',
      'Description',
      'Package type',
      'Runtime',
      'Type',
      'Last modified',
    ]);
    expect(names()).toEqual(['orders', 'report', 'steps']);
    const [orders, report, steps] = rows();
    expect(orders).toMatchObject({
      description: 'Takes the orders',
      packageType: 'Zip',
      runtime: 'Node.js 22.x',
      type: 'Standard',
    });
    expect(report).toMatchObject({ description: '-', runtime: 'Python 3.13', type: 'Standard' });
    expect(steps).toMatchObject({ runtime: 'Node.js 24.x', type: 'Durable' });
    for (const row of rows()) {
      expect(row.lastModified).toMatch(/^November \d{1,2}, 2026, \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
    }
    for (const name of names()) {
      const link = within(tableElement()).getByRole('link', { name });
      expect(link).toHaveAttribute('href', `/aws/lambda/functions/function/${name}`);
      expect(screen.getByRole('rowheader', { name })).toContainElement(link);
    }
  });

  it('the crumbs EmuForge, AWS, Lambda, Event Functions, the last not a link; the title "Event Functions"; the navigation "Lambda" with "Event Functions" current', async () => {
    await openLoaded();

    const crumbs = (PAGE.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((crumb) => {
      const element = crumb.getElement();
      const link = element.closest('a[href]') ?? element.querySelector('a[href]');
      return [norm(element.textContent), link?.getAttribute('href') ?? null];
    });
    expect(crumbs).toEqual([
      ['EmuForge', '/'],
      ['AWS', '/aws'],
      ['Lambda', '/aws/lambda'],
      ['Event Functions', null],
    ]);
    // Studio's frame writes it as "Event Functions | EmuForge Studio" (app/routes.test.tsx).
    expect(titles.at(-1)).toBe('Event Functions');
    const navigation = PAGE.findSideNavigation();
    expect(norm(navigation?.findHeaderLink()?.getElement().textContent ?? null)).toBe('Lambda');
    expect(navigation?.findHeaderLink()?.getElement()).toHaveAttribute('href', '/aws/lambda');
    const links = (navigation?.findLinkByHref('/aws/lambda/functions') ?? null)?.getElement();
    expect(links).toHaveTextContent('Event Functions');
    expect(navigation?.findActiveLink()?.getElement()).toHaveAttribute('href', '/aws/lambda/functions');
    expect(navigation?.getElement().querySelectorAll('a[href]')).toHaveLength(2);
  });

  it('the notice "These functions are in your local emulator"; the description is the filter\'s rule with no endpoint, connected, not started and before the first answer (issue 467, R3)', async () => {
    await openLoaded();

    const DESCRIPTION = 'The filter matches the start of a name and is case-sensitive.';
    const description = (): string => {
      const h1 = screen.getByRole('heading', { level: 1 });
      const header = PAGE.findAllHeaders().find((found) => found.getElement().contains(h1));
      return norm(header?.findDescription()?.getElement().textContent ?? null);
    };
    expect(screen.getByText('These functions are in your local emulator')).toBeInTheDocument();
    expect(description()).toBe(DESCRIPTION);

    connection.set(notStartedResult());
    await waitFor(() => {
      expect(screen.getAllByText(/^Not started on port/).length).toBeGreaterThan(0);
    });
    expect(description()).toBe(DESCRIPTION);

    connection.set(undefined);
    await waitFor(() => {
      expect(screen.getAllByText('Checking').length).toBeGreaterThan(0);
    });
    expect(description()).toBe(DESCRIPTION);
    expect(within(tableElement()).queryByText(new RegExp(EMULATOR_ENDPOINT.replace(/\./g, '\\.')))).toBeNull();
  });

  it('no column heading is a sorting control', async () => {
    await openLoaded();

    for (const header of table().findColumnHeaders()) {
      expect(header.getElement()).not.toHaveAttribute('aria-sort');
      expect(within(header.getElement()).queryByRole('button')).toBeNull();
    }
    expect(table().findColumnSortingArea(2)).toBeNull();
  });

  it('a description `<b>x</b>` from the emulator is shown as that text, no bold element', async () => {
    await openLoaded([{ ...NODE, description: '<b>x</b>' }]);

    expect(rows()[0]?.description).toBe('<b>x</b>');
    expect(tableElement().querySelector('tbody b')).toBeNull();
  });
});

describe('selection and "Actions"', () => {
  it('no row selected: "Actions" is disabled with "Select a function first"; a row selected: a menu with the one entry "Delete"', async () => {
    await openLoaded();

    expect(isDisabled(action('Actions'))).toBe(true);
    expect(action('Actions')).toHaveAccessibleDescription('Select a function first');

    select('report');
    expect(isDisabled(action('Actions'))).toBe(false);
    fireEvent.click(action('Actions'));
    const entries = await screen.findAllByRole('menuitem');
    expect(entries.map((entry) => norm(entry.textContent))).toEqual(['Delete']);
  });

  it('the heading’s check box is "Select all items", a row’s is named by its function; the heading’s selects every row', async () => {
    await openLoaded();

    for (const name of names()) {
      expect(checkbox(name)).not.toBeChecked();
    }
    fireEvent.click(checkbox('Select all items'));
    for (const name of names()) {
      expect(checkbox(name)).toBeChecked();
    }
  });

  it('"Refresh": a new ListFunctions, a selected name still on the page stays selected, "Function list refreshed" announced once', async () => {
    await openLoaded();
    const said = recordAnnouncements();

    select('report');
    fireEvent.click(action('Refresh'));
    await waitFor(() => {
      expect(engine.lists).toHaveLength(2);
    });
    await expectNames(['orders', 'report', 'steps']);
    expect(checkbox('report')).toBeChecked();
    await waitFor(() => {
      expect(said).toContain('Function list refreshed');
    });
    expect(said.filter((text) => text === 'Function list refreshed')).toHaveLength(1);
  });

  it('two rows selected, "Refresh" answered without one: that name is no longer selected, the other is, and the dialog lists the one', async () => {
    await openLoaded();

    select('orders');
    select('steps');
    engine.functions = [NODE, PY];
    fireEvent.click(action('Refresh'));
    await expectNames(['orders', 'report']);
    expect(checkbox('orders')).toBeChecked();
    expect(checkbox('report')).not.toBeChecked();

    const dialog = await openDeleteDialog();
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((entry) => norm(entry.textContent)),
    ).toEqual(['orders']);
  });
});

describe('pages', () => {
  it('a page with a NextMarker: the counter ends with "+", "Next page" asks with that marker; page 1 can be gone back to and is read again', async () => {
    engine.functions = many(30);
    open();
    await expectNames(many(25).map((fn) => fn.name));

    expect(headingText()).toBe('Event Functions (25+)');
    expect(isDisabled(nextPage())).toBe(false);
    fireEvent.click(nextPage());
    await expectNames(
      many(30)
        .slice(25)
        .map((fn) => fn.name),
    );
    expect(engine.lists.at(-1)?.searchParams.get('Marker')).toBe('f-25');
    expect(headingText()).toBe('Event Functions (30)');

    const sent = engine.lists.length;
    fireEvent.click(previousPage());
    await expectNames(many(25).map((fn) => fn.name));
    expect(engine.lists).toHaveLength(sent + 1);
    expect(engine.lists.at(-1)?.searchParams.get('Marker')).toBeNull();
  });

  it.each(['Refresh', 'a page size', 'a filter'])(
    'on page 2, %s: page 1 is shown, read with no Marker (the filter’s own for the filter), "Previous page" disabled',
    async (what) => {
      engine.functions = many(30);
      open();
      await expectNames(many(25).map((fn) => fn.name));
      fireEvent.click(nextPage());
      await expectNames(
        many(30)
          .slice(25)
          .map((fn) => fn.name),
      );

      if (what === 'Refresh') {
        fireEvent.click(action('Refresh'));
      } else if (what === 'a page size') {
        fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
        const dialog = await screen.findByRole('dialog', { name: 'Preferences' });
        fireEvent.click(within(dialog).getByRole('radio', { name: '10 functions' }));
        fireEvent.click(
          within(dialog)
            .getAllByRole('button', { name: 'Confirm' })
            .find((button) => button.textContent === 'Confirm') as HTMLElement,
        );
      } else {
        applyFilter('f-');
      }
      const expected = what === 'a page size' ? 10 : 25;
      await expectNames(many(expected).map((fn) => fn.name));
      const last = engine.lists.at(-1);
      expect(last?.searchParams.get('Marker')).toBe(what === 'a filter' ? 'f,~' : null);
      expect(isDisabled(previousPage())).toBe(true);
    },
  );

  it('page 2 fails: "Retry" asks for page 2 again with its marker, and page 2 is shown', async () => {
    engine.functions = many(30);
    open();
    await expectNames(many(25).map((fn) => fn.name));

    engine.answer = () => errorAnswer(500, 'ServiceException', 'broken');
    fireEvent.click(nextPage());
    await waitFor(() => {
      expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    expect(engine.lists.at(-1)?.searchParams.get('Marker')).toBe('f-25');

    const sent = engine.lists.length;
    engine.answer = (request) => engine.emulator(request);
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await expectNames(
      many(30)
        .slice(25)
        .map((fn) => fn.name),
    );
    expect(engine.lists).toHaveLength(sent + 1);
    expect(engine.lists.at(-1)?.searchParams.get('Marker')).toBe('f-25');
  });

  it('"Next page" answered with no function: the page shown stays, "Next page" disabled, no "+", "No more functions" announced once', async () => {
    engine.functions = many(30);
    open();
    await expectNames(many(25).map((fn) => fn.name));
    const said = recordAnnouncements();

    engine.functions = many(25);
    fireEvent.click(nextPage());
    await waitFor(() => {
      expect(said).toContain('No more functions');
    });
    expect(names()).toEqual(many(25).map((fn) => fn.name));
    expect(isDisabled(nextPage())).toBe(true);
    expect(headingText()).toBe('Event Functions (25)');
    expect(said.filter((text) => text === 'No more functions')).toHaveLength(1);
  });
});

describe('the filter', () => {
  it('`ab` typed without Enter: no request; Enter: one token, a new listing with the marker `aa~`, "<n> matches"; a second text replaces the token', async () => {
    await openLoaded([
      { name: 'ab-' },
      { name: 'abb' },
      { name: 'abc' },
      { name: 'abc-' },
      { name: 'abc-x' },
      { name: 'abd' },
      { name: 'b' },
    ]);
    const sent = engine.lists.length;

    typeFilter('ab');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.lists).toHaveLength(sent);

    fireEvent.keyDown(filterInput(), { key: 'Enter', keyCode: 13 });
    await expectNames(['ab-', 'abb', 'abc', 'abc-', 'abc-x', 'abd']);
    expect(tokens()).toEqual(['ab']);
    expect(engine.lists).toHaveLength(sent + 1);
    expect(engine.lists.at(-1)?.searchParams.get('Marker')).toBe('aa~');
    expect(resultsCount()).toBe('6 matches');

    applyFilter('abc');
    await expectNames(['abc', 'abc-', 'abc-x']);
    expect(tokens()).toEqual(['abc']);
    expect(engine.lists.at(-1)?.searchParams.get('Marker')).toBe('abb~');
    expect(resultsCount()).toBe('3 matches');

    applyFilter('abd');
    await expectNames(['abd']);
    expect(resultsCount()).toBe('1 match');
  });

  it('a filter with no function: "No matches", "No function name starts with “ab”." and "Clear filter", which removes the token and lists everything', async () => {
    await openLoaded([{ name: 'orders' }]);

    applyFilter('ab');
    await waitFor(() => {
      expect(emptySlot()).toHaveTextContent('No matches');
    });
    expect(slot()).toHaveTextContent('No function name starts with “ab”.');
    // What the user typed is quoted as a name (issue 467, R6).
    expect([...slot().querySelectorAll('.aws-area-value-name')].map((found) => found.textContent)).toEqual(['ab']);
    fireEvent.click(within(slot()).getByRole('button', { name: 'Clear filter' }));
    await expectNames(['orders']);
    expect(tokens()).toEqual([]);
    expect(engine.lists.at(-1)?.searchParams.get('Marker')).toBeNull();
  });

  it('a filter text with a space: "No matches" and no request', async () => {
    await openLoaded();
    const sent = engine.lists.length;

    applyFilter('a b');
    await waitFor(() => {
      expect(emptySlot()).toHaveTextContent('No matches');
    });
    expect(engine.lists).toHaveLength(sent);
  });

  it('Enter in the empty filter: no token, no request, the list unchanged', async () => {
    await openLoaded();
    const sent = engine.lists.length;

    fireEvent.keyDown(filterInput(), { key: 'Enter', keyCode: 13 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tokens()).toEqual([]);
    expect(engine.lists).toHaveLength(sent);
    expect(names()).toEqual(['orders', 'report', 'steps']);
  });
});

describe('preferences', () => {
  it('"Preferences": page size 10, 25 (chosen), 50 "functions" and "Wrap lines" (on); page size 10 confirmed starts a new listing with MaxItems 10', async () => {
    await openLoaded();
    expect(engine.lists.at(-1)?.searchParams.get('MaxItems')).toBe('25');

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const dialog = await screen.findByRole('dialog', { name: 'Preferences' });
    expect(within(dialog).getByText('Page size')).toBeInTheDocument();
    for (const size of ['10 functions', '25 functions', '50 functions']) {
      expect(within(dialog).getByRole('radio', { name: size })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('radio', { name: '25 functions' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Wrap lines/ })).toBeChecked();
    expect(within(dialog).getByText('Show all of a long description')).toBeInTheDocument();

    const sent = engine.lists.length;
    fireEvent.click(within(dialog).getByRole('radio', { name: '10 functions' }));
    fireEvent.click(
      within(dialog)
        .getAllByRole('button', { name: 'Confirm' })
        .find((button) => button.textContent === 'Confirm') as HTMLElement,
    );
    await waitFor(() => {
      expect(engine.lists).toHaveLength(sent + 1);
    });
    expect(engine.lists.at(-1)?.searchParams.get('MaxItems')).toBe('10');
    expect(engine.lists.at(-1)?.searchParams.get('Marker')).toBeNull();
  });
  it('"Preferences" opened, "50 functions" chosen with the arrow keys, then a new connection answer: the same dialog, "50 functions" has focus and is chosen (issue 462)', async () => {
    const user = userEvent.setup();
    await openLoaded();

    await user.click(screen.getByRole('button', { name: 'Preferences' }));
    const dialog = await screen.findByRole('dialog', { name: 'Preferences' });
    const chosen = within(dialog).getByRole('radio', { name: '25 functions' });
    expect(chosen).toBeChecked();
    act(() => {
      chosen.focus();
    });
    await user.keyboard('{ArrowDown}');
    const fifty = within(dialog).getByRole('radio', { name: '50 functions' });
    expect(fifty).toBeChecked();
    expect(document.activeElement).toBe(fifty);

    // What the area sees every 5 seconds: a new answer object, the same state.
    connection.set(connectedResult());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(dialog.isConnected).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBe(dialog);
    expect(fifty.isConnected).toBe(true);
    expect(document.activeElement).toBe(fifty);
    expect(fifty).toBeChecked();
  });

  it('a row\'s cells, each as its kind of value (issue 467, R6): the name a name inside its link, the description free text, "Package type", "Runtime", "Type" and "Last modified" fixed words; with "Wrap lines" off the same kinds', async () => {
    const name = 'x'.repeat(64);
    const description = 'd'.repeat(256);
    await openLoaded([{ ...NODE, name, description }]);

    const KINDS = ['name', 'text', 'fixed', 'fixed', 'fixed', 'fixed'];
    /** The kind each data cell's value is shown as, in the columns' order. */
    const kinds = (): string[] => {
      const row = table().findRows()[0]?.getElement();
      // The first cell holds the check box.
      return [...(row?.querySelectorAll('td, th') ?? [])].slice(1).map((cell) => {
        const values = [...cell.querySelectorAll('.aws-area-value')];
        expect(values, `one value in "${norm(cell.textContent)}"`).toHaveLength(1);
        const kind = [...(values[0]?.classList ?? [])].find((found) => /^aws-area-value-[a-z]+$/.test(found));
        return kind?.replace('aws-area-value-', '') ?? '';
      });
    };
    const nameValue = (): Element | null => tableElement().querySelector('tbody th .aws-area-value-name');

    expect(kinds()).toEqual(KINDS);
    expect(norm(nameValue()?.textContent ?? null)).toBe(name);
    expect(nameValue()?.closest('a')).toBe(within(tableElement()).getByRole('link', { name }));
    expect(rows()[0]?.description).toBe(description);

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const dialog = await screen.findByRole('dialog', { name: 'Preferences' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Wrap lines/ }));
    fireEvent.click(
      within(dialog)
        .getAllByRole('button', { name: 'Confirm' })
        .find((button) => button.textContent === 'Confirm') as HTMLElement,
    );
    await waitFor(() => {
      expect(table().getElement().querySelector('[class*="body-cell-wrap"]')).toBeNull();
    });
    expect(kinds()).toEqual(KINDS);
    expect(rows()[0]?.name).toBe(name);
    expect(rows()[0]?.description).toBe(description);
  });
});

describe('loading and empty', () => {
  it('no function, no filter: "No functions", the sentence and "Create Event Function" to /aws/lambda/functions/create; the counter "(0)"', async () => {
    const { router } = open();

    await waitFor(() => {
      expect(emptySlot()).toHaveTextContent('No functions');
    });
    expect(slot()).toHaveTextContent(
      'This emulator holds no functions. It starts empty each time it restarts. Create one here, or with any tool pointed at the emulator.',
    );
    expect(headingText()).toBe('Event Functions (0)');
    fireEvent.click(within(slot()).getByRole('button', { name: 'Create Event Function' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/lambda/functions/create');
    });
  });

  it('while the first answer is awaited: "Loading functions", no counter, the filter, pagination and preferences disabled; heading, actions and columns there', async () => {
    let release: (answer: Answer) => void = () => undefined;
    engine.answer = () =>
      new Promise<Answer>((resolve) => {
        release = resolve;
      });
    open();

    await waitFor(() => {
      expect(tableElement()).toHaveTextContent('Loading functions');
    });
    expect(headingText()).toBe('Event Functions');
    expect(filterInput()).toBeDisabled();
    expect(isDisabled(nextPage())).toBe(true);
    expect(isDisabled(previousPage())).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Preferences' }))).toBe(true);
    for (const name of ['Refresh', 'Actions', 'Create Event Function']) {
      expect(action(name)).toBeInTheDocument();
    }
    expect((table().findColumnHeaders() ?? []).map((header) => norm(header.getElement().textContent))).toContain(
      'Function name',
    );

    engine.functions = [NODE];
    release(engine.emulator({ method: 'GET', url: engine.lists[0] as URL }));
    await expectNames(['orders']);
    expect(filterInput()).not.toBeDisabled();
    expect(headingText()).toBe('Event Functions (1)');
  });
  it('reports an expired offline confirmation once when no deletion was sent', async () => {
    const message =
      'The browser connection changed before any deletion outcome was confirmed. Reopen Delete from Actions and confirm again.';
    const announcements = recordAnnouncements();
    const interruptionEntries = () => announcements.filter((entry) => entry.includes(message));
    const { client, unmount } = await openLoaded([NODE, { name: 'payments' }]);
    const wasOnline = onlineManager.isOnline();
    const browserOnline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      fireEvent.click(selectionAt(1, 'orders'));
      fireEvent.click(selectionAt(2, 'payments'));
      const original = await confirmDialog();
      expect(original.names).toEqual(['orders', 'payments']);
      act(() => original.input.setInputValue('confirm'));
      expect(original.submit.getElement()).toBeEnabled();

      browserOnline.mockReturnValue(false);
      fireEvent(window, new Event('offline'));
      expect(onlineManager.isOnline()).toBe(false);
      act(() => original.submit.click());
      await waitFor(() => {
        const [queued] = client.getMutationCache().getAll();
        expect(queued?.state.isPaused).toBe(true);
        expect(visibleDialog()?.findContent().getElement()).toHaveTextContent('Deleting functions…');
        expect(original.cancel.getElement()).toBeDisabled();
      });
      expect(engine.deletes).toEqual([]);
      expect(flashTexts()).toEqual([]);

      browserOnline.mockReturnValue(true);
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        await client.resumePausedMutations();
      });
      await waitFor(() => {
        expect(visibleDialog()).toBeUndefined();
        expect(original.menuButton).toHaveFocus();
        expect(flashTexts()).toEqual([message]);
      });
      expect(engine.deletes).toEqual([]);
      await expectNames(['orders', 'payments']);
      expect(selectionAt(1, 'orders')).toBeChecked();
      expect(selectionAt(2, 'payments')).toBeChecked();
      // Flashbar commits the polite update after its announcement delay, outside the dialog.
      await waitFor(() => expect(interruptionEntries()).toEqual([`Info ${message}`]), { timeout: 2500 });

      const fresh = await confirmDialog();
      expect(fresh.names).toEqual(['orders', 'payments']);
      expect(fresh.input.getInputValue()).toBe('');
      expect(fresh.submit.getElement()).toBeDisabled();
      fireEvent.keyDown(fresh.input.findNativeInput().getElement(), { key: 'Enter' });
      expect(engine.deletes).toEqual([]);
      act(() => fresh.cancel.click());
      await waitFor(() => {
        expect(visibleDialog()).toBeUndefined();
        expect(fresh.menuButton).toHaveFocus();
      });
      expect(flashTexts()).toEqual([message]);
      expect(interruptionEntries()).toEqual([`Info ${message}`]);
    } finally {
      unmount();
      browserOnline.mockRestore();
      onlineManager.setOnline(wasOnline);
    }
  });

  it.each(['success', 'refusal'] as const)(
    'keeps the first bulk deletion %s after native reconnect and requires a fresh confirmation for the rest',
    async (outcome) => {
      const success = outcome === 'success';
      const interruption = 'The browser connection changed. Confirm any remaining deletions again.';
      const reported = success
        ? '1 function was deleted from the local emulator.'
        : 'Deleting orders failed ResourceConflictException: Function is in use';
      let firstRequest: SentRequest | undefined;
      let release!: (answer: Answer) => void;
      const held = new Promise<Answer>((resolve) => {
        release = resolve;
      });
      engine.answer = (request) => {
        if (request.method === 'DELETE' && engine.deletes.length === 1) {
          firstRequest = request;
          return held;
        }
        return engine.emulator(request);
      };
      const { unmount } = await openLoaded([NODE, { name: 'payments' }]);
      const wasOnline = onlineManager.isOnline();
      const browserOnline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      try {
        fireEvent.click(selectionAt(1, 'orders'));
        fireEvent.click(selectionAt(2, 'payments'));
        const original = await confirmDialog();
        expect(original.names).toEqual(['orders', 'payments']);
        expect(original.submit.getElement()).toBeDisabled();
        act(() => original.input.setInputValue('confirm'));
        act(() => original.submit.click());
        await waitFor(() => {
          expect(engine.deletes).toEqual(['orders']);
          expect(original.cancel.getElement()).toBeDisabled();
          expect(original.submit.getElement()).toHaveFocus();
        });

        browserOnline.mockReturnValue(false);
        fireEvent(window, new Event('offline'));
        browserOnline.mockReturnValue(true);
        fireEvent(window, new Event('online'));
        expect(engine.deletes).toEqual(['orders']);
        expect(flashTexts()).toEqual([]);
        const listsBeforeSettlement = engine.lists.length;
        if (!firstRequest) throw new Error('Expected the held first DeleteFunction');
        const answer = success
          ? engine.emulator(firstRequest)
          : errorAnswer(409, 'ResourceConflictException', 'Function is in use');
        await act(async () => release(answer));

        await waitFor(() => {
          expect(visibleDialog()).toBeUndefined();
          expect(flashTexts()).toEqual([reported, interruption]);
          expect(original.menuButton).toHaveFocus();
        });
        expect(engine.deletes).toEqual(['orders']);
        if (success) {
          await expectNames(['payments']);
          expect(engine.lists.length).toBeGreaterThan(listsBeforeSettlement);
        } else {
          await expectNames(['orders', 'payments']);
          fireEvent.click(selectionAt(1, 'orders'));
        }
        expect(selectionAt(success ? 1 : 2, 'payments')).toBeChecked();

        const fresh = await confirmDialog();
        expect(fresh.names).toEqual(['payments']);
        expect(fresh.input.getInputValue()).toBe('');
        expect(fresh.submit.getElement()).toBeDisabled();
        fireEvent.keyDown(fresh.input.findNativeInput().getElement(), { key: 'Enter' });
        expect(engine.deletes).toEqual(['orders']);
        expect(flashTexts()).toEqual([reported, interruption]);
        act(() => fresh.input.setInputValue('confirm'));
        expect(fresh.submit.getElement()).toBeEnabled();
        act(() => fresh.submit.click());
        await expectNames(success ? [] : ['orders']);
        await waitFor(() => {
          expect(visibleDialog()).toBeUndefined();
          expect(flashTexts()).toEqual(['1 function was deleted from the local emulator.']);
        });
        expect(engine.deletes).toEqual(['orders', 'payments']);
      } finally {
        unmount();
        browserOnline.mockRestore();
        onlineManager.setOnline(wasOnline);
      }
    },
  );

  it('a filter applied, then a delete: while the listing after the delete is awaited, the filter is disabled too', async () => {
    await openLoaded();
    applyFilter('o');
    await expectNames(['orders']);
    expect(filterInput()).not.toBeDisabled();

    select('orders');
    const dialog = await openDeleteDialog();
    let release: (answer: Answer) => void = () => undefined;
    engine.answer = (request) =>
      request.method === 'GET'
        ? new Promise<Answer>((resolve) => {
            release = resolve;
          })
        : engine.emulator(request);
    const sent = engine.lists.length;
    fireEvent.change(within(dialog).getByLabelText('To confirm deletion, type "confirm" in the field.'), {
      target: { value: 'confirm' },
    });
    fireEvent.click(
      within(dialog)
        .getAllByRole('button', { name: 'Delete' })
        .find((button) => norm(button.textContent) === 'Delete') as HTMLElement,
    );
    await waitFor(() => {
      expect(engine.lists.length).toBeGreaterThan(sent);
    });
    await waitFor(() => {
      expect(tableElement()).toHaveTextContent('Loading functions');
    });
    expect(filterInput()).toBeDisabled();
    expect(isDisabled(nextPage())).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Preferences' }))).toBe(true);

    release(engine.emulator({ method: 'GET', url: engine.lists.at(-1) as URL }));
    await waitFor(() => {
      expect(emptySlot()).toHaveTextContent('No matches');
    });
    expect(filterInput()).not.toBeDisabled();
  });
});

describe('failure states', () => {
  async function openFailing(answer: EngineAnswer) {
    engine.answer = () => answer;
    const opened = open();
    await waitFor(() => {
      expect(emptySlot()).not.toBeNull();
      expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    return opened;
  }

  /** The status indicator in the table's body: its Cloudscape type and its text. */
  function status(): { type: string | null; text: string } {
    const indicator = [...(emptySlot()?.querySelectorAll('[class*="status-"]') ?? [])].find((element) =>
      [...element.classList].some((name) => /^awsui_status-[a-z-]+_/.test(name)),
    );
    const type = [...(indicator?.classList ?? [])]
      .map((name) => /^awsui_status-([a-z-]+?)_/.exec(name)?.[1])
      .find((found) => found !== undefined);
    return { type: type ?? null, text: norm(indicator?.textContent ?? null) };
  }

  it('ListFunctions answers 501: "Not implemented by the emulator" with its sentence and "Retry", as information', async () => {
    await openFailing(errorAnswer(501, 'NotImplemented', 'ListFunctions is not implemented'));

    expect(status()).toEqual({ type: 'info', text: 'Not implemented by the emulator' });
    expect(slot()).toHaveTextContent(
      'The emulator answered 501 Not Implemented for ListFunctions, so Studio cannot show the function list.',
    );
  });

  it('AccessDenied with a message: "Access denied" with "ListFunctions was refused: " and that message, and "Retry"', async () => {
    await openFailing(errorAnswer(403, 'AccessDeniedException', 'not allowed to list functions'));

    expect(status()).toEqual({ type: 'error', text: 'Access denied' });
    expect(slot()).toHaveTextContent('ListFunctions was refused: not allowed to list functions');
  });

  it('the read fails while the connection is not started: the line’s status, the sentence, "Connection status" and "Retry"', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(errorAnswer(503, 'EmulatorUnavailable', 'the emulator refused the connection'));

    expect(status()).toEqual({ type: 'stopped', text: `Not started on port ${String(EMULATOR_PORT)}` });
    expect(slot()).toHaveTextContent('The function list could not be read.');
    expect(within(slot()).getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
  });

  it('EmulatorUnavailable while connected: "The emulator did not answer" with the engine’s message', async () => {
    await openFailing(errorAnswer(503, 'EmulatorUnavailable', 'the emulator at 127.0.0.1:9305 did not answer'));

    expect(status()).toEqual({ type: 'error', text: 'The emulator did not answer' });
    expect(slot()).toHaveTextContent('the emulator at 127.0.0.1:9305 did not answer');
  });

  it('no answer from the engine: "The EmuForge engine at <engine origin> did not answer"', async () => {
    await openFailing('network-error');

    expect(status()).toEqual({ type: 'error', text: `The EmuForge engine at ${engineOrigin} did not answer` });
  });

  it('another code: "The function list could not be read" with the code and message as text', async () => {
    await openFailing(errorAnswer(500, 'ServiceException', '<b id="injected">bold</b>'));

    expect(status()).toEqual({ type: 'error', text: 'The function list could not be read' });
    expect(slot()).toHaveTextContent('ServiceException: <b id="injected">bold</b>');
    expect(document.getElementById('injected')).toBeNull();
  });

  it('a failure state is announced once with its first line; "Retry" reads again', async () => {
    const said = recordAnnouncements();
    await openFailing(errorAnswer(500, 'ServiceException', 'broken'));

    await waitFor(() => {
      expect(said).toContain('The function list could not be read');
    });
    expect(said.filter((text) => text === 'The function list could not be read')).toHaveLength(1);

    const sent = engine.lists.length;
    engine.functions = [NODE];
    engine.answer = (request) => engine.emulator(request);
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await expectNames(['orders']);
    expect(engine.lists).toHaveLength(sent + 1);
  });
});
