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

// "Create role" rendered inside the area's layout at `/aws/iam/roles/create`, as Studio's frame renders the area,
// against a fake engine behind the page's `fetch` (test-criteria.md, issue 82, "Unit —
// services/iam/pages/create-role-page.test.tsx"; requirement R6, R9.4, R10; and issue 467's changed cases,
// requirement R3, R4, R7).

// ---------------------------------------------------------------------------------------------------------------
// The fake engine: IAM's Query protocol over the policies and roles it holds.
// ---------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  body: string;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

interface Sent {
  action: string;
  params: URLSearchParams;
}

interface FakePolicy {
  name: string;
  arn: string;
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

const ACCOUNT = '000000000000';
const CREATED = '2026-11-17T09:05:03Z';

function awsManaged(name: string): FakePolicy {
  return { name, arn: `arn:aws:iam::aws:policy/${name}` };
}

function customerManaged(name: string): FakePolicy {
  return { name, arn: `arn:aws:iam::${ACCOUNT}:policy/${name}` };
}

/** The emulator's policies: 25, so the table has two pages of 20. */
function startPolicies(): FakePolicy[] {
  return [
    awsManaged('AdministratorAccess'),
    awsManaged('ReadOnlyAccess'),
    customerManaged('team-policy'),
    ...Array.from({ length: 22 }, (_, i) => awsManaged(`Policy${String(i + 1).padStart(2, '0')}`)),
  ];
}

class FakeEngine {
  policies: FakePolicy[] = startPolicies();
  /** The names of the roles the emulator holds. */
  roles: string[] = [];
  readonly sent: Sent[] = [];
  /** An answer of a case's own for an operation; the emulator's default otherwise. */
  handlers: Record<string, (params: URLSearchParams) => EngineAnswer> = {};
  private sessions = 0;

  emulator(action: string, params: URLSearchParams): Answer {
    switch (action) {
      case 'GetUser':
        return ok(
          action,
          `<User><Path>/</Path><UserName>emulator</UserName><UserId>AIDA1</UserId><Arn>arn:aws:iam::${ACCOUNT}:user/emulator</Arn><CreateDate>${CREATED}</CreateDate></User>`,
        );
      case 'ListPolicies': {
        const size = Number(params.get('MaxItems') ?? '100');
        const from = Number(params.get('Marker') ?? '0');
        const page = this.policies.slice(from, from + size);
        const more = from + size < this.policies.length;
        const members = page
          .map(
            ({ name, arn }) =>
              `<member><PolicyName>${esc(name)}</PolicyName><PolicyId>P${esc(name)}</PolicyId><Arn>${esc(arn)}</Arn></member>`,
          )
          .join('');
        return ok(
          action,
          `<Policies>${members}</Policies><IsTruncated>${String(more)}</IsTruncated>${more ? `<Marker>${String(from + size)}</Marker>` : ''}`,
        );
      }
      case 'CreateRole': {
        const name = params.get('RoleName') ?? '';
        if (this.roles.some((role) => role.toLowerCase() === name.toLowerCase())) {
          return errorAnswer(409, 'EntityAlreadyExists', `Role with name ${name} already exists.`);
        }
        this.roles.push(name);
        return ok(
          action,
          `<Role><Path>/</Path><RoleName>${esc(name)}</RoleName><RoleId>AROA1</RoleId><Arn>arn:aws:iam::${ACCOUNT}:role/${esc(name)}</Arn><CreateDate>${CREATED}</CreateDate><AssumeRolePolicyDocument>${esc(encodeURIComponent(params.get('AssumeRolePolicyDocument') ?? ''))}</AssumeRolePolicyDocument></Role>`,
        );
      }
      case 'ListRoles':
        return ok(action, '<Roles></Roles><IsTruncated>false</IsTruncated>');
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

  /** The requests that change the emulator. */
  changes(): Sent[] {
    return this.sent.filter((sent) => sent.action === 'CreateRole' || sent.action === 'AttachRolePolicy');
  }
}

/** An answer that waits until the case releases it. */
function held(): { answer: Promise<Answer>; release: (answer: Answer) => void } {
  let release: (answer: Answer) => void = () => undefined;
  const answer = new Promise<Answer>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

/** The connection Studio hands the area; each change re-renders the area as the frame does. */
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
}

const EMULATOR_PORT = 9313;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9450;
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

const CREATE_PATH = '/aws/iam/roles/create';
const STEP_TITLES = ['Select trusted entity', 'Add permissions', 'Name, review, and create'] as const;

function open(path: string = CREATE_PATH) {
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
// Readers and actions.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

function main(): HTMLElement {
  return screen.getByRole('main');
}

function h1(): HTMLElement {
  return screen.getByRole('heading', { level: 1 });
}

function wizard() {
  const found = PAGE.findWizard();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

/** Waits for step `k` (its `h1`). */
async function onStep(k: 1 | 2 | 3): Promise<void> {
  await waitFor(() => {
    expect(h1()).toHaveTextContent(STEP_TITLES[k - 1] ?? '');
  });
}

async function openWizard(path: string = CREATE_PATH, k: 1 | 2 | 3 = 1) {
  const opened = open(path);
  await onStep(k);
  return opened;
}

function location(router: ReturnType<typeof open>['router']): string {
  return `${router.state.location.pathname}${router.state.location.search}`;
}

/** The wizard's step navigation beside the form (Cloudscape also renders a collapsed one for narrow widths). */
function stepNavigation(): HTMLElement {
  const found = within(main()).getAllByRole('navigation', { name: 'Steps' })[0];
  expect(found).toBeDefined();
  return found as HTMLElement;
}

function button(name: string): HTMLElement {
  return within(main()).getByRole('button', { name });
}

function press(name: string): void {
  fireEvent.click(button(name));
}

function next(): void {
  fireEvent.click(wizard().findPrimaryButton().getElement());
}

function previous(): void {
  const found = wizard().findPreviousButton();
  expect(found).not.toBeNull();
  fireEvent.click((found as NonNullable<typeof found>).getElement());
}

function radio(name: string): HTMLInputElement {
  return within(main()).getByRole('radio', { name }) as HTMLInputElement;
}

function choose(name: string): void {
  fireEvent.click(radio(name));
}

function checkbox(name: string): HTMLInputElement {
  return within(main()).getByRole('checkbox', { name }) as HTMLInputElement;
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  return within(main()).getByLabelText(label, { selector: 'input, textarea' }) as HTMLInputElement;
}

function type(label: string, text: string): void {
  fireEvent.change(field(label), { target: { value: text } });
}

function service(text: string): void {
  type('Service or use case', text);
}

/** Step 1 filled with "AWS service" and `lambda.amazonaws.com`, then "Next" to step 2. */
async function toStep2(): Promise<void> {
  service('lambda.amazonaws.com');
  next();
  await onStep(2);
}

/** The policy table of step 2. */
function policyTable() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

async function policyRows(): Promise<string[]> {
  return waitFor(() => {
    const rows = policyTable().findRows();
    expect(rows.length).toBeGreaterThan(0);
    return rows.map((row) => (row.getElement().querySelector('th, td:nth-child(2)')?.textContent ?? '').trim());
  });
}

/** Checks the box of the policy `name` on the shown page. */
async function select(name: string): Promise<void> {
  const box = await within(main()).findByRole('checkbox', { name });
  fireEvent.click(box);
}

/** The next page of the policy table, or its first. */
function goToPolicyPage(page: 'next' | 'first'): void {
  const pagination = PAGE.findPagination();
  expect(pagination).not.toBeNull();
  const found = pagination as NonNullable<typeof pagination>;
  const link = page === 'next' ? found.findNextPageButton() : found.findPageNumberByIndex(1);
  expect(link).not.toBeNull();
  fireEvent.click((link as NonNullable<typeof link>).getElement());
}

function applyFilter(text: string): void {
  const input = within(main()).getByRole('searchbox', { name: 'Search items' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

/** Steps 1 and 2 with `lambda.amazonaws.com` and the policies named, then "Next" to step 3. */
async function toStep3(policies: string[] = []): Promise<void> {
  await toStep2();
  await policyRows();
  for (const policy of policies) {
    await select(policy);
  }
  next();
  await onStep(3);
}

/** Leaves the focused field, as a pointer press on another control does first in a browser. */
function leaveField(): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) {
    fireEvent.blur(focused);
    focused.blur();
  }
}

function addTag(key: string, value: string): void {
  leaveField();
  press('Add new tag');
  const editor = PAGE.findTagEditor();
  expect(editor).not.toBeNull();
  const rows = (editor as NonNullable<typeof editor>).findRows();
  const row = rows[rows.length - 1];
  expect(row).toBeDefined();
  const inputs = (row as NonNullable<typeof row>).getElement().querySelectorAll('input');
  fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: key } });
  fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: value } });
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

/** The description under the `h1` (the step's title), or `null` when there is none (issue 467, R3). */
function h1Description(): string | null {
  const header = PAGE.findAllHeaders().find((found) => found.getElement().querySelector('h1') !== null);
  expect(header).toBeDefined();
  const description = header?.findDescription();
  return description === null || description === undefined ? null : (description.getElement().textContent ?? '');
}

/** What the field labelled `label` shows under it: its constraint text and its message, `null` for none. */
function fieldTexts(label: string): { constraint: string | null; error: string | null } {
  const found = PAGE.findAllFormFields().find(
    (formField) => (formField.findLabel()?.getElement().textContent ?? '').trim() === label,
  );
  expect(found, label).toBeDefined();
  const text = (part: { getElement: () => HTMLElement } | null | undefined) =>
    part === null || part === undefined ? null : (part.getElement().textContent ?? '').trim();
  return { constraint: text(found?.findConstraint()), error: text(found?.findError()) };
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

/** The wizard's "Cancel", focused first as a press of it in a browser does, then pressed. */
function cancel(): HTMLElement {
  const found = wizard().findCancelButton().getElement();
  act(() => {
    found.focus();
  });
  fireEvent.click(found);
  return found;
}

/** The dialog "Discard what you entered?", or `null`. */
function discardDialog(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Discard what you entered?' });
}

async function expectDiscardDialog(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = discardDialog();
    expect(found, 'the dialog "Discard what you entered?"').not.toBeNull();
    return found as HTMLElement;
  });
}

