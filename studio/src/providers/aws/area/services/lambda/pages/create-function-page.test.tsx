import createWrapper, { type SelectWrapper } from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import { starterCode } from '../starter-code';
import { storedZip } from '../zip';

// "Create Event Function" rendered inside the area's layout, as Studio's frame renders the area, against a fake engine
// behind the page's `fetch` that answers the Lambda and IAM requests of the form (test-criteria.md, issue 84, "Unit —
// services/lambda/pages/create-function-page.test.tsx"; requirement R6, R9.4, R10.3).

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

/** One AWS request of the page: its operation, and its parameters as the engine received them. */
interface SentRequest {
  operation: string;
  method: string;
  url: URL;
  /** IAM's form parameters, or Lambda's JSON body; `{}` for a request without a body. */
  params: Record<string, unknown>;
}

const ACCOUNT = '000000000000';
const FUNCTION_ARN = `arn:aws:lambda:us-east-1:${ACCOUNT}:function`;
const FUNCTIONS = '/2015-03-31/functions';
const FUNCTION_PATH = /^\/2015-03-31\/functions\/([^/]+)$/;
const URL_PATH = /^\/2021-10-31\/functions\/([^/]+)\/url$/;

function json(status: number, body: unknown): Answer {
  return { status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
}

function lambdaError(status: number, code: string, message: string): Answer {
  return {
    status,
    body: JSON.stringify({ message }),
    headers: { 'content-type': 'application/json', 'x-amzn-errortype': code },
  };
}

function xml(body: string): Answer {
  return { status: 200, body, headers: { 'content-type': 'text/xml' } };
}

function iamError(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0"?><ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>r</RequestId></ErrorResponse>`,
    headers: { 'content-type': 'text/xml' },
  };
}

interface FakeRole {
  name: string;
  path: string;
}

function roleArn({ name, path }: FakeRole): string {
  return `arn:aws:iam::${ACCOUNT}:role${path}${name}`;
}

function roleXml(role: FakeRole): string {
  return `<member><Path>${role.path}</Path><RoleName>${role.name}</RoleName><RoleId>AROA${role.name}</RoleId><Arn>${roleArn(role)}</Arn><CreateDate>2026-11-17T02:22:16Z</CreateDate></member>`;
}

/** A `ListRoles` answer with `roles`; truncated with `marker` when one is given. */
function rolePage(roles: FakeRole[], marker?: string): Answer {
  const truncated =
    marker === undefined
      ? '<IsTruncated>false</IsTruncated>'
      : `<IsTruncated>true</IsTruncated><Marker>${marker}</Marker>`;
  return xml(
    `<ListRolesResponse><ListRolesResult>${truncated}<Roles>${roles.map(roleXml).join('')}</Roles></ListRolesResult></ListRolesResponse>`,
  );
}

