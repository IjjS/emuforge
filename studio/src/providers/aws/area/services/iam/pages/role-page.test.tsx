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

// A role's page rendered inside the area's layout at `/aws/iam/roles/details/<name>`, as Studio's frame renders the
// area, against a fake engine behind the page's `fetch` (test-criteria.md, issue 82, "Unit —
// services/iam/pages/role-page.test.tsx"; requirement R5.1 to R5.4, R6.1, R8, R10; and issue 467's changed cases,
// requirement R3, R5, R6).

// ---------------------------------------------------------------------------------------------------------------
// The fake engine: IAM's Query protocol over the roles it holds.
// ---------------------------------------------------------------------------------------------------------------

interface FakeRole {
  name: string;
  path?: string;
  /** The trust policy as JSON; percent-encoded in the answer, as the emulator sends it. */
  trust?: string;
  description?: string;
  maxSessionDuration?: number;
  lastUsed?: string;
  boundary?: string;
  /** Attached managed policies, in the emulator's order. */
  attached?: { name: string; arn: string }[];
  /** Inline policy names, in the emulator's order. */
  inline?: string[];
  attachedTruncated?: boolean;
  inlineTruncated?: boolean;
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

const CREATED = '2026-11-17T09:05:03Z';

function arnOf({ name, path = '/' }: FakeRole): string {
  return `arn:aws:iam::000000000000:role${path}${name}`;
}

function roleXml(role: FakeRole): string {
  const { name, path = '/', trust = LAMBDA_TRUST, description, maxSessionDuration = 3600 } = role;
  return [
    `<Path>${esc(path)}</Path><RoleName>${esc(name)}</RoleName><RoleId>AROA${String(name.length)}</RoleId>`,
    `<Arn>${esc(arnOf(role))}</Arn><CreateDate>${CREATED}</CreateDate>`,
    `<AssumeRolePolicyDocument>${esc(encodeURIComponent(trust))}</AssumeRolePolicyDocument>`,
    description === undefined ? '' : `<Description>${esc(description)}</Description>`,
    `<MaxSessionDuration>${String(maxSessionDuration)}</MaxSessionDuration>`,
  ].join('');
}

class FakeEngine {
  /** The roles the emulator holds. */
  roles: FakeRole[] = [];
  readonly sent: Sent[] = [];
  /** An answer of a case's own for an operation; the emulator's default otherwise. */
  handlers: Record<string, (params: URLSearchParams) => EngineAnswer> = {};
  private sessions = 0;

  /** The role named so, ignoring case, as the emulator matches names (R2). */
  find(name: string | null): FakeRole | undefined {
    return this.roles.find((role) => role.name.toLowerCase() === (name ?? '').toLowerCase());
  }