/** Each Flashbar item as "<header> <content>", or its content alone. */
function flashTexts(): string[] {
  const text = (element: { getElement: () => HTMLElement } | null) =>
    (element?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim();
  return (PAGE.findFlashbar()?.findItems() ?? []).map((item) =>
    [text(item.findHeader()), text(item.findContent())].filter((part) => part !== '').join(' '),
  );
}

/** The trust policy `CreateRole` carried. */
function sentTrustPolicy(): unknown {
  const sent = engine.of('CreateRole')[0];
  expect(sent).toBeDefined();
  return JSON.parse((sent as Sent).params.get('AssumeRolePolicyDocument') ?? '');
}

function lambdaPolicy(principal = 'lambda.amazonaws.com') {
  return {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: principal }, Action: 'sts:AssumeRole' }],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Step 1.
// ---------------------------------------------------------------------------------------------------------------

describe('step 1, "Select trusted entity"', () => {
  it('opened: its h1, the step navigation, the types, the field and its help, the buttons, the crumbs, the title, the description, the notice and the side navigation', async () => {
    await openWizard();

    expect(h1()).toHaveTextContent('Select trusted entity');
    const navigation = stepNavigation();
    const listed = within(navigation)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
    expect(listed).toHaveLength(3);
    STEP_TITLES.forEach((title, index) => {
      expect(listed[index]).toContain(title);
    });
    expect(within(main()).getByRole('heading', { level: 2, name: 'Trusted entity type' })).toBeInTheDocument();
    expect(radio('AWS service').checked).toBe(true);
    expect(radio('AWS account').checked).toBe(false);
    expect(radio('Custom trust policy').checked).toBe(false);
    expect(within(main()).queryByRole('radio', { name: 'Web identity' })).toBeNull();
    expect(within(main()).queryByRole('radio', { name: 'SAML 2.0 federation' })).toBeNull();
    expect(field('Service or use case')).toHaveValue('');
    expect(main()).toHaveTextContent(
      'Enter the principal of the service that may assume the role. The emulator accepts a principal that names no service.',
    );
    expect(button('Cancel')).toBeInTheDocument();
    expect(button('Next')).toBeInTheDocument();
    expect(within(main()).queryByRole('button', { name: 'Previous' })).toBeNull();
    const shown = crumbs();
    expect(shown.map((crumb) => crumb.text)).toEqual(['EmuForge', 'AWS', 'IAM', 'Roles', 'Create role']);
    expect(shown[3]?.href).toBe('/aws/iam/roles');
    expect(shown[4]?.href).toBeNull();
    expect(h1Description(), 'no description under the step’s title (issue 467, R3)').toBeNull();
    expect(screen.getByText('These roles are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About the local emulator' })).toBeInTheDocument();
    const side = PAGE.findSideNavigation();
    expect(side).not.toBeNull();
    const sideElement = (side as NonNullable<typeof side>).getElement();
    expect(within(sideElement).getByRole('link', { name: 'Identity and Access Management (IAM)' })).toHaveAttribute(
      'href',
      '/aws/iam',
    );
    expect(within(sideElement).getByText('Access Management')).toBeInTheDocument();
    expect(within(sideElement).getByRole('link', { name: 'Roles' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => {
      expect(document.title).toBe('Create role | EmuForge Studio');
    });
  });

  it('`lam` typed offers lambda.amazonaws.com, choosing it fills the field; a text that is no suggestion stays as typed', async () => {
    await openWizard();
    const autosuggest = PAGE.findAutosuggest();
    expect(autosuggest).not.toBeNull();
    const suggest = autosuggest as NonNullable<typeof autosuggest>;
    suggest.focus();
    suggest.setInputValue('lam');
    const offered = suggest
      .findDropdown()
      .findOptions()
      .map((option) => (option.getElement().textContent ?? '').trim());
    expect(offered.some((text) => text.includes('lambda.amazonaws.com'))).toBe(true);
    suggest.selectSuggestionByValue('lambda.amazonaws.com');
    expect(field('Service or use case')).toHaveValue('lambda.amazonaws.com');

    service('my-own.example');
    expect(field('Service or use case')).toHaveValue('my-own.example');
  });

  it('"AWS account": one GetUser; "This account" chosen, "Another AWS account", the two check boxes, no "Account ID"; "Next" disabled while it is read', async () => {
    const user = held();
    engine.handlers.GetUser = () => user.answer;
    await openWizard();
    choose('AWS account');

    await waitFor(() => {
      expect(engine.of('GetUser')).toHaveLength(1);
    });
    expect(radio('This account').checked).toBe(true);
    expect(radio('Another AWS account').checked).toBe(false);
    expect(checkbox('Require external ID')).toBeInTheDocument();
    expect(checkbox('Require MFA')).toBeInTheDocument();
    expect(within(main()).queryByLabelText('Account ID')).toBeNull();
    const primary = wizard().findPrimaryButton().getElement();
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    next();
    expect(h1()).toHaveTextContent('Select trusted entity');

    await act(async () => {
      user.release(engine.emulator('GetUser', new URLSearchParams()));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(wizard().findPrimaryButton().getElement()).not.toHaveAttribute('aria-disabled', 'true');
    });
    choose('AWS service');
    choose('AWS account');
    expect(engine.of('GetUser')).toHaveLength(1);
  });

  it('"Another AWS account" shows "Account ID"; "Require external ID" shows "External ID"', async () => {
    await openWizard();
    choose('AWS account');
    await waitFor(() => {
      expect(radio('This account').disabled).toBe(false);
    });
    choose('Another AWS account');
    expect(field('Account ID')).toBeInTheDocument();
    expect(within(main()).queryByLabelText('External ID')).toBeNull();
    fireEvent.click(checkbox('Require external ID'));
    expect(field('External ID')).toBeInTheDocument();
  });

  it('GetUser fails with ValidationError: "This account" disabled with "ValidationError: <message>" under it, "Another AWS account" chosen', async () => {
    engine.handlers.GetUser = () => errorAnswer(400, 'ValidationError', 'The user cannot be read.');
    await openWizard();
    choose('AWS account');

    await waitFor(() => {
      expect(radio('This account').disabled).toBe(true);
    });
    expect(radio('Another AWS account').checked).toBe(true);
    expect(main()).toHaveTextContent('ValidationError: The user cannot be read.');
    expect(within(main()).getByText('ValidationError', { selector: 'code, code *' })).toBeInTheDocument();
    expect(field('Account ID')).toBeInTheDocument();
  });

  it('"Custom trust policy": its section with a text area of that name holding the empty policy, and the help under it', async () => {
    await openWizard();
    choose('Custom trust policy');

    expect(within(main()).getByRole('heading', { level: 2, name: 'Custom trust policy' })).toBeInTheDocument();
    const area = within(main()).getByRole('textbox', { name: 'Custom trust policy' });
    expect(JSON.parse((area as HTMLTextAreaElement).value)).toEqual({ Version: '2012-10-17', Statement: [] });
    expect((area as HTMLTextAreaElement).value.split('\n').length).toBeGreaterThan(1);
    expect(main()).toHaveTextContent('The emulator refuses a document that is not JSON or has no statement list.');
  });

  it('`?step=2` opens step 2, `?step=3` step 3 with "Create role"; `?step=0`, `?step=4`, `?step=x` step 1; nothing typed', async () => {
    const two = await openWizard(`${CREATE_PATH}?step=2`, 2);
    expect(h1()).toHaveTextContent('Add permissions');
    two.unmount();

    const three = await openWizard(`${CREATE_PATH}?step=3`, 3);
    expect(button('Create role')).toBeInTheDocument();
    expect(field('Role name')).toHaveValue('');
    expect(field('Description')).toHaveValue('');
    three.unmount();

    for (const value of ['0', '4', 'x']) {
      const one = await openWizard(`${CREATE_PATH}?step=${value}`, 1);
      expect(field('Service or use case')).toHaveValue('');
      one.unmount();
    }
  });

  it('"Next" with "Service or use case" empty: "Enter a service principal." under it, focus on it, step 1 stays', async () => {
    await openWizard();
    next();

    await waitFor(() => {
      expect(main()).toHaveTextContent('Enter a service principal.');
    });
    expect(h1()).toHaveTextContent('Select trusted entity');
    expect(document.activeElement).toBe(field('Service or use case'));
  });

  it('the messages of "Account ID" `123`, an empty "External ID" and a custom policy `not json`', async () => {
    await openWizard();
    choose('AWS account');
    await waitFor(() => {
      expect(radio('This account').disabled).toBe(false);
    });
    choose('Another AWS account');
    type('Account ID', '123');
    fireEvent.click(checkbox('Require external ID'));
    next();
    await waitFor(() => {
      expect(main()).toHaveTextContent('Enter the 12 digits of an account ID.');
    });
    expect(main()).toHaveTextContent('Enter an external ID.');
    expect(document.activeElement).toBe(field('Account ID'));

    choose('Custom trust policy');
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Custom trust policy' }), {
      target: { value: 'not json' },
    });
    next();
    await waitFor(() => {
      expect(main()).toHaveTextContent('Enter a JSON policy document.');
    });
    expect(h1()).toHaveTextContent('Select trusted entity');
    expect(engine.changes()).toEqual([]);
  });

  it('"Next" on a complete step 1: step 2 at `?step=2` without a reload; "Previous": step 1 with what was entered', async () => {
    const { router } = await openWizard();
    const before = document.body.firstChild;
    service('lambda.amazonaws.com');
    next();
    await onStep(2);
    expect(location(router)).toBe(`${CREATE_PATH}?step=2`);
    expect(document.body.firstChild).toBe(before);

    previous();
    await onStep(1);
    expect(field('Service or use case')).toHaveValue('lambda.amazonaws.com');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Step 2.
// ---------------------------------------------------------------------------------------------------------------

describe('step 2, "Add permissions"', () => {
  it('opened: one request for the first 20 policies; the table, its columns, check boxes, filter, pagination, the help and "0 selected"; no boundary', async () => {
    await openWizard();
    await toStep2();

    const rows = await policyRows();
    expect(engine.of('ListPolicies')).toHaveLength(1);
    const sent = (engine.of('ListPolicies')[0] as Sent).params;
    expect(sent.get('Scope')).toBe('All');
    expect(sent.get('MaxItems')).toBe('20');
    expect(rows).toHaveLength(20);
    const table = within(main()).getByRole('table', { name: 'Permissions policies' });
    expect(within(table).getByRole('columnheader', { name: /Policy name/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Type/ })).toBeInTheDocument();
    expect(within(table).getAllByRole('checkbox').length).toBeGreaterThan(20);
    expect(within(main()).getByRole('heading', { level: 2, name: /Permissions policies/ })).toHaveTextContent(
      '0 selected',
    );
    expect(within(main()).getByRole('searchbox', { name: 'Search items' })).toBeInTheDocument();
    expect(PAGE.findPagination()).not.toBeNull();
    expect(main()).toHaveTextContent(
      'Policies the emulator holds. The emulator attaches at most 10 managed policies to a role.',
    );
    expect(main()).not.toHaveTextContent('Set permissions boundary');
    const typeCells = policyTable()
      .findRows()
      .map((row) => (row.getElement().querySelector('td:last-child')?.textContent ?? '').trim());
    expect(typeCells.slice(0, 3)).toEqual(['AWS managed', 'AWS managed', 'Customer managed']);
  });

  it('two chosen, the next page and one more: "3 selected"; back on page 1 the two are checked; "Next" and "Previous" keep the three', async () => {
    await openWizard();
    await toStep2();
    await policyRows();
    await select('AdministratorAccess');
    await select('ReadOnlyAccess');
    goToPolicyPage('next');
    await waitFor(() => {
      expect(within(main()).getByRole('checkbox', { name: 'Policy21' })).toBeInTheDocument();
    });
    await select('Policy21');
    expect(within(main()).getByRole('heading', { level: 2, name: /Permissions policies/ })).toHaveTextContent(
      '3 selected',
    );

    goToPolicyPage('first');
    await waitFor(() => {
      expect(within(main()).getByRole('checkbox', { name: 'AdministratorAccess' })).toBeChecked();
    });
    expect(checkbox('ReadOnlyAccess')).toBeChecked();
    expect(checkbox('team-policy')).not.toBeChecked();

    next();
    await onStep(3);
    previous();
    await onStep(2);
    await waitFor(() => {
      expect(within(main()).getByRole('checkbox', { name: 'AdministratorAccess' })).toBeChecked();
    });
    expect(within(main()).getByRole('heading', { level: 2, name: /Permissions policies/ })).toHaveTextContent(
      '3 selected',
    );
  });

  it('the filter `Read`: a new reading with that text; a text no name contains: "No matches", the sentence and "Clear filter"', async () => {
    await openWizard();
    await toStep2();
    await policyRows();

    applyFilter('Read');
    await waitFor(() => {
      expect(policyTable().findRows()).toHaveLength(1);
    });
    expect(engine.of('ListPolicies').length).toBeGreaterThan(1);
    expect(within(main()).getByRole('checkbox', { name: 'ReadOnlyAccess' })).toBeInTheDocument();

    applyFilter('nothing-holds-this');
    await waitFor(() => {
      expect(main()).toHaveTextContent('No matches');
    });
    expect(main()).toHaveTextContent('No policy name contains “nothing-holds-this”.');
    press('Clear filter');
    await waitFor(() => {
      expect(policyTable().findRows()).toHaveLength(20);
    });
  });

  it('in flight: "Loading policies"', async () => {
    const list = held();
    engine.handlers.ListPolicies = () => list.answer;
    await openWizard();
    await toStep2();
    await waitFor(() => {
      expect(main()).toHaveTextContent('Loading policies');
    });
  });

  it('501: "Not implemented by the emulator" naming ListPolicies and the policy list', async () => {
    engine.handlers.ListPolicies = () => ({ status: 501, body: '' });
    await openWizard();
    await toStep2();
    await waitFor(() => {
      expect(main()).toHaveTextContent('Not implemented by the emulator');
    });
    expect(main()).toHaveTextContent(
      'The emulator answered 501 Not Implemented for ListPolicies, so Studio cannot show the policy list.',
    );
  });

  it('any other error: "The policy list could not be read" with "<code>: <message>", "Retry" reads again', async () => {
    let fail = true;
    engine.handlers.ListPolicies = (params) =>
      fail ? errorAnswer(400, 'ValidationError', 'Scope is wrong.') : engine.emulator('ListPolicies', params);
    await openWizard();
    await toStep2();
    await waitFor(() => {
      expect(main()).toHaveTextContent('The policy list could not be read');
    });
    expect(main()).toHaveTextContent('ValidationError: Scope is wrong.');
    fail = false;
    press('Retry');
    await waitFor(() => {
      expect(policyTable().findRows()).toHaveLength(20);
    });
  });

  it('eleven chosen, "Next": the rule above the table and step 2 stays; ten: step 3; none: step 3', async () => {
    await openWizard();
    await toStep2();
    await policyRows();
    const eleven = [
      'AdministratorAccess',
      'ReadOnlyAccess',
      'team-policy',
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(policyName),
    ];
    for (const name of eleven) {
      await select(name);
    }
    next();
    await waitFor(() => {
      expect(main()).toHaveTextContent('A role can have at most 10 managed policies in the emulator.');
    });
    expect(h1()).toHaveTextContent('Add permissions');
    const message = within(main()).getByText('A role can have at most 10 managed policies in the emulator.');
    const table = within(main()).getByRole('table', { name: 'Permissions policies' });
    expect(message.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await select(policyName(8));
    next();
    await onStep(3);
    previous();
    await onStep(2);
    await policyRows();
    for (const name of eleven.slice(0, 10)) {
      await select(name);
    }
    next();
    await onStep(3);
  });

  it('none chosen, "Next": step 3', async () => {
    await openWizard();
    await toStep2();
    await policyRows();
    next();
    await onStep(3);
  });
});

function policyName(n: number): string {
  return `Policy${String(n).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Step 3.
// ---------------------------------------------------------------------------------------------------------------

describe('step 3, "Name, review, and create"', () => {
  it('after `lambda.amazonaws.com` and two policies: "Role details", the trust policy with "Edit", the two policies with "Edit", "Add tags"', async () => {
    await openWizard();
    await toStep3(['AdministratorAccess', 'team-policy']);

    const headings = within(main())
      .getAllByRole('heading', { level: 2 })
      .map((heading) => (heading.textContent ?? '').trim());
    expect(headings).toEqual(
      expect.arrayContaining([
        'Role details',
        'Step 1: Select trusted entities',
        'Step 2: Add permissions',
        'Add tags',
      ]),
    );
    expect(field('Role name')).toBeInTheDocument();
    expect(field('Description').tagName).toBe('TEXTAREA');
    const code = within(main()).getByText((_, element) => element?.className === 'aws-area-policy-text');
    expect(JSON.parse(code.textContent ?? '')).toEqual(lambdaPolicy());
    expect((code.textContent ?? '').split('\n').length).toBeGreaterThan(1);
    expect(within(main()).getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
    const chosen = within(main()).getByRole('table', { name: 'Chosen policies' });
    expect(within(chosen).getByRole('columnheader', { name: /Policy name/ })).toBeInTheDocument();
    expect(within(chosen).getByRole('columnheader', { name: /Type/ })).toBeInTheDocument();
    const names = within(chosen)
      .getAllByRole('rowheader')
      .map((cell) => (cell.textContent ?? '').trim());
    expect(names).toEqual(['AdministratorAccess', 'team-policy']);
    expect(kindOf(chosen, 'Customer managed')).toBe('fixed');
    expect(kindOf(chosen, 'team-policy')).toBe('name');
    expect(button('Add new tag')).toBeInTheDocument();
  });

  it('no policy chosen: "No policies selected"; opened at `?step=3`: "Step 1 is not complete."', async () => {
    const first = await openWizard();
    await toStep3();
    expect(main()).toHaveTextContent('No policies selected');
    first.unmount();

    await openWizard(`${CREATE_PATH}?step=3`, 3);
    expect(main()).toHaveTextContent('Step 1 is not complete.');
  });

  it('"Edit" of step 1 leads to step 1, of step 2 to step 2, each with what was entered', async () => {
    await openWizard();
    await toStep3(['ReadOnlyAccess']);
    const [editOne, editTwo] = within(main()).getAllByRole('button', { name: 'Edit' });
    fireEvent.click(editOne as HTMLElement);
    await onStep(1);
    expect(field('Service or use case')).toHaveValue('lambda.amazonaws.com');

    next();
    await onStep(2);
    next();
    await onStep(3);
    fireEvent.click(within(main()).getAllByRole('button', { name: 'Edit' })[1] ?? (editTwo as HTMLElement));
    await onStep(2);
    await waitFor(() => {
      expect(within(main()).getByRole('checkbox', { name: 'ReadOnlyAccess' })).toBeChecked();
    });
  });

  it('the step navigation: on step 1 incomplete "Add permissions" does not open; complete, it opens step 2; on step 3 both earlier steps open', async () => {
    await openWizard();
    // Step 2 seen once, then step 1 emptied again.
    await toStep2();
    previous();
    await onStep(1);
    service('');
    fireEvent.click(within(stepNavigation()).getByText('Add permissions'));
    await waitFor(() => {
      expect(main()).toHaveTextContent('Enter a service principal.');
    });
    expect(h1()).toHaveTextContent('Select trusted entity');

    service('lambda.amazonaws.com');
    fireEvent.click(within(stepNavigation()).getByText('Add permissions'));
    await onStep(2);
    next();
    await onStep(3);
    fireEvent.click(within(stepNavigation()).getByText('Add permissions'));
    await onStep(2);
    fireEvent.click(within(stepNavigation()).getByText('Select trusted entity'));
    await onStep(1);
  });

  it('a fresh wizard: "Add permissions" in the step navigation does not open', async () => {
    await openWizard();
    service('lambda.amazonaws.com');
    fireEvent.click(within(stepNavigation()).getByText('Add permissions'));
    expect(h1()).toHaveTextContent('Select trusted entity');
  });

  it('"Create role" with "Role name" empty: "Enter a role name." under it, focus on it, no request', async () => {
    await openWizard();
    await toStep3();
    press('Create role');
    await waitFor(() => {
      expect(main()).toHaveTextContent('Enter a role name.');
    });
    expect(document.activeElement).toBe(field('Role name'));
    expect(engine.changes()).toEqual([]);
  });

  it('the messages of the name and the description; a name of 64 characters and `a+b=c,d.e@f_g-h` have none', async () => {
    await openWizard();
    await toStep3();

    type('Role name', 'a'.repeat(65));
    press('Create role');
    await waitFor(() => {
      expect(main()).toHaveTextContent('The name can have up to 64 characters.');
    });
    type('Role name', 'with space');
    await waitFor(() => {
      expect(main()).toHaveTextContent('Use only letters, digits and +=,.@_-');
    });
    type('Role name', 'with/slash');
    expect(main()).toHaveTextContent('Use only letters, digits and +=,.@_-');
    type('Role name', 'fine');
    type('Description', 'd'.repeat(1001));
    press('Create role');
    await waitFor(() => {
      expect(main()).toHaveTextContent('The description can have up to 1000 characters.');
    });
    expect(engine.changes()).toEqual([]);

    type('Description', '');
    type('Role name', 'a'.repeat(64));
    expect(main()).not.toHaveTextContent('The name can have up to 64 characters.');
    expect(main()).not.toHaveTextContent('Use only letters');
    type('Role name', 'a+b=c,d.e@f_g-h');
    expect(main()).not.toHaveTextContent('Use only letters');
    expect(main()).not.toHaveTextContent('Enter a role name.');
  });

  it('a tag with an empty key, and two tags with the same key: the editor’s message at the tag, no request', async () => {
    await openWizard();
    await toStep3();
    type('Role name', 'tagged');

    addTag('team', 'one');
    const editor = () => {
      const found = PAGE.findTagEditor();
      expect(found).not.toBeNull();
      return found as NonNullable<typeof found>;
    };
    const firstKey = (editor().findRow(1)?.getElement().querySelectorAll('input')[0] ?? null) as HTMLInputElement;
    fireEvent.change(firstKey, { target: { value: '' } });
    fireEvent.blur(firstKey);
    press('Create role');
    await waitFor(() => {
      expect(main()).toHaveTextContent('You must specify a tag key');
    });
    expect(engine.changes()).toEqual([]);

    fireEvent.change(firstKey, { target: { value: 'team' } });
    addTag('team', 'two');
    press('Create role');
    await waitFor(() => {
      expect(main()).toHaveTextContent('You must specify a unique tag key.');
    });
    expect(engine.changes()).toEqual([]);
  });

  it('an untouched tag with an empty key: no request, and the editor’s message at the tag', async () => {
    await openWizard();
    await toStep3();
    type('Role name', 'tagged');
    press('Add new tag');
    press('Create role');
    await waitFor(() => {
      expect(main()).toHaveTextContent('You must specify a tag key');
    });
    expect(engine.changes()).toEqual([]);
  });

  it('opened at `?step=3`, a valid name, "Create role": no request; step 1 at `?step=1` with "Enter a service principal." and focus on it', async () => {
    const { router } = await openWizard(`${CREATE_PATH}?step=3`, 3);
    type('Role name', 'skipped');
    press('Create role');

    await onStep(1);
    expect(location(router)).toBe(`${CREATE_PATH}?step=1`);
    await waitFor(() => {
      expect(main()).toHaveTextContent('Enter a service principal.');
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(field('Service or use case'));
    });
    expect(engine.changes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// "Create role".
// ---------------------------------------------------------------------------------------------------------------

describe('"Create role"', () => {
  it('a complete wizard without a policy: one CreateRole with the name and the trust policy; in flight the button is disabled with progress, focus stays, a second press sends nothing', async () => {
    const created = held();
    engine.handlers.CreateRole = () => created.answer;
    await openWizard();
    await toStep3();
    type('Role name', 'plain');
    const submit = wizard().findPrimaryButton().getElement();
    submit.focus();
    fireEvent.click(submit);
    // A double press sends one CreateRole.
    fireEvent.click(submit);

    await waitFor(() => {
      expect(engine.of('CreateRole')).toHaveLength(1);
    });
    const sent = (engine.of('CreateRole')[0] as Sent).params;
    expect(sent.get('RoleName')).toBe('plain');
    expect(sentTrustPolicy()).toEqual(lambdaPolicy());
    expect(sent.get('Description')).toBeNull();
    expect(sent.get('Path')).toBeNull();
    expect(sent.get('MaxSessionDuration')).toBeNull();
    expect(sent.get('PermissionsBoundary')).toBeNull();
    expect([...sent.keys()].some((key) => key.startsWith('Tags'))).toBe(false);
    await waitFor(() => {
      expect(wizard().findPrimaryButton().getElement()).toHaveAttribute('aria-disabled', 'true');
    });
    expect(document.activeElement).toBe(wizard().findPrimaryButton().getElement());
    fireEvent.click(wizard().findPrimaryButton().getElement());
    expect(engine.of('CreateRole')).toHaveLength(1);

    await act(async () => {
      created.release(engine.emulator('CreateRole', sent));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(flashTexts()).toEqual(['Role “plain” was created in the local emulator.']);
    });
    expect(engine.of('CreateRole')).toHaveLength(1);
    expect(engine.of('AttachRolePolicy')).toHaveLength(0);
  });

  it('a description, a tag and two policies: CreateRole with them, then one AttachRolePolicy per policy in the table’s order', async () => {
    await openWizard();
    await toStep3(['team-policy', 'AdministratorAccess']);
    type('Role name', 'full');
    type('Description', 'A full role.');
    addTag('team', 'studio');
    press('Create role');

    await waitFor(() => {
      expect(engine.of('AttachRolePolicy')).toHaveLength(2);
    });
    const sent = (engine.of('CreateRole')[0] as Sent).params;
    expect(sent.get('Description')).toBe('A full role.');
    expect(sent.get('Tags.member.1.Key')).toBe('team');
    expect(sent.get('Tags.member.1.Value')).toBe('studio');
    expect(engine.changes().map((change) => change.action)).toEqual([
      'CreateRole',
      'AttachRolePolicy',
      'AttachRolePolicy',
    ]);
    expect(engine.of('AttachRolePolicy').map((attach) => attach.params.get('PolicyArn'))).toEqual([
      customerManaged('team-policy').arn,
      awsManaged('AdministratorAccess').arn,
    ]);
    expect(engine.of('AttachRolePolicy').every((attach) => attach.params.get('RoleName') === 'full')).toBe(true);
  });

  it('everything succeeds: the list’s route with "Role “<name>” was created in the local emulator."', async () => {
    const { router } = await openWizard();
    await toStep3(['ReadOnlyAccess']);
    type('Role name', 'made');
    press('Create role');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles');
    });
    await waitFor(() => {
      expect(flashTexts()).toEqual(['Role “made” was created in the local emulator.']);
    });
    expect(PAGE.findFlashbar()?.findItemsByType('success')).toHaveLength(1);
  });

  it('EntityAlreadyExists: step 3 stays with every value and "Creating the role failed" with "EntityAlreadyExists: <message>" above the buttons; "Create role" sends again', async () => {
    engine.roles = ['Taken'];
    const { router } = await openWizard();
    await toStep3(['ReadOnlyAccess']);
    type('Role name', 'taken');
    type('Description', 'Kept.');
    press('Create role');

    await waitFor(() => {
      expect(main()).toHaveTextContent('Creating the role failed');
    });
    expect(main()).toHaveTextContent('EntityAlreadyExists: Role with name taken already exists.');
    expect(within(main()).getByText('EntityAlreadyExists', { selector: 'code, code *' })).toBeInTheDocument();
    expect(location(router)).toBe(`${CREATE_PATH}?step=3`);
    expect(h1()).toHaveTextContent('Name, review, and create');
    expect(field('Role name')).toHaveValue('taken');
    expect(field('Description')).toHaveValue('Kept.');
    expect(within(main()).getByRole('table', { name: 'Chosen policies' })).toHaveTextContent('ReadOnlyAccess');
    const alert = within(main()).getByText('Creating the role failed');
    const submit = wizard().findPrimaryButton().getElement();
    expect(alert.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(engine.of('AttachRolePolicy')).toHaveLength(0);

    await waitFor(() => {
      expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    });
    type('Role name', 'fresh');
    press('Create role');
    await waitFor(() => {
      expect(engine.of('CreateRole')).toHaveLength(2);
    });
  });

  it('the second AttachRolePolicy refused with NoSuchEntity: the list with the success item and "Attaching <policy name> to <name> failed"', async () => {
    let attaches = 0;
    engine.handlers.AttachRolePolicy = () => {
      attaches += 1;
      return attaches === 2
        ? errorAnswer(404, 'NoSuchEntity', 'Policy team-policy does not exist.')
        : ok('AttachRolePolicy', '');
    };
    const { router } = await openWizard();
    await toStep3(['ReadOnlyAccess', 'team-policy', 'AdministratorAccess']);
    type('Role name', 'partial');
    press('Create role');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles');
    });
    await waitFor(() => {
      expect(flashTexts()).toEqual([
        'Role “partial” was created in the local emulator.',
        'Attaching team-policy to partial failed NoSuchEntity: Policy team-policy does not exist.',
      ]);
    });
    expect(engine.of('AttachRolePolicy')).toHaveLength(3);
    expect(PAGE.findFlashbar()?.findItemsByType('error')).toHaveLength(1);
  });

  it('CreateRole answers 501, AccessDenied, EmulatorUnavailable, or no answer: each shown in the wizard, which keeps every value', async () => {
    const answers: [EngineAnswer, string[]][] = [
      [
        { status: 501, body: '' },
        ['Not implemented by the emulator', 'The emulator answered 501 Not Implemented for CreateRole.'],
      ],
      [errorAnswer(403, 'AccessDenied', 'Not for you.'), ['Access denied', 'CreateRole was refused: Not for you.']],
      [
        engineRefusal(502, 'EmulatorUnavailable', 'The emulator on port 9313 is not answering.'),
        ['The emulator did not answer', 'The emulator on port 9313 is not answering.'],
      ],
      ['network-error', [`The EmuForge engine at ${'ORIGIN'} did not answer`]],
    ];
    await openWizard();
    await toStep3();
    type('Role name', 'kept');
    for (const [answer, texts] of answers) {
      engine.handlers.CreateRole = () => answer;
      const before = engine.of('CreateRole').length;
      await waitFor(() => {
        expect(wizard().findPrimaryButton().getElement()).not.toHaveAttribute('aria-disabled', 'true');
      });
      press('Create role');
      await waitFor(() => {
        expect(engine.of('CreateRole').length).toBeGreaterThan(before);
      });
      for (const text of texts) {
        await waitFor(() => {
          expect(main()).toHaveTextContent(text.replace('ORIGIN', engineOrigin));
        });
      }
      expect(h1()).toHaveTextContent('Name, review, and create');
      expect(field('Role name')).toHaveValue('kept');
    }
    const notImplemented = PAGE.findAlert();
    expect(notImplemented).not.toBeNull();
  });

  it('"Discard" on any step: the list’s route, no request; opened again, an empty wizard on step 1', async () => {
    for (const k of [1, 2, 3] as const) {
      const { router, unmount } = await openWizard();
      service('lambda.amazonaws.com');
      if (k >= 2) {
        next();
        await onStep(2);
      }
      if (k === 3) {
        next();
        await onStep(3);
        type('Role name', 'dropped');
      }
      cancel();
      fireEvent.click(within(await expectDiscardDialog()).getByRole('button', { name: 'Discard' }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/aws/iam/roles');
      });
      expect(engine.changes()).toEqual([]);

      await act(async () => {
        await router.navigate(CREATE_PATH);
      });
      await onStep(1);
      expect(field('Service or use case')).toHaveValue('');
      expect(radio('AWS service').checked).toBe(true);
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Issue 467: no description, the fields' rules, and "Cancel" before it discards.
// ---------------------------------------------------------------------------------------------------------------

describe('the steps’ headers and the fields’ rules (issue 467, R3, R4)', () => {
  it('steps 1, 2 and 3: none has a description under its title', async () => {
    await openWizard();
    expect(h1Description()).toBeNull();
    await toStep2();
    expect(h1Description()).toBeNull();
    next();
    await onStep(3);
    expect(h1Description()).toBeNull();
  });

  it('step 1 with "AWS account" and "Another AWS account": under "Account ID" "12 digits."; no constraint text under "External ID"', async () => {
    await openWizard();
    choose('AWS account');
    choose('Another AWS account');

    expect(fieldTexts('Account ID')).toEqual({ constraint: '12 digits.', error: null });
    fireEvent.click(checkbox('Require external ID'));
    expect(fieldTexts('External ID').constraint).toBeNull();
  });

  it('step 3 as opened: the rules under "Role name" and "Description", no message under either; no constraint text under a tag’s "Key" or "Value"', async () => {
    await openWizard();
    await toStep3();

    expect(fieldTexts('Role name')).toEqual({
      constraint: '1 to 64 characters: letters (A-Z, a-z), digits and the characters + = , . @ _ -.',
      error: null,
    });
    expect(fieldTexts('Description')).toEqual({ constraint: 'Up to 1000 characters.', error: null });
    addTag('k', 'v');
    const editor = PAGE.findTagEditor()?.getElement() as HTMLElement;
    const tagFields = createWrapper(editor).findAllFormFields();
    expect(tagFields.length).toBeGreaterThan(0);
    expect(tagFields.map((tagField) => tagField.findConstraint())).toEqual(tagFields.map(() => null));
  });

  it('"Create role" with a name holding a space: the message "Use only letters, digits and +=,.@_-" and the constraint text, both under the field', async () => {
    await openWizard();
    await toStep3();
    type('Role name', 'with space');
    press('Create role');

    await waitFor(() => {
      expect(fieldTexts('Role name')).toEqual({
        constraint: '1 to 64 characters: letters (A-Z, a-z), digits and the characters + = , . @ _ -.',
        error: 'Use only letters, digits and +=,.@_-',
      });
    });
    expect(engine.changes()).toEqual([]);
  });

  it('a role made: in the flash "Role “{name}” was created in the local emulator." the name is shown as a name and the rest as free text (R6)', async () => {
    const { router } = await openWizard();
    await toStep3();
    type('Role name', 'made');
    press('Create role');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles');
    });
    const success = await waitFor(() => {
      const found = PAGE.findFlashbar()?.findItemsByType('success')[0]?.getElement();
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    expect(kindOf(success, 'made')).toBe('name');
    expect(kindOf(success, 'Role “')).toBe('text');
    expect(kindOf(success, '” was created in the local emulator.')).toBe('text');
  });
});

describe('"Cancel" (issue 467, R7)', () => {
  it('on step 1 with nothing changed: the list, no dialog', async () => {
    const { router } = await openWizard();
    cancel();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles');
    });
    expect(discardDialog()).toBeNull();
  });

  it('a principal typed, "Next", "Next", "Cancel" on step 3: the dialog; "Keep editing": step 3, the principal still on step 1, focus on "Cancel"; "Cancel", "Discard": the list', async () => {
    const { router } = await openWizard();
    await toStep3();
    const cancelButton = cancel();

    const dialog = await expectDiscardDialog();
    expect(within(dialog).getByText('What you entered on this page is not kept.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(discardDialog()).toBeNull();
    });
    expect(location(router)).toBe(`${CREATE_PATH}?step=3`);
    await waitFor(() => {
      expect(document.activeElement).toBe(cancelButton);
    });
    previous();
    await onStep(2);
    previous();
    await onStep(1);
    expect(field('Service or use case')).toHaveValue('lambda.amazonaws.com');

    cancel();
    fireEvent.click(within(await expectDiscardDialog()).getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles');
    });
    expect(engine.changes()).toEqual([]);
  });

  it('Esc and "Close" answer as "Keep editing": the wizard stays with what was entered', async () => {
    const { router } = await openWizard();
    service('lambda.amazonaws.com');

    cancel();
    const dialog = await expectDiscardDialog();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Keep editing' }), {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
    });
    await waitFor(() => {
      expect(discardDialog()).toBeNull();
    });
    cancel();
    fireEvent.click(within(await expectDiscardDialog()).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(discardDialog()).toBeNull();
    });
    expect(location(router)).toBe(CREATE_PATH);
    expect(field('Service or use case')).toHaveValue('lambda.amazonaws.com');
  });

  it('a principal typed and removed again: the list, no dialog', async () => {
    const { router } = await openWizard();
    service('lambda.amazonaws.com');
    service('');
    cancel();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles');
    });
    expect(discardDialog()).toBeNull();
  });

  it('"Custom trust policy" chosen and nothing else: the dialog; "AWS service" chosen again with nothing typed: the list, no dialog', async () => {
    const { router } = await openWizard();
    choose('Custom trust policy');
    cancel();
    fireEvent.click(within(await expectDiscardDialog()).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(discardDialog()).toBeNull();
    });

    choose('AWS service');
    cancel();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/roles');
    });
    expect(discardDialog()).toBeNull();
  });

  it('a policy selected on step 2: the dialog; a tag added on step 3: the dialog', async () => {
    // Each opened at its step by the address, so the policy or the tag is the one thing entered.
    const first = await openWizard(`${CREATE_PATH}?step=2`, 2);
    await policyRows();
    await select('ReadOnlyAccess');
    cancel();
    await expectDiscardDialog();
    first.unmount();

    await openWizard(`${CREATE_PATH}?step=3`, 3);
    leaveField();
    press('Add new tag');
    cancel();
    await expectDiscardDialog();
  });
});