/** A deferred answer a case lets go when it chooses. */
function held(): { answer: Promise<Answer>; release: (answer: Answer) => void } {
  let release: (answer: Answer) => void = () => undefined;
  const answer = new Promise<Answer>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

class FakeEngine {
  /** The functions the emulator holds, by name. */
  readonly functions = new Set<string>();
  /** The roles the emulator holds. */
  roles: FakeRole[] = [];
  /** Every AWS request, as sent. */
  readonly aws: SentRequest[] = [];

  answerCreateRole: (request: SentRequest) => EngineAnswer = (request) => this.createRole(request);
  answerAttachRolePolicy: (request: SentRequest) => EngineAnswer = () =>
    xml(
      '<AttachRolePolicyResponse><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></AttachRolePolicyResponse>',
    );
  answerCreateFunction: (request: SentRequest) => EngineAnswer = (request) => this.createFunction(request);
  answerListRoles: (request: SentRequest) => EngineAnswer = () => rolePage(this.roles);

  createRole({ params }: SentRequest): Answer {
    const role = { name: String(params['RoleName']), path: String(params['Path'] ?? '/') };
    this.roles.push(role);
    return xml(
      `<CreateRoleResponse><CreateRoleResult><Role><Path>${role.path}</Path><RoleName>${role.name}</RoleName><RoleId>AROAX</RoleId><Arn>${roleArn(role)}</Arn><CreateDate>2026-11-17T02:22:16Z</CreateDate></Role></CreateRoleResult></CreateRoleResponse>`,
    );
  }

  createFunction({ params }: SentRequest): Answer {
    const name = String(params['FunctionName']);
    if (this.functions.has(name)) {
      return lambdaError(409, 'ResourceConflictException', `Function already exist: ${name}`);
    }
    this.functions.add(name);
    return json(201, {
      FunctionName: name,
      FunctionArn: `${FUNCTION_ARN}:${name}`,
      Runtime: params['Runtime'],
      Handler: params['Handler'],
      Role: params['Role'],
      State: 'Pending',
      StateReasonCode: 'Creating',
    });
  }

  private lambda(request: SentRequest): EngineAnswer {
    const { operation, url } = request;
    switch (operation) {
      case 'CreateFunction':
        return this.answerCreateFunction(request);
      case 'ListFunctions':
        return json(200, {
          Functions: [...this.functions].sort().map((name) => ({ FunctionName: name, PackageType: 'Zip' })),
        });
      case 'GetFunction': {
        const name = decodeURIComponent(FUNCTION_PATH.exec(url.pathname)?.[1] ?? '');
        if (!this.functions.has(name)) {
          return lambdaError(404, 'ResourceNotFoundException', `Function not found: ${FUNCTION_ARN}:${name}`);
        }
        return json(200, {
          Configuration: {
            FunctionName: name,
            FunctionArn: `${FUNCTION_ARN}:${name}`,
            PackageType: 'Zip',
            State: 'Active',
            LastUpdateStatus: 'Successful',
          },
        });
      }
      case 'GetFunctionUrlConfig':
        return lambdaError(404, 'ResourceNotFoundException', 'The resource you requested does not exist.');
      default:
        return lambdaError(400, 'UnexpectedRequest', `${request.method} ${url.pathname}`);
    }
  }

  private iam(request: SentRequest): EngineAnswer {
    switch (request.operation) {
      case 'CreateRole':
        return this.answerCreateRole(request);
      case 'AttachRolePolicy':
        return this.answerAttachRolePolicy(request);
      case 'ListRoles':
        return this.answerListRoles(request);
      default:
        return iamError(400, 'UnexpectedRequest', request.operation);
    }
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-84-s4' }), { status: 200 });
    }
    const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text();
    let sent: SentRequest;
    if (url.pathname === '/' && request.method === 'POST') {
      const params = Object.fromEntries(new URLSearchParams(body));
      sent = { operation: params['Action'] ?? '', method: request.method, url, params };
    } else {
      const operation =
        request.method === 'POST' && url.pathname === FUNCTIONS
          ? 'CreateFunction'
          : request.method === 'GET' && /^\/2015-03-31\/functions\/?$/.test(url.pathname)
            ? 'ListFunctions'
            : request.method === 'GET' && FUNCTION_PATH.test(url.pathname)
              ? 'GetFunction'
              : request.method === 'GET' && URL_PATH.test(url.pathname)
                ? 'GetFunctionUrlConfig'
                : `${request.method} ${url.pathname}`;
      sent = {
        operation,
        method: request.method,
        url,
        params: body === '' ? {} : (JSON.parse(body) as Record<string, unknown>),
      };
    }
    this.aws.push(sent);
    const answer = await Promise.race([
      Promise.resolve(url.pathname === '/' ? this.iam(sent) : this.lambda(sent)),
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

  /** The operations sent so far, in order. */
  get operations(): string[] {
    return this.aws.map(({ operation }) => operation);
  }

  /** The requests of operation `operation`. */
  sentOf(operation: string): SentRequest[] {
    return this.aws.filter((request) => request.operation === operation);
  }

  /** The IAM requests sent so far. */
  get iamRequests(): SentRequest[] {
    return this.aws.filter(({ url }) => url.pathname === '/');
  }

  /** The requests that create something. */
  get creating(): string[] {
    return this.operations.filter((operation) =>
      ['CreateRole', 'AttachRolePolicy', 'CreateFunction'].includes(operation),
    );
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
}

const EMULATOR_PORT = 9305;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9160;
let engine: FakeEngine;
let connection: Connection;
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
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: engineEndpoint(nextPort) };
  titles = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CREATE_PATH = '/aws/lambda/functions/create';
const LIST_PATH = '/aws/lambda/functions';

function open(path = CREATE_PATH) {
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

async function openForm(path = CREATE_PATH) {
  const opened = open(path);
  await screen.findByRole('heading', { level: 1, name: 'Create Event Function' });
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------
// Readers and actions.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/** The text of `element` as a reader meets it: its text nodes, each block of them apart from the next by a space. */
function textOf(element: Element | null | undefined): string {
  if (element === null || element === undefined) {
    return '';
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    parts.push(node.textContent ?? '');
  }
  // A text that goes on in the next node (": message" after a code, a name inside its quotation marks) is not apart
  // from it.
  let text = '';
  for (const part of parts) {
    text += /^[:.,”]/.test(part.trim()) || text.trimEnd().endsWith('“') ? part : ` ${part}`;
  }
  return norm(text);
}

function nameField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Function name' }) as HTMLInputElement;
}

function formField(label: string) {
  return PAGE.findAllFormFields().find((field) => norm(field.findLabel()?.getElement().textContent) === label);
}

function selectOf(label: string): SelectWrapper {
  const select = formField(label)?.findControl()?.findSelect();
  expect(select, `the select "${label}"`).not.toBeNull();
  return select as SelectWrapper;
}

/** The message under the field `label`; `undefined` when it shows none. */
function messageOf(label: string): string | undefined {
  const error = formField(label)?.findError();
  return error === null || error === undefined ? undefined : norm(error.getElement().textContent);
}

function radio(label: string): HTMLInputElement {
  return screen.getByRole('radio', { name: label }) as HTMLInputElement;
}

function createButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Create Event Function' });
}

function press(): void {
  fireEvent.click(createButton());
}

/** The texts of the options the select `label` lists when open: each option's label and description. */
function optionTexts(label: string): string[] {
  return (selectOf(label).findDropdown().findOptions() ?? []).map((option) => textOf(option.getElement()));
}

/** The text of the dropdown of `label` outside its options: its status. */
function dropdownStatus(label: string): string {
  return textOf(selectOf(label).findDropdown().findFooterRegion()?.getElement());
}

function chooseRuntime(label: string): void {
  const select = selectOf('Runtime');
  select.openDropdown();
  const index = optionTexts('Runtime').indexOf(label);
  expect(index, `the option ${label}`).toBeGreaterThanOrEqual(0);
  select.selectOption(index + 1);
}

async function chooseRole(name: string): Promise<void> {
  fireEvent.click(radio('Use another role'));
  const select = selectOf('Existing role');
  select.openDropdown();
  await waitFor(() => {
    expect(optionTexts('Existing role').some((text) => text.startsWith(name))).toBe(true);
  });
  const index = optionTexts('Existing role').findIndex((text) => text.split(' ')[0] === name);
  select.selectOption(index + 1);
}

/** The alert above the buttons that reports the form's failure, or `null`. */
function failureAlert() {
  const button = createButton();
  return (
    PAGE.findAllAlerts().find(
      (alert) =>
        // It sits before the buttons in the document, so above them.
        (alert.getElement().compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
        !norm(alert.getElement().textContent).startsWith('These functions'),
    ) ?? null
  );
}

function failureText(): string {
  return textOf(failureAlert()?.getElement());
}

function alertType(element: Element | undefined): string | null {
  const name = [...(element?.querySelectorAll('[class*="type-"]') ?? [])]
    .flatMap((found) => [...found.classList])
    .concat([...(element?.classList ?? [])])
    .map((found) => /^awsui_type-([a-z]+)_/.exec(found)?.[1])
    .find((found) => found !== undefined);
  return name ?? null;
}

function flashTexts(): string[] {
  return (PAGE.findFlashbar()?.findItems() ?? []).map((item) => norm(item.getElement().textContent));
}

const ROLE_NAME = /^orders-role-[a-z0-9]{8}$/;

// ---------------------------------------------------------------------------------------------------------------

describe('the form as it opens', () => {
  it('the h1, "Basic information" with its three fields as they start, "Permissions" with "Create default role" chosen, no "Existing role", the two buttons, nothing asked of IAM', async () => {
    await openForm();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => norm(h.textContent));
    expect(headings).toEqual(expect.arrayContaining(['Basic information', 'Permissions']));
    expect(headings.indexOf('Basic information')).toBeLessThan(headings.indexOf('Permissions'));
    expect(nameField().value).toBe('');
    expect(norm(selectOf('Runtime').findTrigger().getElement().textContent)).toBe('Node.js 24.x');
    selectOf('Runtime').openDropdown();
    expect(optionTexts('Runtime')).toEqual([
      'Node.js 24.x',
      'Node.js 22.x',
      'Node.js 20.x',
      'Node.js 18.x',
      'Python 3.14',
      'Python 3.13',
      'Python 3.12',
      'Python 3.11',
      'Python 3.10',
      'Python 3.9',
    ]);
    selectOf('Runtime').closeDropdown();
    expect(radio('x86_64').checked).toBe(true);
    expect(radio('arm64').checked).toBe(false);
    expect(radio('Create default role').checked).toBe(true);
    expect(radio('Use another role').checked).toBe(false);
    expect(formField('Existing role')).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(createButton()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Advanced settings' })).toBeNull();
    expect(engine.iamRequests).toEqual([]);
    expect(engine.aws).toEqual([]);
  });

  it('the crumbs EmuForge, AWS, Lambda, Event Functions, Create Event Function; the title "Create Event Function"; the notice for functions', async () => {
    await openForm();

    const crumbs = (PAGE.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((crumb) => {
      const element = crumb.getElement();
      const link = element.closest('a[href]') ?? element.querySelector('a[href]');
      return [norm(element.textContent), link?.getAttribute('href') ?? null];
    });
    expect(crumbs).toEqual([
      ['EmuForge', '/'],
      ['AWS', '/aws'],
      ['Lambda', '/aws/lambda'],
      ['Event Functions', '/aws/lambda/functions'],
      ['Create Event Function', null],
    ]);
    // Studio's frame writes it as "Create Event Function | EmuForge Studio" (app/routes.test.tsx).
    expect(titles.at(-1)).toBe('Create Event Function');
    expect(screen.getByText('These functions are in your local emulator')).toBeInTheDocument();
    expect(PAGE.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute('href', LIST_PATH);
  });

  it('opened with ?role=existing: "Use another role" chosen and "Existing role" shown; with ?role=other: as opened without it', async () => {
    const first = await openForm(`${CREATE_PATH}?role=existing`);
    expect(radio('Use another role').checked).toBe(true);
    expect(formField('Existing role')).toBeDefined();
    expect(nameField().value).toBe('');
    first.unmount();

    await openForm(`${CREATE_PATH}?role=other`);
    expect(radio('Create default role').checked).toBe(true);
    expect(formField('Existing role')).toBeUndefined();
  });
});

describe('"Existing role"', () => {
  it('appears with "Use another role"; opening it reads the first page ("Loading roles" meanwhile) and offers each role by its name, with its path when that is not /', async () => {
    const page = held();
    engine.answerListRoles = () => page.answer;
    await openForm();

    fireEvent.click(radio('Use another role'));
    expect(formField('Existing role')).toBeDefined();
    expect(engine.sentOf('ListRoles')).toHaveLength(0);
    selectOf('Existing role').openDropdown();
    await waitFor(() => {
      expect(engine.sentOf('ListRoles')).toHaveLength(1);
    });
    expect(engine.sentOf('ListRoles')[0]?.params['MaxItems']).toBe('50');
    expect(engine.sentOf('ListRoles')[0]?.params['Marker']).toBeUndefined();
    expect(dropdownStatus('Existing role')).toContain('Loading roles');

    await act(async () => {
      page.release(
        rolePage([
          { name: 'app-role', path: '/' },
          { name: 'orders-role-abcd1234', path: '/service-role/' },
        ]),
      );
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(optionTexts('Existing role')).toEqual(['app-role', 'orders-role-abcd1234 /service-role/']);
    });
  });

  it('a first page with a marker: reaching the end of the options reads the next page with it; a page without one: nothing further', async () => {
    // A list taller than its box, so that the end is reached only by scrolling, as in a browser.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    engine.answerListRoles = ({ params }) =>
      params['Marker'] === undefined
        ? rolePage([{ name: 'first', path: '/' }], 'marker-2')
        : rolePage([{ name: 'second', path: '/' }]);
    await openForm();

    fireEvent.click(radio('Use another role'));
    selectOf('Existing role').openDropdown();
    await waitFor(() => {
      expect(optionTexts('Existing role')).toEqual(['first']);
    });
    expect(engine.sentOf('ListRoles')).toHaveLength(1);

    const list = selectOf('Existing role').findDropdown().findOptionsContainer()?.getElement() as HTMLElement;
    Object.defineProperty(list, 'scrollTop', { configurable: true, value: 900 });
    fireEvent.scroll(list);
    await waitFor(() => {
      expect(optionTexts('Existing role')).toEqual(['first', 'second']);
    });
    expect(engine.sentOf('ListRoles').map(({ params }) => params['Marker'])).toEqual([undefined, 'marker-2']);

    fireEvent.scroll(list);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(engine.sentOf('ListRoles')).toHaveLength(2);
  });

  it('no role in the emulator: "No roles" and the sentence of R9.4', async () => {
    await openForm();

    fireEvent.click(radio('Use another role'));
    selectOf('Existing role').openDropdown();
    await waitFor(() => {
      expect(dropdownStatus('Existing role')).toBe(
        'No roles This emulator holds no roles. Choose “Create default role”, or create one with any tool pointed at the emulator.',
      );
    });
    expect(optionTexts('Existing role')).toEqual([]);
  });

  it('the reading fails: "Reading the roles failed" with code and message, or "Not implemented by the emulator" on 501, with "Retry", which reads again', async () => {
    let answer: Answer = iamError(400, 'InvalidInput', 'IAM is broken');
    engine.answerListRoles = () => answer;
    await openForm();

    fireEvent.click(radio('Use another role'));
    selectOf('Existing role').openDropdown();
    await waitFor(() => {
      expect(dropdownStatus('Existing role')).toContain('Reading the roles failed. InvalidInput: IAM is broken');
    });
    expect(dropdownStatus('Existing role')).toContain('Retry');

    answer = iamError(501, 'NotImplemented', 'ListRoles is not implemented');
    const retry = within(selectOf('Existing role').findDropdown().getElement()).getByText('Retry');
    fireEvent.click(retry);
    await waitFor(() => {
      expect(dropdownStatus('Existing role')).toContain(
        'Not implemented by the emulator. The emulator answered 501 Not Implemented for ListRoles.',
      );
    });
    expect(engine.sentOf('ListRoles')).toHaveLength(2);

    answer = rolePage([{ name: 'app-role', path: '/' }]);
    fireEvent.click(within(selectOf('Existing role').findDropdown().getElement()).getByText('Retry'));
    await waitFor(() => {
      expect(optionTexts('Existing role')).toEqual(['app-role']);
    });
    expect(engine.sentOf('ListRoles')).toHaveLength(3);
  });
});

describe('the fields checked at "Create Event Function"', () => {
  it('an empty name: "Enter a function name." under the field, focus on it, no request', async () => {
    await openForm();

    press();
    await waitFor(() => {
      expect(messageOf('Function name')).toBe('Enter a function name.');
    });
    expect(document.activeElement).toBe(nameField());
    expect(engine.aws).toEqual([]);
  });

  it('65 characters: "The name can have up to 64 characters."; a space, a period, three spaces: "Use only letters, digits, hyphens (-) and underscores (_)."; no request for any', async () => {
    await openForm();

    const cases: [string, string][] = [
      ['a'.repeat(65), 'The name can have up to 64 characters.'],
      ['my function', 'Use only letters, digits, hyphens (-) and underscores (_).'],
      ['my.function', 'Use only letters, digits, hyphens (-) and underscores (_).'],
      ['   ', 'Use only letters, digits, hyphens (-) and underscores (_).'],
    ];
    for (const [name, message] of cases) {
      fireEvent.change(nameField(), { target: { value: name } });
      press();
      await waitFor(() => {
        expect(messageOf('Function name')).toBe(message);
      });
    }
    // 64 characters of the alphabet have no message.
    fireEvent.change(nameField(), { target: { value: 'a'.repeat(64) } });
    expect(messageOf('Function name')).toBeUndefined();
    expect(engine.aws).toEqual([]);
  });

  it('"Use another role" with no role chosen: "Choose a role." under "Existing role", no request; with the name also empty: both messages, focus on "Function name"', async () => {
    await openForm();

    fireEvent.click(radio('Use another role'));
    fireEvent.change(nameField(), { target: { value: 'orders' } });
    press();
    await waitFor(() => {
      expect(messageOf('Existing role')).toBe('Choose a role.');
    });
    expect(messageOf('Function name')).toBeUndefined();
    expect(engine.creating).toEqual([]);

    fireEvent.change(nameField(), { target: { value: '' } });
    press();
    await waitFor(() => {
      expect(messageOf('Function name')).toBe('Enter a function name.');
    });
    expect(messageOf('Existing role')).toBe('Choose a role.');
    expect(document.activeElement).toBe(nameField());
    expect(engine.creating).toEqual([]);
  });
});

describe('"Create Event Function" sent', () => {
  it('with "Create default role": CreateRole, AttachRolePolicy, CreateFunction in order; meanwhile the button is disabled and shows progress, focus stays, and a second press sends nothing', async () => {
    const createRole = held();
    engine.answerCreateRole = (request) => createRole.answer.then(() => engine.createRole(request));
    await openForm();

    fireEvent.change(nameField(), { target: { value: 'orders' } });
    chooseRuntime('Python 3.13');
    fireEvent.click(radio('arm64'));
    createButton().focus();
    press();
    await waitFor(() => {
      expect(engine.creating).toEqual(['CreateRole']);
    });
    expect(createButton()).toHaveAttribute('aria-disabled', 'true');
    expect(PAGE.findButton('[aria-disabled="true"]')?.findLoadingIndicator()).not.toBeNull();
    expect(document.activeElement).toBe(createButton());
    press();
    fireEvent.submit(createButton().closest('form') as HTMLFormElement);
    expect(engine.creating).toEqual(['CreateRole']);

    await act(async () => {
      createRole.release({ status: 200, body: '' });
      await Promise.resolve();
    });
    await screen.findByRole('heading', { level: 1, name: 'orders' });
    expect(engine.creating).toEqual(['CreateRole', 'AttachRolePolicy', 'CreateFunction']);

    const [role] = engine.sentOf('CreateRole');
    expect(String(role?.params['RoleName'])).toMatch(ROLE_NAME);
    expect(role?.params['Path']).toBe('/service-role/');
    expect(JSON.parse(String(role?.params['AssumeRolePolicyDocument']))).toEqual({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    });
    const [attach] = engine.sentOf('AttachRolePolicy');
    expect(attach?.params['RoleName']).toBe(role?.params['RoleName']);
    expect(attach?.params['PolicyArn']).toBe('arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole');
    const [fn] = engine.sentOf('CreateFunction');
    expect(Object.keys(fn?.params ?? {}).sort()).toEqual(
      ['Architectures', 'Code', 'FunctionName', 'Handler', 'Role', 'Runtime'].sort(),
    );
    expect(fn?.params).toMatchObject({
      FunctionName: 'orders',
      Runtime: 'python3.13',
      Architectures: ['arm64'],
      Role: `arn:aws:iam::${ACCOUNT}:role/service-role/${String(role?.params['RoleName'])}`,
      Handler: 'lambda_function.lambda_handler',
    });
    expect(Object.keys(fn?.params['Code'] as object)).toEqual(['ZipFile']);
  });

  it('CreateFunction answers 201: the function’s page with the Flashbar naming the function and the role; with an existing role the item ends after "emulator."', async () => {
    const first = await openForm();
    fireEvent.change(nameField(), { target: { value: 'orders' } });
    press();
    await screen.findByRole('heading', { level: 1, name: 'orders' });
    expect(first.router.state.location.pathname).toBe('/aws/lambda/functions/function/orders');
    const role = String(engine.sentOf('CreateRole')[0]?.params['RoleName']);
    await waitFor(() => {
      expect(flashTexts()).toEqual([
        `Function “orders” is being created in the local emulator, with the execution role “${role}”.`,
      ]);
    });
    first.unmount();

    engine.roles = [{ name: 'app-role', path: '/' }];
    await openForm();
    fireEvent.change(nameField(), { target: { value: 'reports' } });
    await chooseRole('app-role');
    press();
    await screen.findByRole('heading', { level: 1, name: 'reports' });
    await waitFor(() => {
      expect(flashTexts()).toEqual(['Function “reports” is being created in the local emulator.']);
    });
    expect(engine.sentOf('CreateRole')).toHaveLength(1);
    expect(engine.sentOf('CreateFunction')[1]?.params['Role']).toBe(`arn:aws:iam::${ACCOUNT}:role/app-role`);
    expect(engine.sentOf('CreateFunction')[1]?.params['Handler']).toBe('index.handler');
  });

  it('CreateFunction answers ResourceConflictException: the form stays with every value, the failure above the buttons, then the sentence about the role made', async () => {
    engine.functions.add('orders');
    await openForm();

    fireEvent.change(nameField(), { target: { value: 'orders' } });
    chooseRuntime('Node.js 22.x');
    fireEvent.click(radio('arm64'));
    press();
    await waitFor(() => {
      expect(failureText()).toContain('Creating the function failed');
    });
    const role = String(engine.sentOf('CreateRole')[0]?.params['RoleName']);
    expect(failureText()).toBe(
      `Creating the function failed ResourceConflictException: Function already exist: orders The role “${role}” was created in the local emulator and is still there.`,
    );
    expect(alertType(failureAlert()?.getElement())).toBe('error');
    expect(nameField().value).toBe('orders');
    expect(norm(selectOf('Runtime').findTrigger().getElement().textContent)).toBe('Node.js 22.x');
    expect(radio('arm64').checked).toBe(true);
    expect(radio('Create default role').checked).toBe(true);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create Event Function');
  });

  it('after that failure, again with the same name: no CreateRole; with the name changed: a new CreateRole', async () => {
    engine.functions.add('orders');
    await openForm();

    fireEvent.change(nameField(), { target: { value: 'orders' } });
    press();
    await waitFor(() => {
      expect(failureText()).toContain('Creating the function failed');
    });
    expect(engine.creating).toEqual(['CreateRole', 'AttachRolePolicy', 'CreateFunction']);
    const first = String(engine.sentOf('CreateRole')[0]?.params['RoleName']);

    press();
    await waitFor(() => {
      expect(engine.sentOf('CreateFunction')).toHaveLength(2);
    });
    expect(engine.creating).toEqual(['CreateRole', 'AttachRolePolicy', 'CreateFunction', 'CreateFunction']);
    expect(engine.sentOf('CreateFunction')[1]?.params['Role']).toBe(
      `arn:aws:iam::${ACCOUNT}:role/service-role/${first}`,
    );
    await waitFor(() => {
      expect(failureText()).toContain(`The role “${first}” was created in the local emulator and is still there.`);
    });

    fireEvent.change(nameField(), { target: { value: 'orders-2' } });
    press();
    await screen.findByRole('heading', { level: 1, name: 'orders-2' });
    expect(engine.sentOf('CreateRole')).toHaveLength(2);
    expect(String(engine.sentOf('CreateRole')[1]?.params['RoleName'])).toMatch(/^orders-2-role-[a-z0-9]{8}$/);
  });

  it('CreateRole fails: "Creating the role failed" with the code and message, and no sentence about a role', async () => {
    engine.answerCreateRole = () => iamError(409, 'EntityAlreadyExists', 'Role with name x already exists.');
    await openForm();

    fireEvent.change(nameField(), { target: { value: 'orders' } });
    press();
    await waitFor(() => {
      expect(failureText()).toBe('Creating the role failed EntityAlreadyExists: Role with name x already exists.');
    });
    expect(engine.creating).toEqual(['CreateRole']);
    expect(document.body.textContent).not.toContain('is still there');
  });

  it('CreateFunction answers 501: "Not implemented by the emulator" as information; AccessDenied: "Access denied" with "CreateFunction was refused: " and the message', async () => {
    engine.roles = [{ name: 'app-role', path: '/' }];
    let answer: Answer = lambdaError(501, 'NotImplemented', 'CreateFunction is not implemented');
    engine.answerCreateFunction = () => answer;
    await openForm();

    fireEvent.change(nameField(), { target: { value: 'orders' } });
    await chooseRole('app-role');
    press();
    await waitFor(() => {
      expect(failureText()).toBe(
        'Not implemented by the emulator The emulator answered 501 Not Implemented for CreateFunction.',
      );
    });
    expect(alertType(failureAlert()?.getElement())).toBe('info');

    answer = lambdaError(403, 'AccessDeniedException', 'not allowed here');
    press();
    await waitFor(() => {
      expect(failureText()).toBe('Access denied CreateFunction was refused: not allowed here');
    });
    expect(alertType(failureAlert()?.getElement())).toBe('error');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Issue 467: what the description says (R3), the name's rule before a submit (R4), "Cancel" asks (R7), a quoted name
// (R6).
// ---------------------------------------------------------------------------------------------------------------

const NAME_RULE = '1 to 64 characters: letters (A-Z, a-z), digits, hyphens (-) and underscores (_).';
const DISCARD_HEADING = 'Discard what you entered?';

/** The `h1`'s description: the text of the header that holds the `h1`, after the `h1`. */
function headerDescription(): string {
  const h1 = screen.getByRole('heading', { level: 1 });
  const header = PAGE.findAllHeaders().find((found) => found.getElement().contains(h1));
  return norm(header?.findDescription()?.getElement().textContent);
}

/** The constraint text under the field `label`; `undefined` when it shows none. */
function constraintOf(label: string): string | undefined {
  const constraint = formField(label)?.findConstraint();
  return constraint === null || constraint === undefined ? undefined : norm(constraint.getElement().textContent);
}

/** The dialog "Discard what you entered?" while it is shown, or `null`. */
function discardDialog(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: DISCARD_HEADING });
}

function cancelButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Cancel' });
}

/** "Cancel" on a form that differs: the dialog opens and the form stays. */
async function cancelAsks(): Promise<HTMLElement> {
  // As a press does: "Cancel" takes focus, then is clicked.
  cancelButton().focus();
  fireEvent.click(cancelButton());
  const dialog = await waitFor(() => {
    const found = discardDialog();
    expect(found, `the dialog "${DISCARD_HEADING}"`).not.toBeNull();
    return found as HTMLElement;
  });
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create Event Function');
  return dialog;
}

/** "Cancel" on a form that does not differ: the list at once, no dialog. */
async function cancelLeaves(router: { state: { location: { pathname: string } } }): Promise<void> {
  fireEvent.click(cancelButton());
  expect(discardDialog()).toBeNull();
  await screen.findByRole('heading', { level: 1, name: /^Event Functions/ });
  expect(router.state.location.pathname).toBe(LIST_PATH);
}

describe('issue 467', () => {
  it('the form as opened: the header has no description (issue 516 moved it to "Starter code"); under "Function name" its rule and no message', async () => {
    await openForm();

    expect(headerDescription()).toBe('');
    expect(screen.queryByText('The function is created with starter code that returns a greeting.')).toBeNull();
    expect(constraintOf('Function name')).toBe(NAME_RULE);
    expect(messageOf('Function name')).toBeUndefined();
  });

  it('"Create Event Function" with a name of 65 characters: the message about the length and the constraint text, both under the field', async () => {
    await openForm();

    fireEvent.change(nameField(), { target: { value: 'a'.repeat(65) } });
    press();
    await waitFor(() => {
      expect(messageOf('Function name')).toBe('The name can have up to 64 characters.');
    });
    expect(constraintOf('Function name')).toBe(NAME_RULE);
    expect(engine.aws).toEqual([]);
  });

  it('"Cancel" with nothing changed: the list, no dialog; opened with ?role=existing and nothing changed: the same', async () => {
    const first = await openForm();
    await cancelLeaves(first.router);
    first.unmount();

    const second = await openForm(`${CREATE_PATH}?role=existing`);
    expect(radio('Use another role').checked).toBe(true);
    await cancelLeaves(second.router);
  });

  it('a name typed, "Cancel": the dialog; "Keep editing": the form with the name, focus on "Cancel"; "Cancel", "Discard": the list, nothing created, the form opened again empty', async () => {
    const { router } = await openForm();

    fireEvent.change(nameField(), { target: { value: 'orders' } });
    const dialog = await cancelAsks();
    expect(within(dialog).getByText('What you entered on this page is not kept.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(discardDialog()).toBeNull();
    });
    expect(nameField().value).toBe('orders');
    await waitFor(() => {
      expect(document.activeElement).toBe(cancelButton());
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);

    const again = await cancelAsks();
    fireEvent.click(within(again).getByRole('button', { name: 'Discard' }));
    await screen.findByRole('heading', { level: 1, name: /^Event Functions/ });
    expect(router.state.location.pathname).toBe(LIST_PATH);
    expect(engine.creating).toEqual([]);
    expect(engine.iamRequests).toEqual([]);

    await act(async () => {
      await router.navigate(CREATE_PATH);
    });
    await screen.findByRole('heading', { level: 1, name: 'Create Event Function' });
    expect(nameField().value).toBe('');
    expect(radio('Create default role').checked).toBe(true);
  });

  it('a name typed and removed, "Cancel": the list, no dialog; arm64 chosen, "Cancel": the dialog; "Use another role" chosen, "Cancel": the dialog', async () => {
    const first = await openForm();
    fireEvent.change(nameField(), { target: { value: 'orders' } });
    fireEvent.change(nameField(), { target: { value: '' } });
    await cancelLeaves(first.router);
    first.unmount();

    const second = await openForm();
    fireEvent.click(radio('arm64'));
    await cancelAsks();
    second.unmount();

    await openForm();
    fireEvent.click(radio('Use another role'));
    await cancelAsks();
  });

  it('after a failed "Create Event Function" with a name still in the field, "Cancel": the dialog', async () => {
    engine.functions.add('orders');
    await openForm();

    fireEvent.change(nameField(), { target: { value: 'orders' } });
    press();
    await waitFor(() => {
      expect(failureText()).toContain('Creating the function failed');
    });
    await cancelAsks();
  });

  it('a create that fails after its role was made: in the sentence about the role, the role’s name is a name and the rest free text', async () => {
    engine.functions.add('orders');
    await openForm();

    fireEvent.change(nameField(), { target: { value: 'orders' } });
    press();
    await waitFor(() => {
      expect(failureText()).toContain('is still there.');
    });
    const role = String(engine.sentOf('CreateRole')[0]?.params['RoleName']);
    const alert = failureAlert()?.getElement();
    const names = [...(alert?.querySelectorAll('.aws-area-value-name') ?? [])].map((found) => found.textContent);
    expect(names).toEqual([role]);
    const texts = [...(alert?.querySelectorAll('.aws-area-value-text') ?? [])].map((found) => found.textContent);
    expect(texts).toEqual(['The role “', '” was created in the local emulator and is still there.']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Issue 516, unit s4 (test-criteria.md, "Unit s4 — providers/aws/area/services/lambda/pages/create-function-page.test.tsx"):
// the choice of the code on the create form.
// ---------------------------------------------------------------------------------------------------------------

/** A .zip archive the user chose: Studio's own writer makes a real one. */
function zipFile(name = 'app.zip'): File {
  return new File([new Uint8Array(storedZip('app.py', 'def handler(event, context):\n    return 1\n'))], name);
}

/** The base64 of `bytes`, as the SDK sends `Code.ZipFile` in the JSON body. */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The radios of "Code": each one's label and description, in order. */
function codeChoices(): string[] {
  const group = screen.getByRole('radiogroup', { name: 'Code' });
  return within(group)
    .getAllByRole('radio')
    .map((input) => textOf(input.closest('[class*="radio"]')?.parentElement ?? input.parentElement));
}

/** Chooses `file` in "File", as a user's pick does. */
function chooseFile(file: File): void {
  const upload = formField('File')?.findControl()?.findFileUpload() ?? null;
  if (upload === null) throw new Error('No file field "File"');
  const input = upload.findNativeInput().getElement();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

function handlerField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Handler' }) as HTMLInputElement;
}

/** The message under "File", read as a reader meets it. */
function fileMessage(): string {
  return textOf(formField('File')?.findError()?.getElement());
}

/**
 * "Create Event Function" with "Upload a .zip file": the press, then the wait while the form reads the file (the zip
 * check and the bytes are read asynchronously by the browser's `File`), before anything is read off the page.
 */
async function pressWithFile(): Promise<void> {
  press();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

describe('issue 516: the code of a new function', () => {
  it('as opened: "Code" on "Starter code" with its description; no "File" and no "Handler"; the runtime’s description; ten runtimes', async () => {
    await openForm();

    expect(screen.getByRole('heading', { level: 2, name: 'Code' })).toBeInTheDocument();
    expect(radio('Starter code').checked).toBe(true);
    expect(radio('Upload a .zip file').checked).toBe(false);
    expect(codeChoices()).toEqual([
      'Starter code A handler that returns a greeting.',
      'Upload a .zip file Your own code and its handler.',
    ]);
    expect(formField('File')).toBeUndefined();
    expect(formField('Handler')).toBeUndefined();
    expect(norm(formField('Runtime')?.findDescription()?.getElement().textContent)).toBe(
      'The emulator runs Node.js and Python code only.',
    );
    selectOf('Runtime').openDropdown();
    expect(optionTexts('Runtime')).toHaveLength(10);
  });

  it('"Upload a .zip file": "File" with "One .zip file." and "Handler", empty, with its constraint text', async () => {
    await openForm();

    fireEvent.click(radio('Upload a .zip file'));
    expect(formField('File')).toBeDefined();
    expect(constraintOf('File')).toBe('One .zip file.');
    expect(handlerField().value).toBe('');
    expect(constraintOf('Handler')).toBe('1 to 128 characters, no spaces.');
    expect(messageOf('File')).toBeUndefined();
    expect(messageOf('Handler')).toBeUndefined();
  });

  it('"Create Event Function" with "Upload a .zip file": no file, a file that is no archive, no handler: each its message, nothing sent, no role created', async () => {
    await openForm();
    fireEvent.change(nameField(), { target: { value: 'orders' } });
    fireEvent.click(radio('Upload a .zip file'));

    await pressWithFile();
    await waitFor(() => {
      expect(messageOf('File')).toBe('Choose a .zip file.');
    });
    expect(messageOf('Handler')).toBe('Enter a handler.');
    expect(engine.aws).toEqual([]);

    chooseFile(new File(['just some text'], 'notes.zip'));
    await pressWithFile();
    await waitFor(() => {
      expect(fileMessage()).toBe('notes.zip is not a .zip archive.');
    });
    expect(engine.aws).toEqual([]);

    chooseFile(zipFile());
    await pressWithFile();
    await waitFor(() => {
      expect(messageOf('File')).toBeUndefined();
    });
    expect(messageOf('Handler')).toBe('Enter a handler.');
    await act(async () => {
      await Promise.resolve();
    });
    expect(engine.aws).toEqual([]);
    expect(engine.roles).toEqual([]);

    fireEvent.change(handlerField(), { target: { value: 'app handler' } });
    await pressWithFile();
    await waitFor(() => {
      expect(messageOf('Handler')).toBe('The handler cannot contain spaces.');
    });
    fireEvent.change(handlerField(), { target: { value: 'a'.repeat(129) } });
    expect(messageOf('Handler')).toBe('The handler can have up to 128 characters.');
    expect(engine.aws).toEqual([]);
  });

  it('a file and a handler: the role first with the default role, then the function with the file’s bytes and the handler typed; then the function’s page', async () => {
    const file = zipFile();
    const { router } = await openForm();
    fireEvent.change(nameField(), { target: { value: 'orders' } });
    fireEvent.click(radio('Upload a .zip file'));
    chooseFile(file);
    fireEvent.change(handlerField(), { target: { value: 'app.handler' } });

    await pressWithFile();
    await screen.findByRole('heading', { level: 1, name: 'orders' });
    expect(router.state.location.pathname).toBe('/aws/lambda/functions/function/orders');
    expect(engine.creating).toEqual(['CreateRole', 'AttachRolePolicy', 'CreateFunction']);
    const sent = engine.sentOf('CreateFunction')[0]?.params;
    expect(sent?.['Handler']).toBe('app.handler');
    expect(sent?.['Code']).toEqual({ ZipFile: base64(new Uint8Array(await file.arrayBuffer())) });
  });

  it('back on "Starter code" after choosing a file and a handler: created with the starter code and its handler; the file is not sent', async () => {
    await openForm();
    fireEvent.change(nameField(), { target: { value: 'orders' } });
    chooseRuntime('Python 3.12');
    fireEvent.click(radio('Upload a .zip file'));
    chooseFile(zipFile());
    fireEvent.change(handlerField(), { target: { value: 'app.handler' } });
    fireEvent.click(radio('Starter code'));
    expect(formField('File')).toBeUndefined();

    await pressWithFile();
    await screen.findByRole('heading', { level: 1, name: 'orders' });
    const starter = starterCode('python3.12');
    if (starter === undefined) throw new Error('No starter code for python3.12');
    const sent = engine.sentOf('CreateFunction')[0]?.params;
    expect(sent?.['Handler']).toBe('lambda_function.lambda_handler');
    expect(sent?.['Code']).toEqual({ ZipFile: base64(storedZip(starter.fileName, starter.text)) });
  });

  it('a 413: "The emulator refused {file} as too large." under "File" beside the status, the form as filled', async () => {
    engine.answerCreateFunction = () => ({ status: 413, body: '' });
    await openForm();
    fireEvent.change(nameField(), { target: { value: 'orders' } });
    fireEvent.click(radio('Upload a .zip file'));
    chooseFile(zipFile('big.zip'));
    fireEvent.change(handlerField(), { target: { value: 'app.handler' } });

    await pressWithFile();
    await waitFor(() => {
      expect(fileMessage()).toMatch(/^The emulator refused big\.zip as too large\. HTTP 413/);
    });
    expect(failureAlert()?.getElement().textContent ?? '').not.toContain('Creating the function failed');
    expect(nameField().value).toBe('orders');
    expect(radio('Upload a .zip file').checked).toBe(true);
    expect(handlerField().value).toBe('app.handler');
    expect(textOf(formField('File')?.findControl()?.getElement())).toContain('big.zip');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create Event Function');
  });

  it('"Cancel" after only the code choice, the file or the handler changed: the discard dialog', async () => {
    const first = await openForm();
    fireEvent.click(radio('Upload a .zip file'));
    await cancelAsks();
    first.unmount();

    const second = await openForm();
    fireEvent.click(radio('Upload a .zip file'));
    chooseFile(zipFile());
    fireEvent.click(radio('Starter code'));
    await cancelAsks();
    second.unmount();

    await openForm();
    fireEvent.click(radio('Upload a .zip file'));
    fireEvent.change(handlerField(), { target: { value: 'app.handler' } });
    fireEvent.click(radio('Starter code'));
    await cancelAsks();
    expect(engine.aws).toEqual([]);
  });
});
