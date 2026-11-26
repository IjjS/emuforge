import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import AwsArea from '../../../index';
import type { ServiceScreen } from '../../../screens';
import { createdRoleResult } from '../components/created-role';
import { IAM_NAVIGATION } from '../screens';

// The role list rendered inside the area's layout, as Studio's frame renders the area, against a fake engine behind
// the page's `fetch` (test-criteria.md, issue 82, "Unit — services/iam/pages/role-list-page.test.tsx"; requirement
// R3, R4, R6.1, R8 to R10; and issue 467's changed cases, requirement R3, R6).

// A screen of this file only, beside IAM's own: it hands the result of a created role to the role list, as the
// wizard does (R6.7).
const { HAND_OVER_PATH } = vi.hoisted(() => ({ HAND_OVER_PATH: '/aws/iam/test-hand-over' }));

vi.mock('../screens', async (importOriginal) => {
  const real = await importOriginal<typeof import('../screens')>();
  const handOver: ServiceScreen = {
    paths: [HAND_OVER_PATH],
    title: 'Hand over',
    crumbs: [{ text: 'Hand over' }],
    navigation: real.IAM_NAVIGATION,
    Page: HandOverPage,
  };
  return { ...real, SCREENS: [...real.SCREENS, handOver] };
});

function HandOverPage() {
  const flash = usePageFlash();
  return (
    <>
      <h1>Hand over</h1>
      <button
        type="button"
        onClick={() => {
          flash.handOver(
            '/aws/iam/roles',
            createdRoleResult(
              {
                name: 'made-here',
                attachFailures: [
                  {
                    policy: { name: 'ReadOnlyAccess', arn: 'arn:aws:iam::aws:policy/ReadOnlyAccess' },
                    failure: {
                      kind: 'other',
                      operation: 'AttachRolePolicy',
                      code: 'LimitExceeded',
                      message: 'too many',
                    },
                  },
                ],
              },
              engineOrigin,
            ),
          );
        }}
      >
        Hand over the created role
      </button>
      <button
        type="button"
        onClick={() => {
          flash.handOver('/aws/iam/roles', createdRoleResult({ name: 'made-here', attachFailures: [] }, engineOrigin));
        }}
      >
        Hand over without a failure
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The fake engine: IAM's Query protocol over the roles it holds.
// ---------------------------------------------------------------------------------------------------------------

interface FakeRole {
  name: string;
  path?: string;
  /** The trust policy as JSON; percent-encoded in the answer, as the emulator sends it. */
  trust?: string;
  /** `RoleLastUsed.LastUsedDate` of `GetRole`. */
  lastUsed?: string;
}

interface Answer {
  status: number;
  body: string;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

interface Sent {
  action: string;
  params: URLSearchParams;
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ok(action: string, result: string): Answer {
  return {
    status: 200,
    body: `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><${action}Result>${result}</${action}Result><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></${action}Response>`,
  };
}

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><Error><Type>Sender</Type><Code>${esc(code)}</Code><Message>${esc(message)}</Message></Error><RequestId>r</RequestId></ErrorResponse>`,
  };
}

/** A refusal of the engine's own (`EmulatorUnavailable`, `EmulatorTimeout`), in the shape the engine writes. */
function engineRefusal(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0"?><ErrorResponse><Error><Type>Receiver</Type><Code>${code}</Code><Message>${esc(message)}</Message></Error></ErrorResponse>`,
  };
}

const LAMBDA_TRUST = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
});

function serviceTrust(principal: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: principal }, Action: 'sts:AssumeRole' }],
  });
}

function roleXml({ name, path = '/', trust = LAMBDA_TRUST }: FakeRole): string {
  return `<Path>${esc(path)}</Path><RoleName>${esc(name)}</RoleName><RoleId>AROA${String(name.length)}</RoleId><Arn>arn:aws:iam::000000000000:role${esc(path)}${esc(name)}</Arn><CreateDate>2026-11-17T09:05:03Z</CreateDate><AssumeRolePolicyDocument>${esc(encodeURIComponent(trust))}</AssumeRolePolicyDocument><MaxSessionDuration>3600</MaxSessionDuration>`;
}

class FakeEngine {
  /** The roles the emulator holds, in its order. */
  roles: FakeRole[] = [];
  readonly sent: Sent[] = [];
  /** An answer of a case's own for an operation; the emulator's default otherwise. */
  handlers: Record<string, (params: URLSearchParams) => EngineAnswer> = {};
  private sessions = 0;