  emulator(action: string, params: URLSearchParams): Answer {
    const role = this.find(params.get('RoleName'));
    if (role === undefined && action !== 'ListRoles') {
      return errorAnswer(404, 'NoSuchEntity', `The role with name ${params.get('RoleName') ?? ''} cannot be found.`);
    }
    switch (action) {
      case 'GetRole': {
        const held = role as FakeRole;
        const boundary =
          held.boundary === undefined
            ? ''
            : `<PermissionsBoundary><PermissionsBoundaryType>Policy</PermissionsBoundaryType><PermissionsBoundaryArn>${esc(held.boundary)}</PermissionsBoundaryArn></PermissionsBoundary>`;
        const used =
          held.lastUsed === undefined
            ? '<RoleLastUsed/>'
            : `<RoleLastUsed><LastUsedDate>${held.lastUsed}</LastUsedDate></RoleLastUsed>`;
        return ok(action, `<Role>${roleXml(held)}${boundary}${used}</Role>`);
      }
      case 'ListAttachedRolePolicies': {
        const held = role as FakeRole;
        const members = (held.attached ?? [])
          .map(
            ({ name, arn }) =>
              `<member><PolicyName>${esc(name)}</PolicyName><PolicyArn>${esc(arn)}</PolicyArn></member>`,
          )
          .join('');
        return ok(
          action,
          `<AttachedPolicies>${members}</AttachedPolicies><IsTruncated>${String(held.attachedTruncated === true)}</IsTruncated>${held.attachedTruncated === true ? '<Marker>m</Marker>' : ''}`,
        );
      }
      case 'ListRolePolicies': {
        const held = role as FakeRole;
        const members = (held.inline ?? []).map((name) => `<member>${esc(name)}</member>`).join('');
        return ok(
          action,
          `<PolicyNames>${members}</PolicyNames><IsTruncated>${String(held.inlineTruncated === true)}</IsTruncated>${held.inlineTruncated === true ? '<Marker>m</Marker>' : ''}`,
        );
      }
      case 'UpdateRole': {
        const held = role as FakeRole;
        const description = params.get('Description');
        if (description !== null) {
          held.description = description;
        }
        const duration = params.get('MaxSessionDuration');
        if (duration !== null) {
          held.maxSessionDuration = Number(duration);
        }
        return ok(action, '');
      }
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

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9150;
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
  vi.unstubAllGlobals();
});

function pagePath(name: string): string {
  return `/aws/iam/roles/details/${encodeURIComponent(name)}`;
}

function open(path: string) {
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

function h1(): HTMLElement {
  return screen.getByRole('heading', { level: 1 });
}

function main(): HTMLElement {
  return screen.getByRole('main');
}

/** The tabs' labels in order, and which is selected. */
function tabs(): { label: string; selected: boolean; disabled: boolean }[] {
  return within(main())
    .queryAllByRole('tab')
    .map((tab) => ({
      label: (tab.textContent ?? '').trim(),
      selected: tab.getAttribute('aria-selected') === 'true',
      disabled: tab.getAttribute('aria-disabled') === 'true' || (tab as HTMLButtonElement).disabled === true,
    }));
}

function tab(label: string): HTMLElement {
  return within(main()).getByRole('tab', { name: label });
}

function crumbs(): { text: string; href: string | null }[] {
  const group = PAGE.findBreadcrumbGroup();
  expect(group).not.toBeNull();
  return (group as NonNullable<typeof group>).findBreadcrumbLinks().map((crumb) => {
    const element = crumb.getElement();
    const link = element.closest('a') ?? element.querySelector('a');
    return { text: (element.textContent ?? '').trim(), href: link?.getAttribute('href') ?? null };
  });
}

/** The section headings of the page's content: "Summary", "Permissions policies", "Permissions boundary". */
function sectionHeadings(): string[] {
  const sections = ['Summary', 'Permissions policies', 'Permissions boundary'];
  return within(main())
    .queryAllByRole('heading', { level: 2 })
    .map((heading) => (heading.textContent ?? '').trim())
    .filter((text) => sections.includes(text));
}

/** The failure state of the page's read: the nearest box around "Retry" that holds a status indicator. */
function failureBox(): HTMLElement {
  let at: HTMLElement | null = within(main()).getByRole('button', { name: 'Retry' });
  while (at !== null && at.querySelector('[class*="awsui_status-"]') === null) {
    at = at.parentElement;
  }
  expect(at).not.toBeNull();
  return at as HTMLElement;
}

/** The pairs of "Summary": label and value, in order. */
function summaryPairs(): [string, string][] {
  const pairs = PAGE.findKeyValuePairs();
  expect(pairs).not.toBeNull();
  return (pairs as NonNullable<typeof pairs>)
    .findItems()
    .map((item) => [
      (item.findLabel()?.getElement().textContent ?? '').trim(),
      (item.findValue()?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim(),
    ]);
}

function policiesTable() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

function policyRows(): string[][] {
  return policiesTable()
    .findRows()
    .map((row) =>
      [...row.getElement().querySelectorAll('td, th')].map((cell) =>
        (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
    );
}

function policiesSlot(): HTMLElement {
  const found = policiesTable().findEmptySlot()?.getElement();
  expect(found).toBeDefined();
  return found as HTMLElement;
}

/** The `h1`'s description, or `null` when the `h1` has none (issue 467, R3). */
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

/** The value element of the pair labelled `label` of "Summary". */
function pairValue(label: string): HTMLElement {
  const item = PAGE.findKeyValuePairs()
    ?.findItems()
    .find((found) => (found.findLabel()?.getElement().textContent ?? '').trim() === label);
  const value = item?.findValue()?.getElement();
  expect(value, label).toBeDefined();
  return value as HTMLElement;
}

/** The status indicator inside `scope`: its Cloudscape type and its text. */
function status(scope: HTMLElement): { type: string | undefined; text: string } {
  const indicator = [...scope.querySelectorAll('[class*="status-"]')].find((element) =>
    [...element.classList].some((name) => /^awsui_status-[a-z-]+_/.test(name)),
  );
  const type = [...(indicator?.classList ?? [])]
    .map((name) => /^awsui_status-([a-z-]+?)_/.exec(name)?.[1])
    .find((found) => found !== undefined);
  return { type, text: (indicator?.textContent ?? '').replace(/\s+/g, ' ').trim() };
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

const PLAIN: FakeRole = { name: 'plain-role' };

async function openLoaded(role: FakeRole = PLAIN, path = pagePath(role.name)) {
  engine.roles = [role];
  const opened = open(path);
  await waitFor(() => {
    expect(within(main()).getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
  });
  return opened;
}

const READ_ONLY = { name: 'ReadOnlyAccess', arn: 'arn:aws:iam::aws:policy/ReadOnlyAccess' };
const OWN = { name: 'team-policy', arn: 'arn:aws:iam::000000000000:policy/team-policy' };

// ---------------------------------------------------------------------------------------------------------------

describe('a loaded role', () => {
  it('the h1 is the name as the answer gives it, whatever the address’s case; "Refresh role"; the tabs; the crumbs; the notice and navigation; the title', async () => {
    await openLoaded({ name: 'Team-Role' }, pagePath('team-role'));

    expect(h1()).toHaveTextContent('Team-Role');
    expect(within(main()).getByRole('button', { name: 'Refresh role' })).toBeInTheDocument();
    expect(tabs()).toEqual([
      { label: 'Permissions', selected: true, disabled: false },
      { label: 'Trust relationships', selected: false, disabled: false },
      { label: 'Tags', selected: false, disabled: false },
      { label: 'Last Accessed', selected: false, disabled: false },
      { label: 'Revoke sessions', selected: false, disabled: false },
    ]);
    const shown = crumbs();
    expect(shown.map((crumb) => crumb.text)).toEqual(['EmuForge', 'AWS', 'IAM', 'Roles', 'team-role']);
    expect(shown[3]?.href).toBe('/aws/iam/roles');
    expect(shown[4]?.href).toBeNull();
    expect(screen.getByText('These roles are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About the local emulator' })).toBeInTheDocument();
    const navigation = PAGE.findSideNavigation();
    expect(navigation).not.toBeNull();
    const side = (navigation as NonNullable<typeof navigation>).getElement();
    expect(within(side).getByRole('link', { name: 'Identity and Access Management (IAM)' })).toHaveAttribute(
      'href',
      '/aws/iam',
    );
    expect(within(side).getByRole('link', { name: 'Roles' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => {
      expect(document.title).toBe('team-role | EmuForge Studio');
    });
  });

  it('a role with a description, 7200 seconds and the path /team/: "Summary" with its six pairs in order and "Edit" in its header', async () => {
    const role: FakeRole = {
      name: 'team-role',
      path: '/team/',
      description: 'Runs the team’s jobs',
      maxSessionDuration: 7200,
    };
    await openLoaded(role);

    expect(summaryPairs()).toEqual([
      ['Creation date', '2026-11-17 09:05:03 UTC'],
      ['ARN', 'arn:aws:iam::000000000000:role/team/team-role'],
      ['Last activity', '-'],
      ['Maximum session duration', '2 hours'],
      ['Description', 'Runs the team’s jobs'],
      ['Path', '/team/'],
    ]);
    const summary = within(main()).getByRole('heading', { level: 2, name: 'Summary' });
    const edit = within(main()).getByRole('button', { name: 'Edit' });
    expect(summary.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('a role without a description and without a last use: "-" for each', async () => {
    await openLoaded(PLAIN);

    const pairs = new Map(summaryPairs());
    expect(pairs.get('Description')).toBe('-');
    expect(pairs.get('Last activity')).toBe('-');
  });

  it('a service-linked role: "Service-linked role" as an info status under the pairs; another role: no such line', async () => {
    await openLoaded({ name: 'AWSServiceRoleForThing', path: '/aws-service-role/thing.amazonaws.com/' });

    const pairs = PAGE.findKeyValuePairs()?.getElement() as HTMLElement;
    const line = within(main()).getByText('Service-linked role');
    expect(pairs.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(status(line.closest('[class*="awsui_root_"]')?.parentElement as HTMLElement)).toEqual({
      type: 'info',
      text: 'Service-linked role',
    });
  });

  it('a role not service-linked: no "Service-linked role" line', async () => {
    await openLoaded(PLAIN);

    expect(within(main()).queryByText('Service-linked role')).toBeNull();
  });

  it('two attached policies and one inline: the table "Permissions policies", attached then inline, their types; no link and no check box', async () => {
    await openLoaded({ name: 'team-role', attached: [READ_ONLY, OWN], inline: ['inline-one'] });

    expect(within(main()).getByRole('heading', { level: 2, name: 'Permissions policies' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Permissions policies' })).toBeInTheDocument();
    const headings = policiesTable()
      .findColumnHeaders()
      .map((header) => (header.getElement().textContent ?? '').trim());
    expect(headings).toEqual(['Policy name', 'Type']);
    expect(policyRows()).toEqual([
      ['ReadOnlyAccess', 'AWS managed'],
      ['team-policy', 'Customer managed'],
      ['inline-one', 'Customer inline'],
    ]);
    const table = policiesTable().getElement();
    expect(within(table).queryAllByRole('link')).toEqual([]);
    expect(within(table).queryAllByRole('checkbox')).toEqual([]);
    expect(within(table).queryAllByRole('radio')).toEqual([]);
  });

  it('a role without a policy: "No policies" and "This role has no permissions policy in the emulator."', async () => {
    await openLoaded(PLAIN);

    expect(policiesSlot()).toHaveTextContent('No policies');
    expect(policiesSlot()).toHaveTextContent('This role has no permissions policy in the emulator.');
    expect(within(main()).queryByText('More policies exist than are shown.')).toBeNull();
  });

  it.each<[string, Partial<FakeRole>]>([
    ['attached', { attachedTruncated: true }],
    ['inline', { inlineTruncated: true }],
  ])('the %s list came back truncated: "More policies exist than are shown." under the table', async (_, flags) => {
    await openLoaded({ name: 'team-role', attached: [READ_ONLY], inline: ['inline-one'], ...flags });

    const line = within(main()).getByText('More policies exist than are shown.');
    expect(policiesTable().getElement().compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('a permissions boundary: its ARN as text in "Permissions boundary"; without one: "Not set"', async () => {
    const boundary = 'arn:aws:iam::aws:policy/PowerUserAccess';
    await openLoaded({ name: 'bounded', boundary });

    const heading = within(main()).getByRole('heading', { level: 2, name: 'Permissions boundary' });
    expect(heading).toBeInTheDocument();
    const value = [...main().querySelectorAll('.aws-area-value')].find((found) => found.textContent === boundary);
    expect(value, 'the boundary’s ARN, shown as an address').toBeDefined();
    expect(kindOf(main(), boundary)).toBe('address');
    expect(heading.compareDocumentPosition(value as Element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('no permissions boundary: "Not set"', async () => {
    await openLoaded(PLAIN);

    const heading = within(main()).getByRole('heading', { level: 2, name: 'Permissions boundary' });
    const value = within(main()).getByText('Not set');
    expect(heading.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('no "Add permissions", "Remove" or "Change boundary" control', async () => {
    await openLoaded({ name: 'team-role', attached: [READ_ONLY], boundary: OWN.arn });

    for (const name of ['Add permissions', 'Remove', 'Change boundary', 'Attach policies', 'Create inline policy']) {
      expect(within(main()).queryByRole('button', { name })).toBeNull();
      expect(within(main()).queryByRole('link', { name })).toBeNull();
    }
  });

  it('a loaded role: the h1 has no description (issue 467, R3)', async () => {
    await openLoaded(PLAIN);

    expect(h1Description()).toBeNull();
  });

  it('"Summary": "Copy ARN" directly before the ARN, shown as an address; "Path" as an address; "Description" as free text; the dates and the duration as fixed words (issue 467, R5, R6)', async () => {
    const role: FakeRole = {
      name: 'team-role',
      path: '/team/',
      description: 'Runs the team’s jobs',
      maxSessionDuration: 7200,
      lastUsed: '2026-11-17T10:00:00Z',
    };
    await openLoaded(role);

    const arnValue = pairValue('ARN');
    const copy = within(arnValue).getByRole('button', { name: 'Copy ARN' });
    const arn = arnOf(role);
    expect(kindOf(arnValue, arn)).toBe('address');
    const arnText = [...arnValue.querySelectorAll('.aws-area-value')].find((found) => found.textContent === arn);
    expect(copy.compareDocumentPosition(arnText as Element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(within(main()).getAllByRole('button', { name: /^Copy / })).toEqual([copy]);

    expect(kindOf(pairValue('Path'), '/team/')).toBe('address');
    expect(kindOf(pairValue('Description'), 'Runs the team’s jobs')).toBe('text');
    expect(kindOf(pairValue('Creation date'), '2026-11-17 09:05:03 UTC')).toBe('fixed');
    expect(kindOf(pairValue('Maximum session duration'), '2 hours')).toBe('fixed');
    const lastActivity = pairValue('Last activity');
    expect(kindOf(lastActivity, (lastActivity.textContent ?? '').trim())).toBe('fixed');
  });

  it('the table under the tab: a policy’s name as a name, its type as a fixed word (issue 467, R6)', async () => {
    await openLoaded({ name: 'team-role', attached: [READ_ONLY], inline: ['inline-one'] });

    const table = policiesTable().getElement();
    expect(kindOf(table, 'ReadOnlyAccess')).toBe('name');
    expect(kindOf(table, 'inline-one')).toBe('name');
    expect(kindOf(table, 'AWS managed')).toBe('fixed');
    expect(kindOf(table, 'Customer inline')).toBe('fixed');
  });

  it('an ARN, a description, a path and a policy name with markup are shown as text, no element made from them', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    await openLoaded({
      name: 'odd-role',
      path: `/${markup}/`,
      description: markup,
      attached: [{ name: markup, arn: `arn:aws:iam::000000000000:policy/${markup}` }],
      inline: [markup],
    });

    const pairs = new Map(summaryPairs());
    expect(pairs.get('ARN')).toBe(`arn:aws:iam::000000000000:role/${markup}/odd-role`);
    expect(pairs.get('Description')).toBe(markup);
    expect(pairs.get('Path')).toBe(`/${markup}/`);
    expect(policyRows().map((row) => row[0])).toEqual([markup, markup]);
    expect(document.querySelector('img')).toBeNull();
  });

  it('a name of 64 characters: the h1 shows the whole name as a name, and the last crumb holds the whole name (issue 467, R6)', async () => {
    const name = `r${'x'.repeat(63)}`;
    await openLoaded({ name });

    expect(h1()).toHaveTextContent(name);
    expect(kindOf(h1(), name)).toBe('name');
    // The last crumb is the area's `BreadcrumbGroup` item, a string `area-layout.tsx` renders: its whole name, as
    // Cloudscape renders it (decisions-needed.md, the crumb's line).
    expect(crumbs().at(-1)?.text).toBe(name);
  });

  it('a 64-character name, a long path, a 256-character description, a long policy name and boundary, none with a space: each in the area’s element of its kind, and no service class (issue 467, R6)', async () => {
    const name = `r${'x'.repeat(63)}`;
    const rolePath = `/${'p'.repeat(100)}/`;
    const description = 'd'.repeat(256);
    const policy = { name: `P${'q'.repeat(127)}`, arn: `arn:aws:iam::000000000000:policy/P${'q'.repeat(127)}` };
    const boundary = `arn:aws:iam::000000000000:policy/B${'b'.repeat(127)}`;
    await openLoaded({ name, path: rolePath, description, attached: [policy], boundary });

    expect(kindOf(main(), arnOf({ name, path: rolePath }))).toBe('address');
    expect(kindOf(main(), rolePath)).toBe('address');
    expect(kindOf(main(), description)).toBe('text');
    expect(kindOf(main(), policy.name)).toBe('name');
    expect(kindOf(main(), boundary)).toBe('address');
    expect(document.querySelector('.aws-iam-value')).toBeNull();
  });
});

describe('the policies failing while the role does not', () => {
  it('ListAttachedRolePolicies fails with ValidationError: "Summary" and "Permissions boundary" shown, the failure in the table’s place, "Retry" reads again', async () => {
    engine.handlers.ListAttachedRolePolicies = () => errorAnswer(400, 'ValidationError', 'bad list');
    await openLoaded({ name: 'team-role', attached: [READ_ONLY] });

    expect(within(main()).getByRole('heading', { level: 2, name: 'Permissions boundary' })).toBeInTheDocument();
    await waitFor(() => {
      expect(policiesSlot()).toHaveTextContent('The policies could not be read');
    });
    expect(policiesSlot()).toHaveTextContent('ValidationError: bad list');

    delete engine.handlers.ListAttachedRolePolicies;
    const before = engine.sent.length;
    fireEvent.click(within(policiesSlot()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(policyRows()).toEqual([['ReadOnlyAccess', 'AWS managed']]);
    });
    expect(
      engine.sent
        .slice(before)
        .map((sent) => sent.action)
        .sort(),
    ).toEqual(['GetRole', 'ListAttachedRolePolicies', 'ListRolePolicies']);
  });

  it('ListAttachedRolePolicies answers 501: "Not implemented by the emulator" naming ListAttachedRolePolicies and the policies', async () => {
    engine.handlers.ListAttachedRolePolicies = () => errorAnswer(501, 'NotImplemented', 'no');
    await openLoaded(PLAIN);

    await waitFor(() => {
      expect(status(policiesSlot())).toEqual({ type: 'info', text: 'Not implemented by the emulator' });
    });
    expect(policiesSlot()).toHaveTextContent(
      'The emulator answered 501 Not Implemented for ListAttachedRolePolicies, so Studio cannot show the policies.',
    );
  });
});

describe('the tabs and "Refresh role"', () => {
  it.each([
    ['Trust relationships', 'trust-relationships'],
    ['Tags', 'tags'],
    ['Last Accessed', 'last-accessed'],
    ['Revoke sessions', 'revoke-sessions'],
  ])('"%s" leads to the role’s path ending in %s, without a request to the engine', async (label, ending) => {
    const name = 'a+b=c';
    const { router } = await openLoaded({ name });
    const sent = engine.sent.length;

    fireEvent.click(tab(label));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/aws/iam/roles/details/${encodeURIComponent(name)}/${ending}`);
    });
    expect(engine.sent.slice(sent)).toEqual([]);
  });

  it('"Refresh role": the three requests again, then "Role refreshed" announced', async () => {
    await openLoaded({ name: 'team-role' });
    const said = recordAnnouncements();
    const before = engine.sent.length;

    engine.roles[0] = { name: 'team-role', attached: [READ_ONLY] };
    fireEvent.click(within(main()).getByRole('button', { name: 'Refresh role' }));

    await waitFor(() => {
      expect(policyRows()).toEqual([['ReadOnlyAccess', 'AWS managed']]);
    });
    expect(
      engine.sent
        .slice(before)
        .map((sent) => sent.action)
        .sort(),
    ).toEqual(['GetRole', 'ListAttachedRolePolicies', 'ListRolePolicies']);
    await waitFor(() => {
      expect(said).toContain('Role refreshed');
    });
  });
});

describe('not found and loading', () => {
  it('NoSuchEntity from GetRole: the h1 is the address’s name; "Role not found", the sentence and the link "Roles"; no tabs, no sections, no "Edit"', async () => {
    const { router } = open(pagePath('gone-role'));

    await waitFor(() => {
      expect(within(main()).getByText('Role not found')).toBeInTheDocument();
    });
    expect(h1()).toHaveTextContent('gone-role');
    const sentence = within(main())
      .getByText(/^The emulator holds no role named/)
      .closest('p');
    expect(sentence).toHaveTextContent(
      'The emulator holds no role named “gone-role”. It may have been deleted, or the emulator restarted.',
    );
    expect(tabs()).toEqual([]);
    expect(sectionHeadings()).toEqual([]);
    expect(within(main()).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(h1Description(), 'no description under the h1 (issue 467, R3)').toBeNull();
    expect(kindOf(main(), 'gone-role'), 'the sentence shows the name as a name (issue 467, R6)').toBe('name');

    // The page's own link, not the side navigation's or the crumb's.
    const links = within(main())
      .getAllByRole('link', { name: 'Roles' })
      .filter((link) => link.closest('nav') === null);
    expect(links).toHaveLength(1);
    fireEvent.click(links[0] as HTMLElement);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles');
    });
  });

  it('a request in flight: "Loading role"; the h1 is the address’s name; the five tabs with the four others disabled; no sections, no "Edit"', async () => {
    const release = holdAnswers('GetRole');
    engine.roles = [{ name: 'Slow-Role' }];
    open(pagePath('slow-role'));

    await waitFor(() => {
      expect(within(main()).getByText('Loading role')).toBeInTheDocument();
    });
    expect(h1()).toHaveTextContent('slow-role');
    expect(tabs()).toEqual([
      { label: 'Permissions', selected: true, disabled: false },
      { label: 'Trust relationships', selected: false, disabled: true },
      { label: 'Tags', selected: false, disabled: true },
      { label: 'Last Accessed', selected: false, disabled: true },
      { label: 'Revoke sessions', selected: false, disabled: true },
    ]);
    expect(sectionHeadings()).toEqual([]);
    expect(within(main()).queryByRole('button', { name: 'Edit' })).toBeNull();

    release();
    await waitFor(() => {
      expect(h1()).toHaveTextContent('Slow-Role');
    });
  });
});

describe('failure states', () => {
  async function openFailing(answer: () => EngineAnswer) {
    engine.roles = [PLAIN];
    engine.handlers.GetRole = answer;
    open(pagePath(PLAIN.name));
    await waitFor(() => {
      expect(within(main()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  }

  it('HTTP 501: "Not implemented by the emulator" naming GetRole and the role, as info, and "Retry"', async () => {
    await openFailing(() => errorAnswer(501, 'NotImplemented', 'no'));

    expect(status(failureBox())).toEqual({ type: 'info', text: 'Not implemented by the emulator' });
    expect(main()).toHaveTextContent(
      'The emulator answered 501 Not Implemented for GetRole, so Studio cannot show the role.',
    );
    expect(h1()).toHaveTextContent(PLAIN.name);
  });

  it('a failed load: the h1 has no description (issue 467, R3)', async () => {
    await openFailing(() => errorAnswer(400, 'ValidationError', 'bad'));

    expect(h1Description()).toBeNull();
  });

  it('AccessDenied: "Access denied" with "GetRole was refused: " and the message', async () => {
    await openFailing(() => errorAnswer(403, 'AccessDenied', 'not for you'));

    expect(status(failureBox()).text).toBe('Access denied');
    expect(main()).toHaveTextContent('GetRole was refused: not for you');
  });

  it('EmulatorUnavailable: "The emulator did not answer" with the engine’s message', async () => {
    const message = 'The emulator at https://127.0.0.1:9313 could not be reached';
    await openFailing(() => engineRefusal(503, 'EmulatorUnavailable', message));

    expect(status(failureBox()).text).toBe('The emulator did not answer');
    expect(main()).toHaveTextContent(message);
  });

  it('no answer from the engine: "The EmuForge engine at <engine origin> did not answer"', async () => {
    await openFailing(() => 'network-error');

    expect(status(failureBox()).text).toBe(`The EmuForge engine at ${engineOrigin} did not answer`);
  });

  it('any other error: "The role could not be read" with "<code>: <message>"', async () => {
    await openFailing(() => errorAnswer(400, 'ServiceFailure', 'it broke'));

    expect(status(failureBox()).text).toBe('The role could not be read');
    expect(main()).toHaveTextContent('ServiceFailure: it broke');
  });

  it('not connected: the line’s status with "The role could not be read.", "Connection status" and "Retry"', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(() => 'network-error');

    expect(status(failureBox())).toEqual({ type: 'stopped', text: `Not started on port ${String(EMULATOR_PORT)}` });
    expect(main()).toHaveTextContent('The role could not be read.');
    expect(within(main()).getAllByRole('link', { name: 'Connection status' }).length).toBeGreaterThan(0);
  });

  it('a failure state is announced once; "Retry" reads again and shows the role', async () => {
    const said = recordAnnouncements();
    await openFailing(() => errorAnswer(403, 'AccessDenied', 'no'));
    await waitFor(() => {
      expect(said.filter((text) => text === 'Access denied')).toHaveLength(1);
    });

    delete engine.handlers.GetRole;
    const before = engine.of('GetRole').length;
    fireEvent.click(within(main()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(within(main()).getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
    });
    expect(engine.of('GetRole').length).toBe(before + 1);
    expect(said.filter((text) => text === 'Access denied')).toHaveLength(1);
  });

  it('a failed read, then the connection becomes connected: a new read without any action, and the role', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(() => 'network-error');
    const before = engine.of('GetRole').length;

    delete engine.handlers.GetRole;
    connection.set(connectedResult());

    await waitFor(() => {
      expect(within(main()).getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
    });
    expect(engine.of('GetRole').length).toBe(before + 1);
  });

  it('a role shown, the connection down and up again (the emulator restarted): read again by itself, "Role not found"', async () => {
    await openLoaded(PLAIN);

    connection.set(notStartedResult());
    engine.roles = [];
    connection.set(connectedResult());

    await waitFor(() => {
      expect(within(main()).getByText('Role not found')).toBeInTheDocument();
    });
  });
});