  /** The emulator's answer: `ListRoles` with `MaxItems` and a marker that is the index of the next role. */
  emulator(action: string, params: URLSearchParams): Answer {
    switch (action) {
      case 'ListRoles': {
        const size = Number(params.get('MaxItems') ?? '100');
        const from = Number(params.get('Marker') ?? '0');
        const page = this.roles.slice(from, from + size);
        const next = from + size < this.roles.length ? String(from + size) : undefined;
        return ok(
          action,
          `<Roles>${page.map((role) => `<member>${roleXml(role)}</member>`).join('')}</Roles>${
            next === undefined
              ? '<IsTruncated>false</IsTruncated>'
              : `<IsTruncated>true</IsTruncated><Marker>${next}</Marker>`
          }`,
        );
      }
      case 'GetRole': {
        const role = this.roles.find((held) => held.name === params.get('RoleName'));
        if (role === undefined) {
          return errorAnswer(404, 'NoSuchEntity', 'The role cannot be found.');
        }
        const used =
          role.lastUsed === undefined
            ? '<RoleLastUsed/>'
            : `<RoleLastUsed><LastUsedDate>${role.lastUsed}</LastUsedDate></RoleLastUsed>`;
        return ok(action, `<Role>${roleXml(role)}${used}</Role>`);
      }
      case 'DeleteRole':
      case 'DeleteServiceLinkedRole':
        this.roles = this.roles.filter((role) => role.name !== params.get('RoleName'));
        return ok(action, action === 'DeleteServiceLinkedRole' ? '<DeletionTaskId>task/1</DeletionTaskId>' : '');
      case 'ListInstanceProfilesForRole':
        return ok(action, '<InstanceProfiles/><IsTruncated>false</IsTruncated>');
      case 'ListAttachedRolePolicies':
        return ok(action, '<AttachedPolicies/><IsTruncated>false</IsTruncated>');
      case 'ListRolePolicies':
        return ok(action, '<PolicyNames/><IsTruncated>false</IsTruncated>');
      default:
        return ok(action, '');
    }
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      this.sessions += 1;
      return new Response(JSON.stringify({ token: `token-${String(this.sessions)}` }), { status: 200 });
    }
    const params = new URLSearchParams(await request.text());
    const action = params.get('Action') ?? '';
    this.sent.push({ action, params });
    const handler = this.handlers[action];
    const answer = await Promise.race([
      Promise.resolve(handler === undefined ? this.emulator(action, params) : handler(params)),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'text/xml' } });
  };

  of(action: string): Sent[] {
    return this.sent.filter((sent) => sent.action === action);
  }

  get lists(): Sent[] {
    return this.of('ListRoles');
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

const EMULATOR_PORT = 9313;
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

function notAnsweringResult(): CheckResult {
  return {
    kind: 'emulator-unreachable',
    checkedAt: Date.now(),
    emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT },
    reason: 'timeout',
    message: 'the emulator did not answer in time',
  };
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 8950;
let engine: FakeEngine;
let connection: Connection;
let engineOrigin: string;

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
      // The document title as Studio's frame makes it from the title the area reports (studio/AGENTS.md).
      onPageTitle={(title) => {
        document.title = `${title} | EmuForge Studio`;
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
  document.title = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open(path = '/aws/iam/roles') {
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

/** The page's `h1` as shown: "Roles (3)". */
function h1Text(): string {
  return (screen.getByRole('heading', { level: 1 }).textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The data rows' cells as text, by the column headings. */
function rows(): { name: string; trusted: string; last: string }[] {
  return (table().findRows() ?? []).map((row) => {
    const cells = [...row.getElement().querySelectorAll('td, th')].map((cell) =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    // The first cell holds the check box.
    return { name: cells[1] ?? '', trusted: cells[2] ?? '', last: cells[3] ?? '' };
  });
}

/** The `h1`'s description, or `null` when the `h1` has none. */
function h1Description(): string | null {
  const header = PAGE.findAllHeaders().find((found) => found.getElement().querySelector('h1') !== null);
  expect(header).toBeDefined();
  const description = header?.findDescription();
  return description === null || description === undefined ? null : (description.getElement().textContent ?? '');
}

/**
 * The kind of value (issue 467, R6) the area's element whose text is exactly `text` inside `scope` shows: `address`,
 * `name`, `fixed` or `text`; `undefined` when no such element holds it.
 */
function kindOf(scope: Element, text: string): string | undefined {
  const element = [...scope.querySelectorAll('.aws-area-value')].find((found) => found.textContent === text);
  return [...(element?.classList ?? [])]
    .map((name) => /^aws-area-value-(address|name|fixed|text)$/.exec(name)?.[1])
    .find((kind) => kind !== undefined);
}

function names(): string[] {
  return rows().map((row) => row.name);
}

async function expectNames(expected: string[]) {
  await waitFor(() => {
    expect(names()).toEqual(expected);
  });
}

/** The table's empty slot, which a case expects to be there. */
function slot(): HTMLElement {
  const found = table().findEmptySlot()?.getElement();
  expect(found).toBeDefined();
  return found as HTMLElement;
}

function action(name: string): HTMLElement {
  return within(tableElement()).getByRole('button', { name });
}

/** A Cloudscape button is disabled by `disabled`, or with a reason by `aria-disabled`. */
function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function filterInput(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Search items' });
}

/** The match count shown beside the filter. */
function resultsCount(): string | undefined {
  return table().findTextFilter()?.findResultsCount().getElement().textContent ?? undefined;
}

function typeFilter(text: string) {
  fireEvent.change(filterInput(), { target: { value: text } });
}

function pressEnter() {
  fireEvent.keyDown(filterInput(), { key: 'Enter', code: 'Enter' });
}

function checkbox(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name });
}

/** The text a polite live region says from now on, each addition once, in order. */
function recordAnnouncements(): string[] {
  const said: string[] = [];
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      const region = target?.closest('[aria-live="polite"], [role="status"]');
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

/** The preferences' dialog, as Cloudscape's test utilities find it. */
type PreferencesModal = NonNullable<
  ReturnType<NonNullable<ReturnType<ReturnType<typeof table>['findCollectionPreferences']>>['findModal']>
>;

function confirmPreferences(modal: PreferencesModal) {
  const button = modal.findConfirmButton();
  expect(button).not.toBeNull();
  button?.click();
}

function cancelPreferences(modal: PreferencesModal) {
  const button = modal.findCancelButton();
  expect(button).not.toBeNull();
  button?.click();
}

/** A role trusted by `lambda.amazonaws.com`, and a service-linked role (R4.2). */
const LAMBDA_ROLE: FakeRole = { name: 'lambda-runner' };
const LINKED_ROLE: FakeRole = {
  name: 'AWSServiceRoleForThing',
  path: '/aws-service-role/thing.amazonaws.com/',
  trust: serviceTrust('thing.amazonaws.com'),
};

function many(count: number, from: string): FakeRole[] {
  return Array.from({ length: count }, (_, index) => ({ name: `${from}-${String(index + 1).padStart(2, '0')}` }));
}

async function openLoaded(roles: FakeRole[] = [LAMBDA_ROLE, LINKED_ROLE], path?: string) {
  engine.roles = roles;
  const opened = open(path);
  await expectNames(roles.map((role) => role.name));
  return opened;
}

/** Holds every answer of `action` until the returned call lets them go. */
function holdAnswers(action: string): () => void {
  const waiting: (() => void)[] = [];
  let holding = true;
  engine.handlers[action] = (params) => {
    const answer = () => engine.emulator(action, params);
    if (!holding) {
      return answer();
    }
    return new Promise<Answer>((resolve) => {
      waiting.push(() => {
        resolve(answer());
      });
    });
  };
  return () => {
    holding = false;
    for (const release of waiting.splice(0)) {
      release();
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------

describe('the role list, loaded', () => {
  it('a lambda role and a service-linked role: "Roles (2)", the title, the columns, the rows of R4.2, the name a link and row header, the table "Roles"', async () => {
    await openLoaded();

    expect(h1Text()).toBe('Roles (2)');
    await waitFor(() => {
      expect(document.title).toBe('Roles | EmuForge Studio');
    });
    const headings = (table().findColumnHeaders() ?? []).map((header) => header.getElement().textContent);
    expect(headings.slice(1)).toEqual(['Role name', 'Trusted entities', 'Last activity']);
    expect(rows()).toEqual([
      { name: 'lambda-runner', trusted: 'AWS Service: lambda', last: '-' },
      {
        name: 'AWSServiceRoleForThing',
        trusted: 'AWS Service: thing (Service-linked role)',
        last: '-',
      },
    ]);
    for (const name of names()) {
      const link = within(tableElement()).getByRole('link', { name });
      expect(screen.getByRole('rowheader', { name })).toContainElement(link);
    }
    expect(screen.getByRole('table', { name: 'Roles' })).toBeInTheDocument();
  });

  it('a role used today, one used one day ago and one used five days ago: "Today", "1 day ago", "5 days ago"', async () => {
    const day = 24 * 60 * 60 * 1000;
    await openLoaded([
      { name: 'used-now', lastUsed: new Date(Date.now() - 60_000).toISOString() },
      { name: 'used-yesterday', lastUsed: new Date(Date.now() - day - 60_000).toISOString() },
      { name: 'used-before', lastUsed: new Date(Date.now() - 5 * day - 60_000).toISOString() },
    ]);

    expect(rows().map((row) => row.last)).toEqual(['Today', '1 day ago', '5 days ago']);
  });

  it('the actions in order, "Search items" with "Search", the pagination and "Preferences"', async () => {
    await openLoaded();

    const order = ['Refresh roles', 'Delete', 'Create role'].map((name) => action(name));
    order.reduce((before, button) => {
      expect(before.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      return button;
    });
    expect(filterInput()).toHaveAttribute('placeholder', 'Search');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preferences' })).toBeInTheDocument();
  });

  it('no sorting control, no "Service-Linked Role" button, no "Roles Anywhere", no "Info"', async () => {
    await openLoaded();

    for (const header of table().findColumnHeaders()) {
      expect(header.getElement()).not.toHaveAttribute('aria-sort');
      expect(within(header.getElement()).queryByRole('button')).toBeNull();
    }
    expect(table().findColumnSortingArea(2)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Service-Linked Role' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Roles Anywhere/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Info' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Info' })).toBeNull();
  });

  it('a role name, a principal and an error message with markup are shown as text, no element made from them', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    await openLoaded([{ name: markup, trust: serviceTrust(markup) }]);

    expect(rows()[0]).toMatchObject({ name: markup, trusted: `AWS Service: ${markup}` });
    expect(document.querySelector('img')).toBeNull();

    engine.handlers.ListRoles = () => errorAnswer(400, 'Odd', markup);
    fireEvent.click(action('Refresh roles'));
    await waitFor(() => {
      expect(slot()).toHaveTextContent(`Odd: ${markup}`);
    });
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('selection and the actions', () => {
  it('no row selected: "Delete" is disabled with "Select a role first"; the heading’s check box is "All items"', async () => {
    await openLoaded();

    const remove = action('Delete');
    expect(isDisabled(remove)).toBe(true);
    fireEvent.focus(remove);
    fireEvent.mouseEnter(remove);
    await waitFor(() => {
      expect(screen.getAllByText('Select a role first').length).toBeGreaterThan(0);
    });
    expect(checkbox('All items')).toBeInTheDocument();
  });

  it('a row selected by the check box named by its role: "Delete" is enabled; "All items" selects every row of the page', async () => {
    await openLoaded();

    fireEvent.click(checkbox('lambda-runner'));
    expect(isDisabled(action('Delete'))).toBe(false);
    fireEvent.click(checkbox('lambda-runner'));
    expect(isDisabled(action('Delete'))).toBe(true);

    fireEvent.click(checkbox('All items'));
    expect(checkbox('lambda-runner').checked).toBe(true);
    expect(checkbox('AWSServiceRoleForThing').checked).toBe(true);
    expect(isDisabled(action('Delete'))).toBe(false);
  });

  it('"Delete" with two rows selected: the dialog for the selected roles, in the page’s order', async () => {
    await openLoaded([{ name: 'first' }, { name: 'second' }, { name: 'third' }]);

    fireEvent.click(checkbox('third'));
    fireEvent.click(checkbox('first'));
    fireEvent.click(action('Delete'));

    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 roles?' });
    const dialogRows = [...within(dialog).getAllByRole('row')].slice(1).map((row) => row.textContent);
    expect(dialogRows).toEqual(['first-', 'third-']);
  });

  it('"Create role" and a role’s name lead to the paths of R8, without a request; a+b=c,d.e@f_g-h is one segment', async () => {
    const odd = 'a+b=c,d.e@f_g-h';
    const { router } = await openLoaded([{ name: odd }]);
    const sent = engine.sent.length;

    fireEvent.click(within(tableElement()).getByRole('link', { name: odd }));
    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe('/aws/iam/roles');
    });
    const segments = router.state.location.pathname.split('/');
    expect(segments.slice(0, 5)).toEqual(['', 'aws', 'iam', 'roles', 'details']);
    expect(segments).toHaveLength(6);
    expect(decodeURIComponent(segments[5] ?? '')).toBe(odd);
    expect(engine.sent.slice(sent).filter((request) => request.action === 'ListRoles')).toEqual([]);

    await act(() => router.navigate('/aws/iam/roles'));
    await expectNames([odd]);
    const again = engine.sent.length;
    fireEvent.click(action('Create role'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles/create');
    });
    expect(engine.sent.slice(again).filter((request) => request.action === 'ListRoles')).toEqual([]);
  });

  it('"Refresh roles": a new request, "Role list refreshed" announced, a selected role still there stays selected, one gone does not', async () => {
    await openLoaded([{ name: 'stays' }, { name: 'goes' }, { name: 'other' }]);
    fireEvent.click(checkbox('stays'));
    fireEvent.click(checkbox('goes'));
    const said = recordAnnouncements();
    const before = engine.lists.length;

    engine.roles = [{ name: 'stays' }, { name: 'other' }];
    fireEvent.click(action('Refresh roles'));

    await expectNames(['stays', 'other']);
    expect(engine.lists.length).toBe(before + 1);
    await waitFor(() => {
      expect(said).toContain('Role list refreshed');
    });
    expect(checkbox('stays').checked).toBe(true);
    expect(checkbox('other').checked).toBe(false);
  });
});

describe('the filter', () => {
  it('typed: no request before 300 ms, then a listing with it; Enter applies at once; emptied: a listing without it', async () => {
    await openLoaded(many(3, 'role'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const before = engine.lists.length;

    typeFilter('ab');
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(engine.lists.length).toBe(before);
    await act(() => vi.advanceTimersByTimeAsync(100));
    await waitFor(() => {
      expect(engine.lists.length).toBe(before + 1);
    });
    await waitFor(() => {
      expect(slot()).toHaveTextContent('No role name contains “ab”.');
    });

    const typed = engine.lists.length;
    typeFilter('cd');
    pressEnter();
    await waitFor(() => {
      expect(engine.lists.length).toBe(typed + 1);
    });
    await waitFor(() => {
      expect(slot()).toHaveTextContent('No role name contains “cd”.');
    });

    typeFilter('');
    await act(() => vi.advanceTimersByTimeAsync(350));
    await expectNames(['role-01', 'role-02', 'role-03']);
  });

  it('"2 matches", "1 match", and "20+ matches" while more remain', async () => {
    await openLoaded([{ name: 'ab-1' }, { name: 'xx' }, { name: 'AB-2' }]);

    typeFilter('ab');
    pressEnter();
    await expectNames(['ab-1', 'AB-2']);
    expect(resultsCount()).toBe('2 matches');

    typeFilter('ab-2');
    pressEnter();
    await expectNames(['AB-2']);
    expect(resultsCount()).toBe('1 match');

    engine.roles = many(25, 'ab');
    typeFilter('ab');
    pressEnter();
    await waitFor(() => {
      expect(names()).toHaveLength(20);
    });
    expect(resultsCount()).toBe('20+ matches');
  });

  it('an empty answer with "zz": "No matches", the sentence, "Clear filter" empties the field and lists again', async () => {
    await openLoaded([{ name: 'alpha' }]);

    typeFilter('zz');
    pressEnter();
    await waitFor(() => {
      expect(slot()).toHaveTextContent('No matches');
    });
    expect(slot()).toHaveTextContent('No role name contains “zz”.');

    fireEvent.click(within(slot()).getByRole('button', { name: 'Clear filter' }));
    expect(filterInput().value).toBe('');
    await expectNames(['alpha']);
  });
});

describe('the counter, the description, the notice and the layout', () => {
  it('one full page of 20 while more remain: "(20+)"', async () => {
    engine.roles = many(25, 'role');
    open();
    await waitFor(() => {
      expect(names()).toHaveLength(20);
    });

    expect(h1Text()).toBe('Roles (20+)');
  });

  it('connected, not started, and before the first answer: the description reads "Last activity is what the emulator reports for a role." with no endpoint (issue 467, R3)', async () => {
    const description = 'Last activity is what the emulator reports for a role.';
    connection.value = { result: undefined, engineOrigin };
    engine.roles = [LAMBDA_ROLE];
    open();
    expect(h1Description()).toBe(description);

    connection.set(connectedResult());
    await expectNames([LAMBDA_ROLE.name]);
    expect(h1Description()).toBe(description);

    connection.set(notStartedResult());
    expect(h1Description()).toBe(description);
  });

  it.each(['/aws/iam', '/aws/iam/roles'])(
    'at %s: the same screen, the path unchanged, the notice and (i), the side navigation and the crumbs',
    async (path) => {
      const { router } = await openLoaded(undefined, path);

      expect(router.state.location.pathname).toBe(path);
      expect(h1Text()).toBe('Roles (2)');
      expect(screen.getByText('These roles are in your local emulator')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'About the local emulator' })).toBeInTheDocument();
      const navigation = PAGE.findSideNavigation();
      expect(navigation).not.toBeNull();
      const side = (navigation as NonNullable<typeof navigation>).getElement();
      expect(within(side).getByRole('link', { name: 'Identity and Access Management (IAM)' })).toHaveAttribute(
        'href',
        '/aws/iam',
      );
      const roles = within(side).getByRole('link', { name: 'Roles' });
      expect(roles).toHaveAttribute('href', '/aws/iam/roles');
      expect(roles).toHaveAttribute('aria-current', 'page');
      const crumbs = PAGE.findBreadcrumbGroup();
      expect(crumbs).not.toBeNull();
      const crumbTexts = (crumbs as NonNullable<typeof crumbs>)
        .findBreadcrumbLinks()
        .map((crumb) => (crumb.getElement().textContent ?? '').trim());
      expect(crumbTexts).toEqual(['EmuForge', 'AWS', 'IAM', 'Roles']);
    },
  );

  it('the navigation is the one every IAM screen shares', () => {
    expect(IAM_NAVIGATION.header).toEqual({ text: 'Identity and Access Management (IAM)', href: '/aws/iam' });
  });
});

describe('loading and empty', () => {
  it('a request in flight, nothing loaded: "Loading roles", no counter, the filter, pagination and preferences disabled', async () => {
    const release = holdAnswers('ListRoles');
    engine.roles = [LAMBDA_ROLE];
    open();

    await waitFor(() => {
      expect(screen.getByText('Loading roles')).toBeInTheDocument();
    });
    expect(h1Text()).toBe('Roles');
    expect(filterInput()).toBeDisabled();
    expect(isDisabled(screen.getByRole('button', { name: 'Next page' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Preferences' }))).toBe(true);

    release();
    await expectNames(['lambda-runner']);
    expect(filterInput()).not.toBeDisabled();
  });

  it('the filter "ab" in flight: "Search items" enabled with ab; "10 roles" in flight: "Preferences" enabled', async () => {
    await openLoaded([{ name: 'ab-1' }]);

    let release = holdAnswers('ListRoles');
    typeFilter('ab');
    pressEnter();
    await waitFor(() => {
      expect(screen.getByText('Loading roles')).toBeInTheDocument();
    });
    expect(filterInput()).not.toBeDisabled();
    expect(filterInput().value).toBe('ab');
    expect(isDisabled(screen.getByRole('button', { name: 'Previous page' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Preferences' }))).toBe(true);
    release();
    await expectNames(['ab-1']);

    release = holdAnswers('ListRoles');
    const preferences = table().findCollectionPreferences();
    expect(preferences).not.toBeNull();
    const prefs = preferences as NonNullable<typeof preferences>;
    prefs.findTriggerButton().click();
    const modal = await waitFor(() => {
      const found = prefs.findModal();
      expect(found).not.toBeNull();
      return found as NonNullable<typeof found>;
    });
    fireEvent.click(within(modal.getElement()).getByRole('radio', { name: '10 roles' }));
    confirmPreferences(modal);
    await waitFor(() => {
      expect(screen.getByText('Loading roles')).toBeInTheDocument();
    });
    expect(isDisabled(screen.getByRole('button', { name: 'Preferences' }))).toBe(false);
    expect(filterInput()).toBeDisabled();
    expect(isDisabled(screen.getByRole('button', { name: 'Previous page' }))).toBe(true);
    release();
    await expectNames(['ab-1']);
  });

  it('the listing a finished delete starts: the filter, pagination and preferences disabled, though the filter started the one before', async () => {
    await openLoaded([{ name: 'ab-1' }, { name: 'ab-2' }]);
    typeFilter('ab');
    pressEnter();
    await expectNames(['ab-1', 'ab-2']);

    fireEvent.click(checkbox('ab-1'));
    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1 role?' });
    const release = holdAnswers('ListRoles');
    fireEvent.change(within(dialog).getByLabelText('To confirm, type delete'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.getByText('Loading roles')).toBeInTheDocument();
    });
    expect(filterInput()).toBeDisabled();
    expect(isDisabled(screen.getByRole('button', { name: 'Previous page' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Preferences' }))).toBe(true);
    release();
    await expectNames(['ab-2']);
  });

  it('an empty answer, no filter: "No roles", the sentence, "Create role" to the wizard; the counter "(0)"', async () => {
    const { router } = open();

    await waitFor(() => {
      expect(slot()).toHaveTextContent('No roles');
    });
    expect(slot()).toHaveTextContent(
      'This emulator holds no roles. It starts empty each time it restarts. Create one here, or with any tool pointed at the emulator.',
    );
    expect(h1Text()).toBe('Roles (0)');
    fireEvent.click(within(slot()).getByRole('button', { name: 'Create role' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles/create');
    });
  });
});

describe('failure states', () => {
  async function openFailing(answer: () => EngineAnswer, action = 'ListRoles') {
    engine.roles = [LAMBDA_ROLE];
    engine.handlers[action] = answer;
    open();
    await waitFor(() => {
      expect(slot().querySelector('button')).not.toBeNull();
    });
  }

  /** The status indicator in the table's body: its Cloudscape type and its text. */
  function status(): { type: string | undefined; text: string } {
    const indicator = [...slot().querySelectorAll('[class*="status-"]')].find((element) =>
      [...element.classList].some((name) => /^awsui_status-[a-z-]+_/.test(name)),
    );
    const type = [...(indicator?.classList ?? [])]
      .map((name) => /^awsui_status-([a-z-]+?)_/.exec(name)?.[1])
      .find((found) => found !== undefined);
    return { type, text: (indicator?.textContent ?? '').replace(/\s+/g, ' ').trim() };
  }

  it('HTTP 501: "Not implemented by the emulator", naming ListRoles and the role list, as info, "Retry"; the actions stay', async () => {
    await openFailing(() => errorAnswer(501, 'NotImplemented', 'no'));

    expect(status()).toEqual({ type: 'info', text: 'Not implemented by the emulator' });
    expect(slot()).toHaveTextContent(
      'The emulator answered 501 Not Implemented for ListRoles, so Studio cannot show the role list.',
    );
    expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    for (const name of ['Refresh roles', 'Delete', 'Create role']) {
      expect(action(name)).toBeInTheDocument();
    }
  });

  it('AccessDenied: "Access denied" with "ListRoles was refused: " and the message', async () => {
    await openFailing(() => errorAnswer(403, 'AccessDenied', 'not for you'));

    expect(status().text).toBe('Access denied');
    expect(slot()).toHaveTextContent('ListRoles was refused: not for you');
  });

  it('GetRole of one name refused with AccessDenied: "GetRole was refused: " and the message, and no row', async () => {
    await openFailing(() => errorAnswer(403, 'AccessDenied', 'no reading'), 'GetRole');

    expect(status().text).toBe('Access denied');
    expect(slot()).toHaveTextContent('GetRole was refused: no reading');
    expect(names()).toEqual([]);
  });

  it('the read fails and the connection is not started: the line’s status as stopped, the sentence, "Connection status" to /, "Retry"', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(() => 'network-error');

    expect(status()).toEqual({ type: 'stopped', text: `Not started on port ${String(EMULATOR_PORT)}` });
    expect(slot()).toHaveTextContent('The role list could not be read.');
    expect(within(slot()).getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
    expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it.each<[string, () => CheckResult, string]>([
    ['not answering', notAnsweringResult, `Not answering at ${EMULATOR_ENDPOINT}`],
    [
      'engine not answering',
      () => ({ kind: 'engine-unreachable', checkedAt: Date.now(), lastEmulatorPort: EMULATOR_PORT }),
      'The EmuForge engine at {origin} is not answering',
    ],
    [
      'engine error',
      () => ({ kind: 'engine-error', checkedAt: Date.now(), status: 500, code: 'Broken', message: 'broken' }),
      'The EmuForge engine answered with an error: Broken',
    ],
  ])('the read fails and the connection is %s: the line’s words and the same three parts', async (_, result, words) => {
    connection.value = { result: result(), engineOrigin };
    await openFailing(() => 'network-error');

    expect(status()).toEqual({ type: 'error', text: words.replace('{origin}', engineOrigin) });
    expect(slot()).toHaveTextContent('The role list could not be read.');
    expect(within(slot()).getByRole('link', { name: 'Connection status' })).toBeInTheDocument();
    expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('501 while the connection is not connected: the "not implemented" state, not the "not connected" one', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(() => errorAnswer(501, 'NotImplemented', 'no'));

    expect(status()).toEqual({ type: 'info', text: 'Not implemented by the emulator' });
    expect(within(slot()).queryByRole('link', { name: 'Connection status' })).toBeNull();
  });

  it.each([
    [503, 'EmulatorUnavailable', 'The emulator at https://127.0.0.1:9313 could not be reached'],
    [504, 'EmulatorTimeout', 'The emulator at https://127.0.0.1:9313 did not answer within 30 seconds'],
  ])('%i %s while connected: "The emulator did not answer" with the engine’s message', async (code, name, message) => {
    await openFailing(() => engineRefusal(code, name, message));

    expect(status().text).toBe('The emulator did not answer');
    expect(slot()).toHaveTextContent(message);
  });

  it('no answer from the engine while connected: "The EmuForge engine at <engine origin> did not answer"', async () => {
    await openFailing(() => 'network-error');

    expect(status().text).toBe(`The EmuForge engine at ${engineOrigin} did not answer`);
  });

  it('any other error while connected: "The role list could not be read" with "<code>: <message>"', async () => {
    await openFailing(() => errorAnswer(400, 'ServiceFailure', 'it broke'));

    expect(status().text).toBe('The role list could not be read');
    expect(slot()).toHaveTextContent('ServiceFailure: it broke');
  });

  it('each failure state: its first line announced once; "Retry" asks for page 1 and shows the rows', async () => {
    const said = recordAnnouncements();
    await openFailing(() => errorAnswer(403, 'AccessDenied', 'no'));
    await waitFor(() => {
      expect(said.filter((text) => text === 'Access denied')).toHaveLength(1);
    });

    delete engine.handlers.ListRoles;
    const before = engine.lists.length;
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await expectNames(['lambda-runner']);
    const retried = engine.lists[before];
    expect(retried?.params.has('Marker')).toBe(false);
    expect(said.filter((text) => text === 'Access denied')).toHaveLength(1);
  });

  it('a failed read, then the connection becomes connected: a new request without any action, and its rows', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(() => 'network-error');
    const before = engine.lists.length;

    delete engine.handlers.ListRoles;
    connection.set(connectedResult());

    await expectNames(['lambda-runner']);
    expect(engine.lists.length).toBe(before + 1);
  });

  it('the next page fails: the failure state; "Retry" shows page 1', async () => {
    engine.roles = many(25, 'role');
    open();
    await waitFor(() => {
      expect(names()).toHaveLength(20);
    });
    engine.handlers.ListRoles = (params) =>
      params.has('Marker') ? errorAnswer(400, 'ServiceFailure', 'page two') : engine.emulator('ListRoles', params);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(slot()).toHaveTextContent('ServiceFailure: page two');
    });

    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(names()).toHaveLength(20);
    });
    expect(names()[0]).toBe('role-01');
  });
});

describe('preferences and wrapping', () => {
  async function preferencesModal() {
    const preferences = table().findCollectionPreferences();
    expect(preferences).not.toBeNull();
    const prefs = preferences as NonNullable<typeof preferences>;
    prefs.findTriggerButton().click();
    return waitFor(() => {
      const found = prefs.findModal();
      expect(found).not.toBeNull();
      return found as NonNullable<typeof found>;
    });
  }

  it('"Preferences": its texts; "10 roles" confirmed lists again with 10; cancel changes nothing', async () => {
    await openLoaded(many(12, 'role'));

    let modal = await preferencesModal();
    const dialog = modal.getElement();
    expect(within(dialog).getByText('Page size')).toBeInTheDocument();
    for (const size of ['10 roles', '20 roles', '50 roles']) {
      expect(within(dialog).getByRole('radio', { name: size })).toBeInTheDocument();
    }
    expect(within(dialog).getByText('Wrap lines')).toBeInTheDocument();
    expect(within(dialog).getByText('Show all of a long name')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: '10 roles' }));
    confirmPreferences(modal);
    await waitFor(() => {
      expect(names()).toHaveLength(10);
    });
    expect(engine.lists.at(-1)?.params.get('MaxItems')).toBe('10');

    const before = engine.lists.length;
    modal = await preferencesModal();
    fireEvent.click(within(modal.getElement()).getByRole('radio', { name: '50 roles' }));
    cancelPreferences(modal);
    await waitFor(() => {
      expect(table().findCollectionPreferences()?.findModal()).toBeNull();
    });
    expect(engine.lists.length).toBe(before);
    expect(names()).toHaveLength(10);
  });

  it('"Preferences" opened, "50 roles" chosen with the arrow keys, then a new connection answer: the same dialog, "50 roles" has focus and is chosen (issue 462)', async () => {
    const user = userEvent.setup();
    await openLoaded(many(12, 'role'));
    const modal = await preferencesModal();
    const dialog = modal.getElement();
    const twenty = within(dialog).getByRole('radio', { name: '20 roles' });
    expect(twenty).toBeChecked();
    act(() => {
      twenty.focus();
    });

    await user.keyboard('{ArrowDown}');
    const fifty = within(dialog).getByRole('radio', { name: '50 roles' });
    expect(fifty).toBeChecked();
    expect(document.activeElement).toBe(fifty);

    // What the area's page sees every 5 seconds: a new answer of the same state.
    connection.set(connectedResult());
    await act(() => Promise.resolve());

    expect(dialog.isConnected).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBe(dialog);
    expect(fifty.isConnected).toBe(true);
    expect(document.activeElement).toBe(fifty);
    expect(fifty).toBeChecked();
  });

  it('a 64-character name, "Wrap lines" on as at the start: the link holds all 64 characters', async () => {
    const long = 'r'.repeat(64);
    await openLoaded([{ name: long }]);

    expect(within(tableElement()).getByRole('link', { name: long }).textContent).toBe(long);
    expect(tableElement().querySelector('[class*="body-cell-wrap"]')).not.toBeNull();
  });

  it('a row’s cells: "Role name" as a name, "Trusted entities" as free text, "Last activity" as a fixed word; no service class (issue 467, R6)', async () => {
    const long = 'r' + 'x'.repeat(63);
    const arn = `arn:aws:iam::000000000000:role/${long}`;
    const trust = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { AWS: arn }, Action: 'sts:AssumeRole' }],
    });
    await openLoaded([{ name: long, trust, lastUsed: '2026-11-17T10:00:00Z' }]);

    const row = table().findRows()[0]?.getElement() as HTMLElement;
    const link = within(row).getByRole('link', { name: long });
    expect(kindOf(link, long)).toBe('name');
    expect(kindOf(row, `AWS: ${arn}`)).toBe('text');
    const last = rows()[0]?.last ?? '';
    expect(last).not.toBe('');
    expect(kindOf(row, last)).toBe('fixed');
    expect(document.querySelector('.aws-iam-value')).toBeNull();
  });

  it('with "Wrap lines" off: each cell is the same kind as before (issue 467, R6)', async () => {
    await openLoaded([LAMBDA_ROLE]);
    const modal = await preferencesModal();
    const wrap = modal.findWrapLinesPreference()?.findNativeInput().getElement() as HTMLInputElement;
    fireEvent.click(wrap);
    confirmPreferences(modal);
    await waitFor(() => {
      expect(tableElement().querySelector('[class*="body-cell-wrap"]')).toBeNull();
    });

    const row = table().findRows()[0]?.getElement() as HTMLElement;
    expect(kindOf(row, LAMBDA_ROLE.name)).toBe('name');
    expect(kindOf(row, rows()[0]?.trusted ?? '')).toBe('text');
  });

  it('unmounted after "10 roles", mounted again: 20 roles asked for', async () => {
    const first = await openLoaded(many(12, 'role'));
    const modal = await preferencesModal();
    fireEvent.click(within(modal.getElement()).getByRole('radio', { name: '10 roles' }));
    confirmPreferences(modal);
    await waitFor(() => {
      expect(names()).toHaveLength(10);
    });
    first.unmount();

    open();
    await waitFor(() => {
      expect(names()).toHaveLength(12);
    });
    expect(engine.lists.at(-1)?.params.get('MaxItems')).toBe('20');
  });
});

describe('a created role handed over by the wizard', () => {
  it('"Role “<name>” was created in the local emulator." as a success, dismissible, announced; a failed policy as an error item', async () => {
    const said = recordAnnouncements();
    open(HAND_OVER_PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Hand over the created role' }));

    const flashbar = await waitFor(() => {
      const found = PAGE.findFlashbar();
      expect(found?.findItems()).toHaveLength(2);
      return found as NonNullable<typeof found>;
    });
    expect(h1Text()).toMatch(/^Roles/);
    const [success, failure] = flashbar.findItems();
    expect(success?.getElement()).toHaveTextContent('Role “made-here” was created in the local emulator.');
    expect(kindOf(success?.getElement() as HTMLElement, 'made-here'), 'the name as a name (issue 467, R6)').toBe(
      'name',
    );
    expect(kindOf(success?.getElement() as HTMLElement, '” was created in the local emulator.')).toBe('text');
    expect(success?.findContent()?.getElement().closest('[data-itemid]')).not.toBeNull();
    expect(failure?.getElement()).toHaveTextContent('Attaching ReadOnlyAccess to made-here failed');
    expect(failure?.getElement()).toHaveTextContent('LimitExceeded: too many');
    expect(flashbar.findItemsByType('success')).toHaveLength(1);
    expect(flashbar.findItemsByType('error')).toHaveLength(1);
    await waitFor(() => {
      expect(said.some((text) => text.includes('Role “made-here” was created in the local emulator.'))).toBe(true);
    });

    fireEvent.click(within(success?.getElement() as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(PAGE.findFlashbar()?.findItems()).toHaveLength(1);
    });
  });

  it('a created role without a failed policy: the one success item', async () => {
    open(HAND_OVER_PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Hand over without a failure' }));

    await waitFor(() => {
      expect(PAGE.findFlashbar()?.findItemsByType('success')).toHaveLength(1);
    });
    expect(PAGE.findFlashbar()?.findItems()).toHaveLength(1);
  });
});
