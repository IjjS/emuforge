import Flashbar from '@cloudscape-design/components/flashbar';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import AwsArea from '../../../index';
import type { CodeTabProps } from '../components/code-tab';
import type { ConfigurationTabProps } from '../components/configuration-tab';
import type { TestTabProps } from '../components/test-tab';
import type { FunctionTab } from '../format';
import { FunctionPage } from './function-page';

// A function's page rendered inside the area's layout, as Studio's frame renders the area, against a fake engine
// behind the page's `fetch` (test-criteria.md, issue 84, "Unit — services/lambda/pages/function-page.test.tsx";
// issue 516, "Unit s1 — pages/function-page.test.tsx"). The three tabs are stand-ins of this file: the page is read
// for what it hands them, never for their markup, which `components/*-tab.test.tsx` read.

// ---------------------------------------------------------------------------------------------------------------
// The tabs' stand-ins.
// ---------------------------------------------------------------------------------------------------------------

/** What each tab was handed at its last render. */
const handed = vi.hoisted(() => ({
  test: undefined as TestTabProps | undefined,
  renderTest: false,
  code: undefined as CodeTabProps | undefined,
  configuration: undefined as ConfigurationTabProps | undefined,
}));

vi.mock('../components/test-tab', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/test-tab')>();
  return {
    ...actual,
    TestTab: (props: TestTabProps) => {
      handed.test = props;
      if (handed.renderTest) {
        return <actual.TestTab {...props} />;
      }
      return (
        <div data-testid="stand-in-test">
          <button
            type="button"
            onClick={() => {
              props.onEventTextChange('{"tag": "kept"}');
            }}
          >
            Stand-in type event
          </button>
          <button
            type="button"
            onClick={() => {
              props.invoke.mutate(props.eventText);
            }}
          >
            Stand-in invoke
          </button>
        </div>
      );
    },
  };
});

vi.mock('../components/code-tab', () => ({
  CodeTab: (props: CodeTabProps) => {
    handed.code = props;
    return <div data-testid="stand-in-code" />;
  },
}));

vi.mock('../components/configuration-tab', () => ({
  ConfigurationTab: (props: ConfigurationTabProps) => {
    handed.configuration = props;
    return <div data-testid="stand-in-configuration" />;
  },
}));

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

/** One answer of `GetFunction` for a function: its state and last update. */
interface Moment {
  state: string;
  stateReason?: string;
  lastUpdateStatus?: string;
  lastUpdateStatusReason?: string;
}

interface FakeFunction {
  name: string;
  description?: string;
  runtime?: string;
  handler?: string;
  architectures?: string[];
  lastModified?: string;
  /** The answers of `GetFunction` in turn; the last one stays. */
  moments?: Moment[];
  /** Its function URL; none when absent. */
  url?: string;
  environment?: Record<string, string>;
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

interface MonitoringRequest {
  operation: string;
  body: { MetricName?: string; StartTime?: number; EndTime?: number; nextToken?: string };
}

const FUNCTION_PATH = /^\/2015-03-31\/functions\/([^/]+)$/;
const URL_PATH = /^\/2021-10-31\/functions\/([^/]+)\/url$/;
const RELEASE_PATH = /^\/2015-03-31\/functions\/([^/]+)\/(versions|aliases)$/;
const INVOKE_PATH = /^\/2015-03-31\/functions\/([^/]+)\/invocations$/;

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

const SIGNED_CODE_URL = 'https://127.0.0.1:9305/code/orders.zip?X-Amz-Signature=signed-code-location';
const ACCOUNT_ARN = 'arn:aws:lambda:us-east-1:000000000000:function';

class FakeEngine {
  /** The functions the emulator holds. */
  functions: FakeFunction[] = [];
  /** Every AWS request, as sent. */
  readonly aws: SentRequest[] = [];
  readonly monitoring: MonitoringRequest[] = [];
  answerMonitoring: (request: MonitoringRequest) => Answer | Promise<Answer> = ({ operation }) =>
    json(200, operation === 'FilterLogEvents' ? { events: [] } : { Datapoints: [] });
  /** The answer to `GetFunction`; by default the emulator's. */
  answerFunction: (request: SentRequest) => EngineAnswer = (request) => this.emulator(request);
  answerInvoke: (request: SentRequest) => EngineAnswer = (request) => this.emulator(request);
  answerDelete: (request: SentRequest) => Answer | Promise<Answer> = (request) => this.emulator(request);
  answerRelease: (request: SentRequest) => Answer | Promise<Answer> = ({ method, url }) => {
    if (method === 'POST') {
      return json(201, { Version: '1' });
    }
    return json(200, url.pathname.endsWith('/versions') ? { Versions: [{ Version: '$LATEST' }] } : { Aliases: [] });
  };
  /** The invocations answered so far. */
  invocations = 0;
  /** The answer to `GetFunctionUrlConfig`; by default the emulator's. */
  answerUrl: (request: SentRequest) => EngineAnswer = (request) => this.emulator(request);

  private find(pattern: RegExp, url: URL): FakeFunction | undefined {
    const name = decodeURIComponent(pattern.exec(url.pathname)?.[1] ?? '');
    return this.functions.find((fn) => fn.name === name);
  }

  /** `GetFunction` and `GetFunctionUrlConfig`, as the emulator answers them. */
  emulator({ method, url }: SentRequest): Answer {
    if (method === 'GET' && FUNCTION_PATH.test(url.pathname)) {
      const fn = this.find(FUNCTION_PATH, url);
      if (fn === undefined) {
        const name = decodeURIComponent(FUNCTION_PATH.exec(url.pathname)?.[1] ?? '');
        return errorAnswer(404, 'ResourceNotFoundException', `Function not found: ${ACCOUNT_ARN}:${name}`);
      }
      const moments = fn.moments ?? [{ state: 'Active', lastUpdateStatus: 'Successful' }];
      const moment = moments.length > 1 ? (moments.shift() as Moment) : (moments[0] as Moment);
      return json(200, {
        Configuration: {
          FunctionName: fn.name,
          FunctionArn: `${ACCOUNT_ARN}:${fn.name}`,
          Description: fn.description ?? '',
          PackageType: 'Zip',
          ...(fn.runtime === undefined ? {} : { Runtime: fn.runtime }),
          ...(fn.handler === undefined ? {} : { Handler: fn.handler }),
          ...(fn.architectures === undefined ? {} : { Architectures: fn.architectures }),
          ...(fn.lastModified === undefined ? {} : { LastModified: fn.lastModified }),
          ...(fn.environment === undefined ? {} : { Environment: { Variables: fn.environment } }),
          State: moment.state,
          ...(moment.stateReason === undefined ? {} : { StateReason: moment.stateReason }),
          ...(moment.lastUpdateStatus === undefined ? {} : { LastUpdateStatus: moment.lastUpdateStatus }),
          ...(moment.lastUpdateStatusReason === undefined
            ? {}
            : { LastUpdateStatusReason: moment.lastUpdateStatusReason }),
        },
        Code: { RepositoryType: 'S3', Location: SIGNED_CODE_URL },
      });
    }
    if (method === 'DELETE' && FUNCTION_PATH.test(url.pathname)) {
      const fn = this.find(FUNCTION_PATH, url);
      if (fn === undefined) {
        const name = decodeURIComponent(FUNCTION_PATH.exec(url.pathname)?.[1] ?? '');
        return errorAnswer(404, 'ResourceNotFoundException', `Function not found: ${ACCOUNT_ARN}:${name}`);
      }
      this.functions = this.functions.filter((other) => other !== fn);
      return { status: 204, body: '' };
    }
    const invocation = INVOKE_PATH.exec(url.pathname);
    if (method === 'POST' && invocation !== null) {
      const name = decodeURIComponent(invocation[1] ?? '');
      if (!this.functions.some((fn) => fn.name === name)) {
        return errorAnswer(404, 'ResourceNotFoundException', `Function not found: ${ACCOUNT_ARN}:${name}`);
      }
      this.invocations += 1;
      return json(200, { invocation: this.invocations });
    }
    if (method === 'GET' && URL_PATH.test(url.pathname)) {
      const fn = this.find(URL_PATH, url);
      if (fn?.url === undefined) {
        return errorAnswer(404, 'ResourceNotFoundException', 'The resource you requested does not exist.');
      }
      return json(200, {
        FunctionUrl: fn.url,
        FunctionArn: `${ACCOUNT_ARN}:${fn.name}`,
        AuthType: 'NONE',
        CreationTime: '2026-11-17T02:22:16.474+0000',
        LastModifiedTime: '2026-11-17T02:22:16.474+0000',
      });
    }
    return errorAnswer(400, 'UnexpectedRequest', `${method} ${url.pathname}`);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-84' }), { status: 200 });
    }
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1);
    if (operation === 'FilterLogEvents' || operation === 'GetMetricStatistics') {
      const sent = { operation, body: (await request.json()) as MonitoringRequest['body'] };
      this.monitoring.push(sent);
      // Let old responses settle even if their observer is gone.
      const answer = await this.answerMonitoring(sent);
      return new Response(answer.body, { status: answer.status, headers: answer.headers ?? {} });
    }
    const sent = { method: request.method, url };
    this.aws.push(sent);
    if (RELEASE_PATH.test(url.pathname)) {
      const answer = await this.answerRelease(sent);
      return new Response(answer.body, { status: answer.status, headers: answer.headers ?? {} });
    }
    if (INVOKE_PATH.test(url.pathname)) {
      const answer = await this.answerInvoke(sent);
      if (answer === 'network-error') {
        throw new TypeError('Failed to fetch');
      }
      return new Response(answer.body, { status: answer.status, headers: answer.headers ?? {} });
    }
    if (sent.method === 'DELETE' && FUNCTION_PATH.test(url.pathname)) {
      const answer = await this.answerDelete(sent);
      return new Response(answer.status === 204 ? null : answer.body, {
        status: answer.status,
        headers: answer.headers ?? {},
      });
    }
    const answer = await Promise.race([
      Promise.resolve(URL_PATH.test(url.pathname) ? this.answerUrl(sent) : this.answerFunction(sent)),
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

  /** The `GetFunction` requests sent so far. */
  get gets(): URL[] {
    return this.aws.filter(({ method, url }) => method === 'GET' && FUNCTION_PATH.test(url.pathname)).map((r) => r.url);
  }

  /** The `GetFunctionUrlConfig` requests sent so far. */
  get urlGets(): URL[] {
    return this.aws.filter(({ method, url }) => method === 'GET' && URL_PATH.test(url.pathname)).map((r) => r.url);
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
let nextPort = 9060;
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
  handed.test = undefined;
  handed.renderTest = false;
  handed.code = undefined;
  handed.configuration = undefined;
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

function pagePath(name: string): string {
  return `/aws/lambda/functions/function/${name}`;
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
  return { ...result, router, client };
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function headingText(): string {
  return norm(screen.getByRole('heading', { level: 1 }).textContent);
}

function overview() {
  const container = PAGE.findAllContainers()[0];
  if (!container) {
    throw new Error('Expected the function overview container');
  }
  expect(container.findHeader()?.findHeader()?.findHeadingText().getElement()).toHaveTextContent('Function overview');
  return container;
}

/** The overview's key-value pairs as label and value text, in order. */
function pairs(): [string, string][] {
  const found = overview().findContent().findKeyValuePairs();
  expect(found).toBeTruthy();
  return (found?.findItems() ?? []).map((item) => [
    norm(item.findLabel()?.getElement().textContent),
    norm(item.findValue()?.getElement().textContent),
  ]);
}

function value(label: string): string | undefined {
  return pairs().find(([key]) => key === label)?.[1];
}

function tabs() {
  return PAGE.findTabs();
}

function tabLabels(): string[] {
  return (tabs()?.findTabLinks() ?? []).map((tab) => norm(tab.getElement().textContent));
}

function activeTab(): string {
  return norm(tabs()?.findActiveTab()?.getElement().textContent);
}

function tabLink(id: FunctionTab): HTMLElement {
  const labels: Record<FunctionTab, string> = {
    test: 'Test',
    code: 'Code',
    monitor: 'Monitor',
    configuration: 'Configuration',
    versions: 'Versions and aliases',
  };
  const tab = tabs()?.findTabLinkById(id)?.getElement();
  if (!tab) {
    throw new Error(`Expected the ${id} tab`);
  }
  expect(tab).toHaveTextContent(labels[id]);
  return tab;
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

/** The status indicator inside `element`: its Cloudscape type and its text. */
function statusIn(element: Element | null | undefined): { type: string | null; text: string } {
  const indicator = [...(element?.querySelectorAll('[class*="status-"]') ?? [])].find((found) =>
    [...found.classList].some((name) => /^awsui_status-[a-z-]+_/.test(name)),
  );
  const type = [...(indicator?.classList ?? [])]
    .map((name) => /^awsui_status-([a-z-]+?)_/.exec(name)?.[1])
    .find((found) => found !== undefined);
  return { type: type ?? null, text: norm(indicator?.textContent) };
}

/** The header of the page, which holds the `h1`, its description and the status line. */
function header(): HTMLElement {
  const h1 = screen.getByRole('heading', { level: 1 });
  const found = PAGE.findAllHeaders().find((candidate) => candidate.getElement().contains(h1));
  expect(found).toBeDefined();
  return (found as NonNullable<typeof found>).getElement();
}

function pageActions() {
  const pageHeader = PAGE.findAllHeaders().find((candidate) => candidate.findHeadingText().getElement().closest('h1'));
  return pageHeader?.findActions()?.findAllButtons() ?? [];
}

/** The `h1`'s description element, or `null` when the `h1` has none. */
function descriptionElement(): HTMLElement | null {
  return (
    PAGE.findAllHeaders()
      .find((h) => h.getElement() === header())
      ?.findDescription()
      ?.getElement() ?? null
  );
}

function description(): string {
  return norm(descriptionElement()?.textContent);
}

const ORDERS: FakeFunction = {
  name: 'orders',
  description: 'Takes the orders',
  runtime: 'nodejs22.x',
  handler: 'index.handler',
  architectures: ['arm64'],
  lastModified: '2026-11-17T02:22:16.474+0000',
  url: 'https://abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-1.on.aws/',
  environment: { SECRET: 'orders-secret-value' },
};

function withoutUrl(fn: FakeFunction): FakeFunction {
  const copy = { ...fn };
  delete copy.url;
  return copy;
}

async function openLoaded(fn: FakeFunction = ORDERS) {
  engine.functions = [fn];
  const opened = open(pagePath(fn.name));
  await screen.findByRole('heading', { level: 2, name: 'Function overview' });
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------

describe('a function loaded', () => {
  it('the h1 its name, "Refresh", "Delete", "Function overview" with its fields in order, and the tabs "Test", "Code", "Monitor", "Configuration", "Versions and aliases" and no other, "Test" selected', async () => {
    await openLoaded();

    expect(headingText()).toBe('orders');
    expect(within(header()).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(within(header()).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(tabLabels()).toEqual(['Test', 'Code', 'Monitor', 'Configuration', 'Versions and aliases']);
    expect(activeTab()).toBe('Test');
    expect(pairs().map(([label]) => label)).toEqual(['Description', 'Last modified', 'Function ARN', 'Function URL']);
    expect(value('Description')).toBe('Takes the orders');
    expect(value('Last modified')).toMatch(/^November \d{1,2}, 2026, \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
    expect(value('Function ARN')).toBe(`${ACCOUNT_ARN}:orders`);
    expect(tabs()?.findTabContent()?.getElement()).toContainElement(screen.getByTestId('stand-in-test'));
    expect(screen.queryByRole('heading', { name: 'Code source' })).toBeNull();
  });

  it('the crumbs EmuForge, AWS, Lambda, Event Functions (to the list), the name; the title the name; the notice for functions', async () => {
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
      ['Event Functions', '/aws/lambda/functions'],
      ['orders', null],
    ]);
    // Studio's frame writes it as "orders | EmuForge Studio" (app/routes.test.tsx).
    expect(titles.at(-1)).toBe('orders');
    expect(screen.getByText('These functions are in your local emulator')).toBeInTheDocument();
    expect(PAGE.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute('href', '/aws/lambda/functions');
  });

  it('"Function URL": the URL as text and not a link; "-" without one; "Not read" when it failed; "Not implemented by the emulator" on 501; the other values shown each time', async () => {
    const first = await openLoaded();
    expect(value('Function URL')).toBe(ORDERS.url);
    expect(within(overview().getElement()).queryByRole('link')).toBeNull();
    first.unmount();

    const second = await openLoaded(withoutUrl(ORDERS));
    expect(value('Function URL')).toBe('-');
    second.unmount();

    engine.answerUrl = () => errorAnswer(500, 'ServiceException', 'broken');
    const third = await openLoaded();
    // The one status indicator of the section is the URL's.
    expect(statusIn(overview().getElement())).toEqual({ type: 'warning', text: 'Not read' });
    expect(value('Function URL')).toBe('Not read');
    expect(value('Function ARN')).toBe(`${ACCOUNT_ARN}:orders`);
    third.unmount();

    engine.answerUrl = () => errorAnswer(501, 'NotImplemented', 'GetFunctionUrlConfig is not implemented');
    await openLoaded();
    expect(value('Function URL')).toBe('Not implemented by the emulator');
    expect(value('Description')).toBe('Takes the orders');
  });

  it('the page as it opens, on "Test", shows neither the signed URL of the code nor an environment variable of the answer', async () => {
    await openLoaded();

    expect(document.body.textContent).not.toContain('X-Amz-Signature');
    expect(document.body.textContent).not.toContain('signed-code-location');
    expect(document.body.textContent).not.toContain('orders-secret-value');
    expect(document.body.textContent).not.toContain('SECRET');
  });

  it('a description `<b id="injected">x</b>` is shown as that text, no element made from it', async () => {
    await openLoaded({ ...ORDERS, description: '<b id="injected">x</b>' });

    expect(value('Description')).toBe('<b id="injected">x</b>');
    expect(document.getElementById('injected')).toBeNull();
  });
});

describe('the status line', () => {
  it('State Active, last update Successful: no status under the description', async () => {
    await openLoaded();

    // Without a status the `h1` has no description (issue 467, R3).
    expect(descriptionElement()).toBeNull();
    expect(statusIn(header()).type).toBeNull();
  });

  it('State Pending: "Being created"; the next answer Active: the status is gone and "Function ready" is announced once', async () => {
    const said = recordAnnouncements();
    await openLoaded({
      ...ORDERS,
      moments: [{ state: 'Pending', stateReason: 'The function is being created.' }, { state: 'Active' }],
    });

    expect(statusIn(header())).toEqual({ type: 'in-progress', text: 'Being created' });
    // Read again by itself, one second after the answer.
    await waitFor(
      () => {
        expect(statusIn(header()).type).toBeNull();
      },
      { timeout: 3000 },
    );
    expect(engine.gets).toHaveLength(2);
    await waitFor(() => {
      expect(said).toContain('Function ready');
    });
    expect(said.filter((text) => text === 'Function ready')).toHaveLength(1);
    expect(said).not.toContain('Being created');
  });

  it('Failed with a reason, Inactive with a reason, Active updating, Active with a failed update and its reason', async () => {
    const cases: [Moment, { type: string; text: string }, string | undefined][] = [
      [
        { state: 'Failed', stateReason: 'The <code> could not start' },
        { type: 'error', text: 'Failed' },
        'The <code> could not start',
      ],
      [
        { state: 'Inactive', stateReason: 'Idle for a long time' },
        { type: 'stopped', text: 'Inactive' },
        'Idle for a long time',
      ],
      [{ state: 'Active', lastUpdateStatus: 'InProgress' }, { type: 'in-progress', text: 'Being updated' }, undefined],
      [
        { state: 'Active', lastUpdateStatus: 'Failed', lastUpdateStatusReason: 'Update refused' },
        { type: 'error', text: 'Last update failed' },
        'Update refused',
      ],
    ];
    for (const [moment, status, reason] of cases) {
      // Repeated, so a re-reading of a function being updated answers the same.
      const opened = await openLoaded({ ...ORDERS, moments: [moment] });
      expect(statusIn(header())).toEqual(status);
      // The status line is the `h1`'s description alone (issue 467, R3), its reason after it as text.
      expect(description()).toBe(`${status.text}${reason === undefined ? '' : ` ${reason}`}`);
      opened.unmount();
    }
  });
});

describe('"Refresh"', () => {
  it('sends GetFunction and GetFunctionUrlConfig again and announces "Function refreshed" once', async () => {
    const said = recordAnnouncements();
    await openLoaded();
    expect(engine.gets).toHaveLength(1);
    expect(engine.urlGets).toHaveLength(1);

    const fn = engine.functions[0] as FakeFunction;
    fn.description = 'Takes more orders';
    fireEvent.click(within(header()).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(value('Description')).toBe('Takes more orders');
    });
    expect(engine.gets).toHaveLength(2);
    expect(engine.urlGets).toHaveLength(2);
    await waitFor(() => {
      expect(said).toContain('Function refreshed');
    });
    expect(said.filter((text) => text === 'Function refreshed')).toHaveLength(1);
  });
  it('"Refresh" while "Being created", answered Active: one announcement says the page was refreshed and that the function is ready', async () => {
    const said = recordAnnouncements();
    await openLoaded({ ...ORDERS, moments: [{ state: 'Pending' }, { state: 'Active' }] });
    expect(statusIn(header())).toEqual({ type: 'in-progress', text: 'Being created' });

    fireEvent.click(within(header()).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(statusIn(header()).type).toBeNull();
    });
    await waitFor(() => {
      expect(said).toContain('Function refreshed. Function ready');
    });
    expect(said.filter((text) => text.includes('Function ready'))).toHaveLength(1);
    expect(said.filter((text) => text.includes('Function refreshed'))).toHaveLength(1);
  });
});

describe('a function the emulator does not hold', () => {
  it('ResourceNotFoundException: the h1 the name, "Function not found", its sentence and the link "Event Functions"; no tabs and no section', async () => {
    const { router } = open(pagePath('gone'));

    await screen.findByText('Function not found');
    expect(headingText()).toBe('gone');
    const content = PAGE.findAllContainers().find((found) =>
      found.getElement().textContent.includes('Function not found'),
    );
    expect(content?.getElement()).toHaveTextContent(
      'The emulator holds no function named “gone”. It may have been deleted, or the emulator restarted.',
    );
    expect(tabs()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Function overview' })).toBeNull();
    expect(screen.queryByTestId('stand-in-code')).toBeNull();
    // The content's link, not the crumb's or the side navigation's.
    const link = within(content?.getElement() as HTMLElement).getByRole('link', { name: 'Event Functions' });
    expect(link).toHaveAttribute('href', '/aws/lambda/functions');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/lambda/functions');
    });
  });

  it('a path segment that is not valid percent-encoding: the area’s "Page not found"', async () => {
    open('/aws/lambda/functions/function/%E0%A4%A');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(engine.gets).toHaveLength(0);
  });
});

describe('loading and failure states', () => {
  async function openFailing(answer: EngineAnswer) {
    engine.answerFunction = () => answer;
    const opened = open(pagePath('orders'));
    await screen.findByRole('button', { name: 'Retry' });
    return opened;
  }

  /** The content below the header: the container of the state. */
  function stateContainer(): HTMLElement {
    const retry = screen.getByRole('button', { name: 'Retry' });
    const container = PAGE.findAllContainers().find((found) => found.getElement().contains(retry));
    expect(container).toBeDefined();
    return (container as NonNullable<typeof container>).getElement();
  }

  it('while the answer is awaited: "Loading function", the h1 the name', async () => {
    engine.answerFunction = () => new Promise<Answer>(() => undefined);
    open(pagePath('orders'));

    expect(await screen.findByText('Loading function')).toBeInTheDocument();
    expect(headingText()).toBe('orders');
    expect(tabs()).toBeNull();
  });

  it('GetFunction answers 501: "Not implemented by the emulator" naming GetFunction and the function, as information, with "Retry"', async () => {
    await openFailing(errorAnswer(501, 'NotImplemented', 'GetFunction is not implemented'));

    expect(statusIn(stateContainer())).toEqual({ type: 'info', text: 'Not implemented by the emulator' });
    expect(stateContainer()).toHaveTextContent(
      'The emulator answered 501 Not Implemented for GetFunction, so Studio cannot show the function.',
    );
    expect(tabs()).toBeNull();
  });

  it('AccessDenied: "Access denied" with the message', async () => {
    await openFailing(errorAnswer(403, 'AccessDeniedException', 'not allowed to read orders'));

    expect(statusIn(stateContainer())).toEqual({ type: 'error', text: 'Access denied' });
    expect(stateContainer()).toHaveTextContent('GetFunction was refused: not allowed to read orders');
  });

  it('the read fails while not connected: the line’s status, "The function could not be read.", "Connection status", "Retry"', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(errorAnswer(503, 'EmulatorUnavailable', 'the emulator refused the connection'));

    expect(statusIn(stateContainer())).toEqual({
      type: 'stopped',
      text: `Not started on port ${String(EMULATOR_PORT)}`,
    });
    expect(stateContainer()).toHaveTextContent('The function could not be read.');
    expect(within(stateContainer()).getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
  });

  it('a failure is announced once with its first line; "Retry" reads again and shows the function', async () => {
    const said = recordAnnouncements();
    await openFailing(errorAnswer(500, 'ServiceException', 'broken'));

    expect(statusIn(stateContainer())).toEqual({ type: 'error', text: 'The function could not be read' });
    await waitFor(() => {
      expect(said).toContain('The function could not be read');
    });
    expect(said.filter((text) => text === 'The function could not be read')).toHaveLength(1);

    const sent = engine.gets.length;
    engine.functions = [ORDERS];
    engine.answerFunction = (request) => engine.emulator(request);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { level: 2, name: 'Function overview' });
    expect(engine.gets).toHaveLength(sent + 1);
  });

  it('a failed read is read again by itself once the connection is connected again', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(errorAnswer(503, 'EmulatorUnavailable', 'the emulator refused the connection'));

    engine.functions = [ORDERS];
    engine.answerFunction = (request) => engine.emulator(request);
    connection.set(connectedResult());
    await screen.findByRole('heading', { level: 2, name: 'Function overview' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Issue 467: the `h1`'s description (R3), the copy controls (R5), each value as its kind (R6).
// ---------------------------------------------------------------------------------------------------------------

/** The value element of the overview pair `label`. */
function valueElement(label: string): HTMLElement {
  const item = (overview().findContent().findKeyValuePairs()?.findItems() ?? []).find(
    (found) => norm(found.findLabel()?.getElement().textContent) === label,
  );
  expect(item, `the pair "${label}"`).toBeDefined();
  return item?.findValue()?.getElement() as HTMLElement;
}

/** The kinds of the area's value elements inside `element`, in order. */
function kindsIn(element: Element): string[] {
  return [...element.querySelectorAll('.aws-area-value')].map(
    (found) =>
      [...found.classList].find((name) => /^aws-area-value-[a-z]+$/.test(name))?.replace('aws-area-value-', '') ?? '',
  );
}

/** The copy control "Copy {label}" inside `element` directly before its address, or `null` when it has none. */
function copyBefore(element: HTMLElement, label: string): HTMLElement | null {
  const button = within(element).queryByRole('button', { name: `Copy ${label}` });
  if (button === null) {
    return null;
  }
  const address = element.querySelector('.aws-area-value-address');
  expect(address, `the address of "${label}"`).not.toBeNull();
  expect(button.compareDocumentPosition(address as Node) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  // Nothing of text stands between the control and the value.
  const range = document.createRange();
  range.setStartAfter(button);
  range.setEndBefore(address as Node);
  expect(norm(range.toString())).toBe('');
  return button;
}

describe('issue 467', () => {
  it("a loaded function with a status: the `h1`'s description is the status line alone; without a status: no description", async () => {
    const first = await openLoaded({ ...ORDERS, moments: [{ state: 'Failed', stateReason: 'It broke' }] });
    expect(description()).toBe('Failed It broke');
    expect(kindsIn(descriptionElement() as HTMLElement)).toEqual(['fixed', 'text']);
    first.unmount();

    await openLoaded();
    expect(descriptionElement()).toBeNull();
  });

  it('"Function not found" and a failed load: the `h1` has no description', async () => {
    const first = open(pagePath('gone'));
    await screen.findByText('Function not found');
    expect(descriptionElement()).toBeNull();
    first.unmount();

    engine.answerFunction = () => errorAnswer(500, 'ServiceException', 'broken');
    open(pagePath('orders'));
    await screen.findByRole('button', { name: 'Retry' });
    expect(descriptionElement()).toBeNull();
  });

  it('"Function overview" of a function with a URL: "Copy Function ARN" before the ARN and "Copy Function URL" before the URL, both addresses; "Description" free text', async () => {
    await openLoaded();

    const arn = valueElement('Function ARN');
    expect(copyBefore(arn, 'Function ARN')).not.toBeNull();
    expect(kindsIn(arn)).toEqual(['address']);
    expect(norm(arn.querySelector('.aws-area-value-address')?.textContent)).toBe(`${ACCOUNT_ARN}:orders`);
    const url = valueElement('Function URL');
    expect(copyBefore(url, 'Function URL')).not.toBeNull();
    expect(kindsIn(url)).toEqual(['address']);
    expect(norm(url.querySelector('.aws-area-value-address')?.textContent)).toBe(ORDERS.url);
    expect(kindsIn(valueElement('Description'))).toEqual(['text']);
    expect(kindsIn(valueElement('Last modified'))).toEqual(['fixed']);
  });

  it('without a URL, a URL the emulator answers 501 for and a URL that was not read: no "Copy Function URL"; the field shows what it did', async () => {
    const cases: [() => void, FakeFunction, string][] = [
      [() => undefined, withoutUrl(ORDERS), '-'],
      [
        () => {
          engine.answerUrl = () => errorAnswer(501, 'NotImplemented', 'GetFunctionUrlConfig is not implemented');
        },
        ORDERS,
        'Not implemented by the emulator',
      ],
      [
        () => {
          engine.answerUrl = () => errorAnswer(500, 'ServiceException', 'broken');
        },
        ORDERS,
        'Not read',
      ],
    ];
    for (const [arrange, fn, shown] of cases) {
      arrange();
      const opened = await openLoaded(fn);
      const url = valueElement('Function URL');
      expect(within(url).queryByRole('button')).toBeNull();
      expect(norm(url.textContent)).toBe(shown);
      expect(copyBefore(valueElement('Function ARN'), 'Function ARN')).not.toBeNull();
      opened.unmount();
    }
  });

  it('a loaded function: the `h1` shows its name as a name; the last crumb its whole name', async () => {
    const name = 'x'.repeat(64);
    await openLoaded({ ...ORDERS, name });

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(kindsIn(h1)).toEqual(['name']);
    expect(norm(h1.querySelector('.aws-area-value-name')?.textContent)).toBe(name);
    // The crumb is Cloudscape's, a text the area's layout gives it (decisions-needed.md, worker s2).
    const crumbs = PAGE.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? [];
    expect(norm(crumbs.at(-1)?.getElement().textContent)).toBe(name);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Function tabs by the query, the state of "Test", "Delete", ready.
// ---------------------------------------------------------------------------------------------------------------

/** The area's Flashbar items as text: header and content. */
function flashTexts(): string[] {
  return (PAGE.findFlashbar()?.findItems() ?? []).map((flash) =>
    norm(
      `${flash.findHeader()?.getElement().textContent ?? ''} ${flash.findContent()?.getElement().textContent ?? ''}`,
    ),
  );
}

describe('Monitor', () => {
  function lastHourHeader() {
    return PAGE.findAllHeaders().find(
      (header) => norm(header.findHeadingText().getElement().textContent) === 'Last hour',
    );
  }

  function metric(name: string) {
    const panel = tabs()?.findTabContent()?.getElement();
    if (panel === undefined) {
      return undefined;
    }
    const item = createWrapper(panel)
      .findKeyValuePairs()
      ?.findItems()
      .find((candidate) => norm(candidate.findLabel()?.getElement().textContent) === name);
    return item?.findValue()?.getElement();
  }

  function logMessages() {
    const table = PAGE.findTable();
    return table?.findRows().map((_, index) => table.findBodyCell(index + 1, 2)?.getElement().textContent) ?? [];
  }

  function logAnswer(message: string, nextToken?: string) {
    return json(200, { events: [{ eventId: message, message, timestamp: 1_796_000_000_123 }], nextToken });
  }

  function metricAnswer(Sum: number) {
    return json(200, { Datapoints: [{ Timestamp: 1_796_000_000, Sum }] });
  }

  it('opens from its tab and restores the same function’s Monitor on reload', async () => {
    const { router, unmount } = await openLoaded();
    fireEvent.click(tabLink('monitor'));
    await waitFor(() => expect(lastHourHeader()?.findHeadingText().getElement()).toBeVisible());
    expect(activeTab()).toBe('Monitor');
    expect(router.state.location).toMatchObject({ pathname: pagePath('orders'), search: '?tab=monitor' });
    const { pathname, search } = router.state.location;

    unmount();
    open(pathname + search);
    await waitFor(() => expect(lastHourHeader()?.findHeadingText().getElement()).toBeVisible());
    expect(activeTab()).toBe('Monitor');
    expect(headingText()).toBe('orders');
  });

  it('refreshes the first page and the shared window while older reads are outstanding', async () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(1_796_000_000_000);
    const delayed: (() => void)[] = [];
    const said = recordAnnouncements();
    let finishRefreshedErrors: (() => void) | undefined;
    let refreshed = false;
    engine.answerMonitoring = ({ operation, body }) => {
      if (operation === 'FilterLogEvents' && body.nextToken === undefined) {
        return refreshed ? logAnswer('refreshed first event') : logAnswer('old first event', 'old-next-page');
      }
      const answer =
        operation === 'FilterLogEvents'
          ? logAnswer('old next event')
          : metricAnswer(refreshed ? (body.MetricName === 'Invocations' ? 12 : 4) : 98);
      if (!refreshed) {
        return new Promise((resolve) => delayed.push(() => resolve(answer)));
      }
      return body.MetricName === 'Errors'
        ? new Promise((resolve) => {
            finishRefreshedErrors = () => resolve(answer);
          })
        : answer;
    };

    try {
      engine.functions = [ORDERS];
      open(`${pagePath('orders')}?tab=monitor`);
      await waitFor(() => expect(logMessages()).toContain('old first event'));
      fireEvent.click(screen.getByRole('button', { name: 'Load more events' }));
      await waitFor(() => expect(delayed).toHaveLength(3));

      refreshed = true;
      const newEnd = 1_796_000_120;
      time.mockReturnValue(newEnd * 1000);
      fireEvent.click(within(header()).getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(logMessages()).toContain('refreshed first event'));
      await waitFor(() => {
        expect(metric('Invocations')?.textContent).toBe('12');
        expect(metric('Invocations')).toBeVisible();
      });
      const description = lastHourHeader()?.findDescription()?.getElement();
      expect(description).toHaveTextContent('Window ended');
      expect(description?.querySelector('time')).toHaveAttribute('datetime', new Date(newEnd * 1000).toISOString());
      expect(said).not.toContain('Function refreshed');
      expect(said).not.toContain('Monitor refreshed');
      await act(async () => {
        expect(finishRefreshedErrors).toBeDefined();
        finishRefreshedErrors?.();
      });
      await waitFor(() => {
        expect(metric('Errors')?.textContent).toBe('4');
        expect(metric('Errors')).toBeVisible();
      });
      await waitFor(() => expect(said.filter((message) => message === 'Monitor refreshed')).toHaveLength(1));
      expect(said).not.toContain('Function refreshed');

      const newCalls = engine.monitoring.slice(4);
      expect(
        newCalls.filter(({ operation }) => operation === 'FilterLogEvents').map(({ body }) => body.nextToken),
      ).toEqual([undefined]);
      const metrics = newCalls.filter(({ operation }) => operation === 'GetMetricStatistics');
      expect(metrics.map(({ body }) => body.MetricName).sort()).toEqual(['Errors', 'Invocations']);
      for (const { body } of metrics) {
        expect(body).toMatchObject({ StartTime: newEnd - 3_600, EndTime: newEnd });
      }

      await act(async () => {
        delayed.forEach((finish) => finish());
      });
      expect(logMessages()).toEqual(['refreshed first event']);
      expect(metric('Invocations')?.textContent).toBe('12');
      expect(metric('Invocations')).toBeVisible();
      expect(metric('Errors')?.textContent).toBe('4');
      expect(metric('Errors')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Load more events' })).not.toBeInTheDocument();
    } finally {
      time.mockRestore();
    }
  });

  it('announces a partial Monitor refresh with the failed read after the other reads settle', async () => {
    const said = recordAnnouncements();
    let refreshed = false;
    engine.answerMonitoring = ({ operation, body }) => {
      if (operation === 'FilterLogEvents') {
        return logAnswer(refreshed ? 'new logged event' : 'original logged event');
      }
      if (refreshed && body.MetricName === 'Invocations') {
        return errorAnswer(403, 'AccessDenied', 'Missing metric permission');
      }
      return metricAnswer(refreshed ? 3 : 1);
    };

    engine.functions = [ORDERS];
    open(`${pagePath('orders')}?tab=monitor`);
    await waitFor(() => expect(logMessages()).toContain('original logged event'));
    refreshed = true;
    fireEvent.click(within(header()).getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      const invocations = metric('Invocations');
      expect(invocations).toHaveTextContent('GetMetricStatistics was refused: Missing metric permission');
      expect(invocations).toBeVisible();
      expect(metric('Errors')?.textContent).toBe('3');
      expect(metric('Errors')).toBeVisible();
      expect(logMessages()).toContain('new logged event');
    });
    await waitFor(() => expect(said).toContain('Monitor partially refreshed. Could not read Invocations.'));
    expect(said).not.toContain('Function refreshed');
    expect(said).not.toContain('Monitor refreshed');
  });

  it.each(['Monitor', 'Code'])('revalidates the detail after a disconnect on %s', async (tab) => {
    engine.functions = [ORDERS];
    engine.answerMonitoring = ({ operation }) =>
      operation === 'FilterLogEvents' ? logAnswer('events from the previous account') : metricAnswer(98);
    const { router } = open(`${pagePath('orders')}?tab=monitor`);
    await waitFor(() => expect(logMessages()).toContain('events from the previous account'));
    if (tab === 'Code') {
      fireEvent.click(tabLink('code'));
      await screen.findByTestId('stand-in-code');
    }

    connection.set(notStartedResult());
    expect(logMessages()).toEqual([]);
    engine.functions = [];
    connection.set(connectedResult());
    if (tab === 'Code') {
      await act(() => router.navigate(`${pagePath('orders')}?tab=monitor`));
    }

    expect(await screen.findByText('Function not found')).toBeVisible();
    expect(engine.gets).toHaveLength(2);
    expect(engine.monitoring).toHaveLength(3);
    expect(logMessages()).toEqual([]);
    expect(metric('Invocations')).toBeUndefined();
    expect(metric('Errors')).toBeUndefined();
  });
});

function deferredAnswer() {
  let resolve!: (answer: Answer) => void;
  const promise = new Promise<Answer>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function versionAnswer(number: string) {
  return json(200, { Versions: [{ Version: '$LATEST' }, { Version: number, Description: `Release ${number}` }] });
}

function aliasAnswer(name: string, version: string) {
  return json(200, { Aliases: [{ Name: name, FunctionVersion: version }] });
}

function releaseTable(name: 'Versions' | 'Aliases') {
  const table = tabs()?.findTabContent()?.findAllTables()[name === 'Versions' ? 0 : 1];
  if (table) {
    expect(table.findHeaderSlot()?.findHeader()?.findHeadingText().getElement()).toHaveTextContent(name);
  }
  return table;
}

describe('Versions and aliases', () => {
  const versionsPath = '?tab=versions';

  function versionsShown() {
    const table = releaseTable('Versions');
    return (
      table
        ?.findRows()
        .map((_, index) => [
          norm(table.findBodyCell(index + 1, 1)?.getElement().textContent),
          norm(table.findBodyCell(index + 1, 3)?.getElement().textContent),
        ]) ?? []
    );
  }

  function aliasesShown() {
    const table = releaseTable('Aliases');
    return (
      table
        ?.findRows()
        .map((_, index) => [
          norm(table.findBodyCell(index + 1, 2)?.getElement().textContent),
          norm(table.findBodyCell(index + 1, 3)?.getElement().textContent),
        ]) ?? []
    );
  }

  it('opens from the tab and reopens the same function on its release address', async () => {
    const { router, unmount } = await openLoaded();
    fireEvent.click(tabLink('versions'));
    await waitFor(() => expect(versionsShown()).toContainEqual(['$LATEST', '-']));
    expect(activeTab()).toBe('Versions and aliases');
    expect(router.state.location).toMatchObject({ pathname: pagePath('orders'), search: versionsPath });
    const { pathname, search } = router.state.location;

    unmount();
    open(pathname + search);
    await waitFor(() => expect(versionsShown()).toContainEqual(['$LATEST', '-']));
    expect(activeTab()).toBe('Versions and aliases');
    expect(headingText()).toBe('orders');
    expect(
      engine.aws
        .filter(({ url }) => RELEASE_PATH.test(url.pathname))
        .every(({ url }) => RELEASE_PATH.exec(url.pathname)?.[1] === 'orders'),
    ).toBe(true);
  });

  it('keeps refreshed releases when the older reads finish after them', async () => {
    engine.functions = [{ name: 'orders' }];
    const oldVersions = deferredAnswer();
    const oldAliases = deferredAnswer();
    let current = false;
    engine.answerRelease = ({ url }) =>
      url.pathname.endsWith('/versions')
        ? current
          ? versionAnswer('2')
          : oldVersions.promise
        : current
          ? aliasAnswer('current-live', '2')
          : oldAliases.promise;

    open(pagePath('orders') + versionsPath);
    await waitFor(() => {
      expect(engine.aws.filter(({ url }) => RELEASE_PATH.test(url.pathname))).toHaveLength(2);
    });
    current = true;
    engine.functions = [{ name: 'orders', description: 'Refreshed function details' }];
    const refresh = pageActions()[0];
    expect(refresh?.getElement()).toHaveAccessibleName('Refresh');
    refresh?.click();
    await waitFor(() => {
      expect(pairs()).toContainEqual(['Description', 'Refreshed function details']);
      expect(versionsShown()).toEqual([
        ['$LATEST', '-'],
        ['2', 'Release 2'],
      ]);
      expect(aliasesShown()).toEqual([['current-live', '2']]);
    });

    await act(async () => {
      oldVersions.resolve(versionAnswer('1'));
      oldAliases.resolve(aliasAnswer('old-live', '1'));
      await Promise.all([oldVersions.promise, oldAliases.promise]);
    });
    expect(versionsShown()).toEqual([
      ['$LATEST', '-'],
      ['2', 'Release 2'],
    ]);
    expect(aliasesShown()).toEqual([['current-live', '2']]);
  });

  it('verifies the function on reconnect from another tab before displaying release data', async () => {
    engine.functions = [{ name: 'orders' }];
    engine.answerRelease = ({ url }) =>
      url.pathname.endsWith('/versions') ? versionAnswer('1') : aliasAnswer('old-live', '1');

    const { router } = open(pagePath('orders') + versionsPath);
    await waitFor(() => {
      expect(versionsShown()).toContainEqual(['1', 'Release 1']);
      expect(aliasesShown()).toEqual([['old-live', '1']]);
    });
    fireEvent.click(tabLink('code'));
    expect(activeTab()).toBe('Code');
    connection.set(notStartedResult());
    engine.functions = [];
    const reconnect = deferredAnswer();
    engine.answerFunction = () => reconnect.promise;
    connection.set(connectedResult());
    await act(() => router.navigate(pagePath('orders') + versionsPath));
    await waitFor(() => expect(engine.gets).toHaveLength(2));
    expect(releaseTable('Versions')).toBeUndefined();
    expect(releaseTable('Aliases')).toBeUndefined();
    expect(tabs()?.findTabLinkById('versions') ?? null).toBeNull();
    expect(engine.aws.filter(({ url }) => RELEASE_PATH.test(url.pathname))).toHaveLength(2);

    await act(async () => {
      reconnect.resolve(errorAnswer(404, 'ResourceNotFoundException', 'Function not found'));
      await reconnect.promise;
    });
    expect(await screen.findByText('Function not found')).toBeVisible();
    expect(releaseTable('Versions')).toBeUndefined();
    expect(releaseTable('Aliases')).toBeUndefined();
    expect(engine.aws.filter(({ url }) => RELEASE_PATH.test(url.pathname))).toHaveLength(2);
  });

  it('keeps the published number visible when the detail reread removes the tab before the release reread', async () => {
    engine.functions = [{ name: 'orders' }];
    const detail = deferredAnswer();
    const releases = deferredAnswer();
    let published = false;
    engine.answerFunction = (request) => (published ? detail.promise : engine.emulator(request));
    engine.answerRelease = ({ method, url }) => {
      if (method === 'POST') {
        published = true;
        return json(201, { Version: '2' });
      }
      return url.pathname.endsWith('/aliases')
        ? aliasAnswer('live', '1')
        : published
          ? releases.promise
          : versionAnswer('1');
    };

    open(pagePath('orders') + versionsPath);
    await waitFor(() => {
      expect(versionsShown()).toContainEqual(['1', 'Release 1']);
      expect(aliasesShown()).toEqual([['live', '1']]);
    });
    const publish = releaseTable('Versions')?.findHeaderSlot()?.findHeader()?.findActions()?.findButton();
    expect(publish?.getElement()).toHaveTextContent('Publish version');
    publish?.click();
    await waitFor(() => expect(flashTexts()).toContain('Published version 2.'));
    await waitFor(() => expect(engine.gets).toHaveLength(2));
    await waitFor(() =>
      expect(
        engine.aws.filter(({ method, url }) => method === 'GET' && url.pathname.endsWith('/versions')),
      ).toHaveLength(2),
    );
    await act(async () => {
      detail.resolve(errorAnswer(404, 'ResourceNotFoundException', 'Function not found'));
      await detail.promise;
    });
    expect(await screen.findByText('Function not found')).toBeVisible();
    expect(flashTexts()).toContain('Published version 2.');
    await act(async () => {
      releases.resolve(versionAnswer('2'));
      await releases.promise;
    });
    expect(releaseTable('Versions')).toBeUndefined();
    expect(flashTexts()).toContain('Published version 2.');
  });
});

describe('Qualified Test invocations', () => {
  function targets() {
    const select = PAGE.findSelect();
    if (select === null) {
      throw new Error('Expected the Invoke target selector');
    }
    return select;
  }

  function submitted() {
    return engine.aws.filter(({ url }) => INVOKE_PATH.test(url.pathname));
  }

  async function chooseTarget(value: string) {
    await waitFor(() => {
      expect(handed.test?.aliases.loading).toBe(false);
      expect(handed.test?.versions.loading).toBe(false);
    });
    const select = targets();
    select.openDropdown();
    select.selectOptionByValue(value);
  }

  function invokeButton() {
    const event = PAGE.findAllContainers().find((container) => container.findContent().findTextarea() !== null);
    const header = event?.findHeader()?.findHeader();
    const button = header?.findActions()?.findButton();
    if (!button) {
      throw new Error('Expected the Test event panel action');
    }
    expect(header?.findHeadingText().getElement()).toHaveTextContent('Event');
    expect(button.getElement()).toHaveTextContent(/^Invok(e|ing)$/);
    return button;
  }

  function invokeTarget() {
    invokeButton().click();
  }

  function eventField() {
    const field = PAGE.findTextarea();
    if (field === null) {
      throw new Error('Expected the Event JSON textarea');
    }
    return field;
  }

  function targetOption(value: string) {
    return targets().findDropdown().findOptionByValue(value)?.getElement() ?? null;
  }

  function result(payload: string, log: string): Answer {
    return { status: 200, body: JSON.stringify({ payload }), headers: { 'x-amz-log-result': btoa(log) } };
  }

  function findResultPanel() {
    const tabSet = tabs();
    const panel = tabSet
      ? tabSet.findTabContent()?.findGrid()?.findColumn(2)?.findContainer()
      : PAGE.findAllContainers()[1];
    if (panel) {
      expect(panel.findHeader()?.findHeader()?.findHeadingText().getElement()).toHaveTextContent('Result');
    }
    return panel?.getElement();
  }

  function resultPanel() {
    const panel = findResultPanel();
    if (panel === undefined) {
      throw new Error('Expected the invocation result panel');
    }
    return panel;
  }

  async function waitForResult(text: string) {
    await waitFor(() => {
      const panel = resultPanel();
      expect(panel).toBeVisible();
      expect(panel).toHaveTextContent(text);
    });
  }

  beforeEach(() => {
    handed.renderTest = true;
    Element.prototype.scrollIntoView = () => undefined;
    engine.functions = [{ name: 'orders', description: 'Initial invocation details' }];
    engine.answerRelease = ({ url }) =>
      url.pathname.endsWith('/versions') ? versionAnswer('2') : aliasAnswer('live', '2');
  });

  it('allows Event JSON editing only after the first verified detail and keeps edits through release reads', async () => {
    const preliminary = deferredAnswer();
    const verifiedDetail = deferredAnswer();
    const versions = deferredAnswer();
    const aliases = deferredAnswer();
    connection.value = { engineOrigin, result: undefined };
    engine.answerFunction = () => preliminary.promise;
    engine.answerRelease = ({ url }) => (url.pathname.endsWith('/versions') ? versions.promise : aliases.promise);
    open(pagePath('orders'));

    const request = { method: 'GET', url: new URL('/2015-03-31/functions/orders', engineOrigin) };
    await waitFor(() => expect(engine.gets).toEqual([request.url]));
    await act(async () => preliminary.resolve(engine.emulator(request)));
    await waitForResult('Not invoked yet');
    expect(value('Description')).toBe('Initial invocation details');
    const preliminaryEditor = eventField().findNativeTextarea().getElement();
    expect(preliminaryEditor).toHaveAccessibleName('Event JSON');
    expect(preliminaryEditor).toHaveAttribute('readonly');
    fireEvent.change(preliminaryEditor, { target: { value: '{"event":"during checking"}' } });
    expect(eventField().getTextareaValue()).toBe('{}');
    expect(invokeButton().getElement()).toBeDisabled();
    expect(submitted()).toEqual([]);

    engine.functions = [{ name: 'orders', description: 'Verified invocation details' }];
    engine.answerFunction = () => verifiedDetail.promise;
    connection.set(connectedResult());
    await waitFor(() => expect(engine.gets).toEqual([request.url, request.url]));
    expect(PAGE.findTextarea()).toBeNull();
    expect(engine.aws.filter(({ url }) => RELEASE_PATH.test(url.pathname))).toEqual([]);

    await act(async () => verifiedDetail.resolve(engine.emulator(request)));
    await waitFor(() => {
      expect(value('Description')).toBe('Verified invocation details');
      expect(handed.test?.versions.loading).toBe(true);
      expect(handed.test?.aliases.loading).toBe(true);
    });
    const editor = eventField().findNativeTextarea().getElement();
    expect(editor).not.toHaveAttribute('readonly');
    expect(eventField().getTextareaValue()).toBe('{}');
    expect(invokeButton().getElement()).toBeEnabled();
    const event = '{"event":"verified draft"}';
    eventField().setTextareaValue(event);

    await act(async () => {
      versions.resolve(versionAnswer('2'));
      aliases.resolve(aliasAnswer('live', '2'));
    });
    await waitFor(() => {
      expect(handed.test?.versions.loading).toBe(false);
      expect(handed.test?.aliases.loading).toBe(false);
    });
    expect(eventField().findNativeTextarea().getElement()).toBe(editor);
    expect(eventField().getTextareaValue()).toBe(event);
    expect(submitted()).toEqual([]);
  });

  it.each(['detail', 'releases'])(
    'keeps the submitted target and event across tabs when %s settle first',
    async (first) => {
      const invoke = deferredAnswer();
      const detail = deferredAnswer();
      const versions = deferredAnswer();
      const aliases = deferredAnswer();
      let reopening = false;
      engine.answerInvoke = () => invoke.promise;
      engine.answerFunction = (request) =>
        reopening && FUNCTION_PATH.test(request.url.pathname) ? detail.promise : engine.emulator(request);
      engine.answerRelease = ({ url }) =>
        url.pathname.endsWith('/versions')
          ? reopening
            ? versions.promise
            : versionAnswer('2')
          : reopening
            ? aliases.promise
            : aliasAnswer('live', '2');

      open(pagePath('orders'));
      await waitForResult('Not invoked yet');
      await chooseTarget('live');
      const event = '{"tag":"kept"}';
      eventField().setTextareaValue(event);
      invokeTarget();
      await waitFor(() => expect(submitted()[0]?.url.searchParams.get('Qualifier')).toBe('live'));
      await chooseTarget('2');
      fireEvent.click(tabLink('code'));
      expect(await screen.findByTestId('stand-in-code')).toBeVisible();

      reopening = true;
      fireEvent.click(tabLink('test'));
      await waitForResult('Not invoked yet');
      expect(eventField().getTextareaValue()).toBe(event);
      expect(targets().findTrigger().getElement()).toHaveTextContent('2');

      await act(async () => invoke.resolve(result('from the live alias', 'live tail')));
      await waitFor(() => expect(engine.gets).toHaveLength(2));
      await waitForResult('from the live alias');
      expect(resultPanel()).toHaveTextContent('Submitted target live');
      expect(resultPanel()).toHaveTextContent('live tail');

      const settleDetail = async () => {
        engine.functions = [{ name: 'orders', description: 'Details after qualified Invoke' }];
        await act(async () =>
          detail.resolve(
            engine.emulator({
              method: 'GET',
              url: new URL('/2015-03-31/functions/orders', engineOrigin),
            }),
          ),
        );
        await waitFor(() => {
          expect(value('Description')).toBe('Details after qualified Invoke');
        });
      };
      const settleReleases = async () => {
        await act(async () => {
          versions.resolve(json(200, { Versions: [{ Version: '2' }, { Version: '3' }] }));
          aliases.resolve(aliasAnswer('live', '3'));
        });
        await waitFor(() => {
          expect(handed.test?.versions.loading).toBe(false);
          expect(handed.test?.aliases.loading).toBe(false);
        });
      };
      if (first === 'detail') {
        await settleDetail();
        expect(handed.test?.aliases.loading).toBe(true);
        await settleReleases();
      } else {
        await settleReleases();
        expect(value('Description')).toBe('Initial invocation details');
        await settleDetail();
      }
      expect(value('Description')).toBe('Details after qualified Invoke');
      expect(targets().findTrigger().getElement()).toHaveTextContent('2');
      targets().openDropdown();
      expect(targetOption('3')).toHaveTextContent('3');
      expect(targetOption('live')).toHaveTextContent('Version 3');
      targets().closeDropdown();
      expect(resultPanel()).toHaveTextContent('Submitted target live');
      expect(resultPanel()).toHaveTextContent('from the live alias');
      expect(resultPanel()).toHaveTextContent('live tail');
      expect(eventField().getTextareaValue()).toBe(event);
    },
  );

  it('announces off Test and announces a repeated result once while scrolling the visible panel', async () => {
    const pending = deferredAnswer();
    const announcements = recordAnnouncements();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    engine.answerInvoke = () => pending.promise;
    open(pagePath('orders'));
    await waitForResult('Not invoked yet');
    await chooseTarget('live');
    invokeTarget();
    await waitFor(() => expect(submitted()).toHaveLength(1));

    fireEvent.click(tabLink('code'));
    expect(await screen.findByTestId('stand-in-code')).toBeVisible();
    await act(async () => pending.resolve(result('first reply', 'first tail')));
    await waitFor(() => expect(announcements.filter((message) => message === 'Succeeded')).toHaveLength(1));
    expect(PAGE.findTextarea()).toBeNull();
    expect(scroll).not.toHaveBeenCalled();

    fireEvent.click(tabLink('test'));
    await waitFor(() => expect(resultPanel()).toHaveTextContent('first reply'));
    expect(announcements.filter((message) => message === 'Succeeded')).toHaveLength(1);
    expect(scroll).not.toHaveBeenCalled();

    await chooseTarget('live');
    const field = eventField().findNativeTextarea().getElement();
    field.focus();
    engine.answerInvoke = () => result('second reply', 'second tail');
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(announcements.filter((message) => message === 'Succeeded')).toHaveLength(2));
    expect(resultPanel()).toHaveTextContent('second reply');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scroll.mock.contexts[0]).toContainElement(resultPanel());
    expect(field).toHaveFocus();
    scroll.mockRestore();
  });

  it.each(['Test', 'Code'])(
    'keeps the submitted alias and an announced refusal when the detail reread removes %s',
    async (tab) => {
      const invoke = deferredAnswer();
      const announcements = recordAnnouncements();
      const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
      engine.answerInvoke = () => invoke.promise;
      open(pagePath('orders'));
      await waitForResult('Not invoked yet');
      await chooseTarget('live');
      invokeTarget();
      await waitFor(() => expect(submitted()[0]?.url.searchParams.get('Qualifier')).toBe('live'));
      if (tab === 'Code') {
        fireEvent.click(tabLink('code'));
        expect(await screen.findByTestId('stand-in-code')).toBeVisible();
      }

      engine.functions = [];
      await act(async () => invoke.resolve(errorAnswer(404, 'ResourceNotFoundException', 'Alias no longer exists')));
      expect(await screen.findByText('Function not found')).toBeVisible();
      expect(tabs()).toBeNull();
      expect(resultPanel()).toHaveTextContent('Submitted target live');
      expect(resultPanel()).toHaveTextContent('Invoke failed');
      expect(resultPanel()).toHaveTextContent('ResourceNotFoundException');
      expect(announcements.filter((message) => message === 'The invocation was refused')).toHaveLength(1);
      expect(scroll).toHaveBeenCalledTimes(1);
      if (tab === 'Code') {
        expect(scroll.mock.contexts[0]).toContainElement(resultPanel());
      }
      scroll.mockRestore();
    },
  );

  it.each([
    [
      'a function error',
      {
        status: 200,
        body: '{"errorMessage":"handler failed"}',
        headers: { 'x-amz-function-error': 'Unhandled' },
      },
      'The function returned an error',
    ],
    ['an absent engine answer', 'network-error', 'The invocation got no answer'],
    [
      'an unimplemented qualified Invoke',
      errorAnswer(501, 'NotImplemented', 'Invoke qualifiers are unsupported.'),
      'Not implemented by the emulator',
    ],
  ] as const)('announces %s once from the page', async (_case, answer, words) => {
    const announcements = recordAnnouncements();
    engine.answerInvoke = () => answer;
    open(pagePath('orders'));
    await waitForResult('Not invoked yet');
    await chooseTarget('live');
    invokeTarget();

    await waitFor(() => expect(announcements.filter((message) => message === words)).toHaveLength(1));
    expect(resultPanel()).toHaveTextContent(words);
    fireEvent.click(tabLink('code'));
    expect(await screen.findByTestId('stand-in-code')).toBeVisible();
    fireEvent.click(tabLink('test'));
    await waitFor(() => expect(resultPanel()).toHaveTextContent(words));
    expect(announcements.filter((message) => message === words)).toHaveLength(1);
  });

  it('shows the reported service code and the access-denied reason for qualified Invoke', async () => {
    engine.answerInvoke = () => errorAnswer(403, 'AccessDeniedException', 'The alias requires invoke permission.');
    open(pagePath('orders'));
    await waitForResult('Not invoked yet');
    await chooseTarget('live');
    invokeTarget();

    await waitFor(() => expect(resultPanel()).toHaveTextContent('AccessDeniedException'));
    expect(resultPanel()).toHaveTextContent('Submitted target live');
    expect(resultPanel()).toHaveTextContent('Access denied: Invoke was refused.');
    expect(resultPanel()).toHaveTextContent('The alias requires invoke permission.');
  });

  it('drops the previous choices, selection and result when navigating to another function', async () => {
    engine.functions.push({ name: 'payments' });
    engine.answerRelease = ({ url }) => {
      const orders = url.pathname.includes('/orders/');
      if (url.pathname.endsWith('/versions')) {
        return versionAnswer(orders ? '2' : '8');
      }
      return orders ? aliasAnswer('live', '2') : aliasAnswer('next', '8');
    };
    engine.answerInvoke = () => result('orders result', 'orders tail');
    const { router } = open(pagePath('orders'));
    await waitForResult('Not invoked yet');
    await chooseTarget('live');
    invokeTarget();
    await waitForResult('orders result');

    await act(() => router.navigate(pagePath('payments')));
    await waitForResult('Not invoked yet');
    await waitFor(() => {
      expect(handed.test?.versions.loading).toBe(false);
      expect(handed.test?.aliases.loading).toBe(false);
    });
    expect(targets().findTrigger().getElement()).toHaveTextContent('$LATEST');
    targets().openDropdown();
    expect(targetOption('next')).toHaveTextContent('next');
    expect(targetOption('8')).toHaveTextContent('8');
    expect(targetOption('live')).toBeNull();
    expect(resultPanel()).not.toHaveTextContent('orders result');
  });

  it('verifies a same-name replacement and ignores an old invocation that finishes after reconnect', async () => {
    const pending = deferredAnswer();
    const announcements = recordAnnouncements();
    engine.answerInvoke = () =>
      submitted().length === 1 ? result('previous result', 'previous tail') : pending.promise;
    open(pagePath('orders'));
    await waitForResult('Not invoked yet');
    await chooseTarget('live');
    invokeTarget();
    await waitForResult('previous result');
    await waitFor(() => expect(invokeButton().getElement()).toBeEnabled());
    invokeTarget();
    await waitFor(() => expect(submitted()).toHaveLength(2));
    expect(resultPanel()).toHaveTextContent('previous result');
    expect(announcements.filter((message) => message === 'Succeeded')).toHaveLength(1);

    connection.set(notStartedResult());
    expect(findResultPanel()?.textContent ?? '').not.toContain('previous result');
    engine.answerRelease = ({ url }) =>
      url.pathname.endsWith('/versions') ? versionAnswer('8') : aliasAnswer('replacement', '8');
    connection.set(connectedResult());

    await waitForResult('Not invoked yet');
    await waitFor(() => {
      expect(handed.test?.versions.loading).toBe(false);
      expect(handed.test?.aliases.loading).toBe(false);
    });
    expect(targets().findTrigger().getElement()).toHaveTextContent('$LATEST');
    targets().openDropdown();
    expect(targetOption('replacement')).toHaveTextContent('replacement');
    expect(targetOption('8')).toHaveTextContent('8');
    expect(targetOption('live')).toBeNull();
    const rereads = engine.gets.length;
    expect(announcements.filter((message) => message === 'Succeeded')).toHaveLength(1);

    await act(async () => {
      pending.resolve(result('late result', 'late tail'));
      await pending.promise;
    });

    expect(engine.gets).toHaveLength(rereads);
    expect(targetOption('replacement')).toHaveTextContent('replacement');
    expect(targets().findTrigger().getElement()).toHaveTextContent('$LATEST');
    expect(resultPanel()).toHaveTextContent('Not invoked yet');
    expect(resultPanel()).not.toHaveTextContent('late result');
    expect(announcements.filter((message) => message === 'Succeeded')).toHaveLength(1);

    targets().selectOptionByValue('replacement');
    engine.answerInvoke = () => result('replacement result', 'replacement tail');
    invokeTarget();
    await waitFor(() => expect(announcements.filter((message) => message === 'Succeeded')).toHaveLength(2));
    expect(resultPanel()).toHaveTextContent('Submitted target replacement');
    expect(resultPanel()).toHaveTextContent('replacement result');
  });

  it('refreshes targets and keeps a disappeared alias blocked until replaced by an explicit choice', async () => {
    open(pagePath('orders'));
    await waitForResult('Not invoked yet');
    await chooseTarget('live');
    engine.answerRelease = ({ url }) =>
      url.pathname.endsWith('/versions') ? versionAnswer('2') : json(200, { Aliases: [] });
    const refresh = pageActions()[0];
    expect(refresh?.getElement()).toHaveAccessibleName('Refresh');
    refresh?.click();
    await waitFor(() => {
      const targetField = PAGE.findAllFormFields().find((field) => field.findControl()?.findSelect() != null);
      expect(targetField?.findLabel()?.getElement()).toHaveTextContent('Invoke target');
      expect(targetField?.findError()?.getElement()).toHaveTextContent('live is unavailable. Choose another target.');
    });
    expect(invokeButton().getElement()).toBeDisabled();
    fireEvent.keyDown(eventField().findNativeTextarea().getElement(), { key: 'Enter', ctrlKey: true });
    expect(submitted()).toHaveLength(0);
    await chooseTarget('2');
    invokeTarget();
    await waitFor(() => expect(submitted()[0]?.url.searchParams.get('Qualifier')).toBe('2'));
  });
});

describe('the tabs by ?tab=', () => {
  it.each([
    ['', 'Test', 'stand-in-test'],
    ['?tab=code', 'Code', 'stand-in-code'],
    ['?tab=configuration', 'Configuration', 'stand-in-configuration'],
    ['?tab=nonsense', 'Test', 'stand-in-test'],
    ['?tab=', 'Test', 'stand-in-test'],
  ])('%s selects "%s" and shows its content alone', async (query, label, testId) => {
    engine.functions = [ORDERS];
    open(`${pagePath('orders')}${query}`);
    await screen.findByRole('heading', { level: 2, name: 'Function overview' });

    expect(tabLabels()).toEqual(['Test', 'Code', 'Monitor', 'Configuration', 'Versions and aliases']);
    expect(activeTab()).toBe(label);
    expect(tabs()?.findTabContent()?.getElement()).toContainElement(screen.getByTestId(testId));
  });

  it('each tab links to its address: the function’s path, ?tab=code, ?tab=configuration', async () => {
    await openLoaded();

    expect(tabLink('test')).toHaveAttribute('href', pagePath('orders'));
    expect(tabLink('code')).toHaveAttribute('href', `${pagePath('orders')}?tab=code`);
    expect(tabLink('configuration')).toHaveAttribute('href', `${pagePath('orders')}?tab=configuration`);
  });

  it('choosing a tab changes the address’s query and not its path, adds an entry to the history, and reads nothing again', async () => {
    const { router } = await openLoaded();
    const reads = engine.gets.length;
    const overview = screen.getByRole('heading', { level: 2, name: 'Function overview' });

    fireEvent.click(tabLink('code'));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=code');
    });
    expect(router.state.location.pathname).toBe(pagePath('orders'));
    expect(router.state.historyAction).toBe('PUSH');
    expect(activeTab()).toBe('Code');

    fireEvent.click(tabLink('configuration'));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=configuration');
    });

    // The browser's back: "Code" again, the earlier entry kept.
    await act(() => router.navigate(-1));
    expect(router.state.location.search).toBe('?tab=code');
    expect(activeTab()).toBe('Code');
    // The page stayed mounted and asked nothing of the engine.
    expect(screen.getByRole('heading', { level: 2, name: 'Function overview' })).toBe(overview);
    expect(engine.gets).toHaveLength(reads);
  });

  it('each tab is handed the function read; "Test" its name, the event text {}, its setter and the invoke', async () => {
    const { router } = await openLoaded();

    expect(handed.test?.functionName).toBe('orders');
    expect(handed.test?.eventText).toBe('{}');
    expect(typeof handed.test?.onEventTextChange).toBe('function');
    expect(handed.test?.invoke).toMatchObject({ isPending: false, data: undefined, error: undefined });
    expect(typeof handed.test?.invoke.mutate).toBe('function');

    fireEvent.click(tabLink('code'));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=code');
    });
    expect(handed.code?.name).toBe('orders');
    expect(handed.code?.ready).toBe(true);
    expect(handed.code?.fn).toMatchObject({
      name: 'orders',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      architectures: ['arm64'],
      environment: [{ key: 'SECRET', value: 'orders-secret-value' }],
    });

    fireEvent.click(tabLink('configuration'));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=configuration');
    });
    expect(handed.configuration?.fn).toBe(handed.code?.fn);
    expect(handed.configuration?.name).toBe('orders');
    expect(handed.configuration?.ready).toBe(true);
    expect(handed.configuration?.connection.engineOrigin).toBe(engineOrigin);
  });

  it('the event text set through "Test" and the invoke’s last result are handed to "Test" unchanged after "Code" and back', async () => {
    const { router } = await openLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Stand-in type event' }));
    await waitFor(() => {
      expect(handed.test?.eventText).toBe('{"tag": "kept"}');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stand-in invoke' }));
    await waitFor(() => {
      expect(handed.test?.invoke.data).toEqual({ payload: '{"invocation":1}', log: '' });
    });
    const invoke = handed.test?.invoke;

    fireEvent.click(tabLink('code'));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=code');
    });
    expect(screen.queryByTestId('stand-in-test')).toBeNull();
    fireEvent.click(tabLink('test'));
    await screen.findByTestId('stand-in-test');

    expect(handed.test?.eventText).toBe('{"tag": "kept"}');
    expect(handed.test?.invoke.data).toEqual(invoke?.data);
    expect(handed.test?.invoke.answers).toBe(1);
    expect(engine.invocations).toBe(1);
  });

  it.each(['', '?tab=code', '?tab=configuration', '?tab=nonsense'])(
    '"Function not found" in the place of the tabs at %s',
    async (query) => {
      open(`${pagePath('gone')}${query}`);

      await screen.findByText('Function not found');
      expect(tabs()).toBeNull();
      expect(screen.queryByTestId(/^stand-in-/)).toBeNull();
    },
  );

  it.each(['?tab=code', '?tab=configuration'])(
    'loading and a failure in the place of the tabs at %s',
    async (query) => {
      let answer: (value: Answer) => void = () => undefined;
      engine.answerFunction = () =>
        new Promise<Answer>((resolve) => {
          answer = resolve;
        });
      open(`${pagePath('orders')}${query}`);

      expect(await screen.findByText('Loading function')).toBeInTheDocument();
      expect(tabs()).toBeNull();
      answer(errorAnswer(403, 'AccessDeniedException', 'may not read'));

      expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(screen.getAllByText('Access denied').length).toBeGreaterThan(0);
      expect(tabs()).toBeNull();
      expect(screen.queryByTestId(/^stand-in-/)).toBeNull();
    },
  );
});

describe('"Delete" in the header', () => {
  function pageDeleteAction() {
    return pageActions()[1];
  }

  async function openDialog() {
    const action = pageDeleteAction();
    expect(action?.getElement()).toHaveTextContent('Delete');
    action?.click();
    return waitFor(() => deletionControls());
  }

  function deletionDialog() {
    return PAGE.findAllModals().find((dialog) => dialog.isVisible());
  }

  function deletionControls() {
    const dialog = deletionDialog();
    const input = dialog?.findContent().findInput();
    const [cancel, submit] = dialog?.findFooter()?.findAllButtons() ?? [];
    if (!dialog || !input || !submit || !cancel) {
      throw new Error('Expected the visible deletion dialog and its controls');
    }
    expect(dialog.findHeader().getElement()).toHaveTextContent('Delete functions');
    expect(cancel.getElement()).toHaveTextContent('Cancel');
    expect(submit.getElement()).toHaveTextContent('Delete');
    return { input, submit, cancel, content: dialog.findContent() };
  }

  function deleteRequests() {
    return engine.aws
      .filter(({ method, url }) => method === 'DELETE' && FUNCTION_PATH.test(url.pathname))
      .map(({ url }) => FUNCTION_PATH.exec(url.pathname)?.[1]);
  }

  it('keeps deletion confirmation while the Test release reads finish independently', async () => {
    const versions = deferredAnswer();
    const aliases = deferredAnswer();
    engine.answerRelease = ({ url }) => (url.pathname.endsWith('/versions') ? versions.promise : aliases.promise);
    const { router } = await openLoaded();
    await waitFor(() => {
      expect(handed.test?.versions.loading).toBe(true);
      expect(handed.test?.aliases.loading).toBe(true);
      expect(engine.aws.filter(({ url }) => RELEASE_PATH.test(url.pathname))).toHaveLength(2);
    });

    await openDialog();
    const { input, submit } = deletionControls();
    const field = input.findNativeInput().getElement();
    field.focus();
    expect(submit.getElement()).toBeDisabled();
    input.setInputValue('confirm');
    expect(submit.getElement()).toBeEnabled();

    await act(async () => versions.resolve(versionAnswer('2')));
    await waitFor(() => {
      expect(handed.test?.versions.items).toContainEqual({ version: '2', description: 'Release 2' });
      expect(handed.test?.aliases.loading).toBe(true);
    });
    expect(deletionControls().input.getInputValue()).toBe('confirm');
    expect(field).toHaveFocus();
    expect(deletionControls().submit.getElement()).toBeEnabled();

    await act(async () => aliases.resolve(aliasAnswer('live', '2')));
    await waitFor(() => {
      expect(handed.test?.aliases.items).toEqual([{ name: 'live', version: '2' }]);
    });
    expect(deletionControls().input.getInputValue()).toBe('confirm');
    expect(field).toHaveFocus();
    expect(deletionControls().submit.getElement()).toBeEnabled();
    expect(deleteRequests()).toEqual([]);

    deletionControls().submit.click();
    await waitFor(() => expect(router.state.location.pathname).toBe('/aws/lambda/functions'));
    expect(deleteRequests()).toEqual(['orders']);
  });

  function expectFreshConfirmation(target: string) {
    const { input, submit, content } = deletionControls();
    expect(norm(content.find('li')?.getElement().textContent)).toBe(target);
    expect(input.getInputValue()).toBe('');
    expect(submit.getElement()).toBeDisabled();
    fireEvent.keyDown(input.findNativeInput().getElement(), { key: 'Enter' });
    submit.click();
    expect(deleteRequests()).toEqual([]);

    input.setInputValue('confirm');
    expect(submit.getElement()).toBeEnabled();
  }

  it.each(['another function', 'Cancel', 'Escape'] as const)(
    'requires fresh confirmation after %s',
    async (boundary) => {
      const { router } = await openLoaded();
      engine.functions.push({ name: 'payments' });
      const opener = pageDeleteAction()?.getElement();
      opener?.focus();
      const { input, submit, cancel } = await openDialog();
      const field = input.findNativeInput().getElement();
      field.focus();
      expect(field).toHaveFocus();
      input.setInputValue('confirm');
      expect(submit.getElement()).toBeEnabled();

      if (boundary === 'another function') {
        await act(() => router.navigate(pagePath('payments')));
        await screen.findByTestId('stand-in-test');
      } else {
        if (boundary === 'Cancel') {
          cancel.click();
        } else {
          fireEvent.keyDown(field, { key: 'Escape', keyCode: 27 });
        }
        expect(opener).toHaveFocus();
      }

      expect(deletionDialog()).toBeUndefined();
      await openDialog();
      expectFreshConfirmation(boundary === 'another function' ? 'payments' : 'orders');
    },
  );

  it('requires a fresh detail read and explicit confirmation after the first connected status', async () => {
    const beforeConnection = deferredAnswer();
    const afterConnection = deferredAnswer();
    connection.value = { engineOrigin, result: undefined };
    engine.functions = [{ ...ORDERS, description: 'Read while checking the connection' }];
    engine.answerFunction = () => beforeConnection.promise;
    const { router } = open(pagePath('orders'));

    const functionRequest = { method: 'GET', url: new URL('/2015-03-31/functions/orders', engineOrigin) };
    await waitFor(() => expect(engine.gets).toHaveLength(1));
    await act(async () => beforeConnection.resolve(engine.emulator(functionRequest)));
    await waitFor(() => {
      expect(value('Description')).toBe('Read while checking the connection');
    });
    const checkingDelete = pageDeleteAction();
    expect(checkingDelete?.getElement()).toHaveTextContent('Delete');
    expect(checkingDelete?.getElement()).toBeDisabled();
    checkingDelete?.click();
    expect(deletionDialog()).toBeUndefined();
    expect(deleteRequests()).toEqual([]);

    engine.functions = [{ ...ORDERS, description: 'Verified in the first connected session' }];
    engine.answerFunction = () => afterConnection.promise;
    connection.set(connectedResult());
    await waitFor(() => expect(engine.gets).toHaveLength(2));
    const pendingDelete = pageDeleteAction();
    pendingDelete?.click();
    expect(pendingDelete).toBeUndefined();
    expect(deletionDialog()).toBeUndefined();
    expect(deleteRequests()).toEqual([]);

    engine.answerFunction = (request) => engine.emulator(request);
    await act(async () => afterConnection.resolve(engine.emulator(functionRequest)));
    await waitFor(() => {
      expect(value('Description')).toBe('Verified in the first connected session');
    });
    await openDialog();
    expectFreshConfirmation('orders');
    expect(deleteRequests()).toEqual([]);

    deletionControls().submit.click();
    await waitFor(() => expect(router.state.location.pathname).toBe('/aws/lambda/functions'));
    expect(deleteRequests()).toEqual(['orders']);
  });

  it.each(['Test', 'Code'] as const)(
    'blocks deletion from %s until a same-endpoint, same-name replacement is verified',
    async (tab) => {
      const replacement = deferredAnswer();
      const { router } = await openLoaded();
      if (tab === 'Code') {
        await act(() => router.navigate(`${pagePath('orders')}?tab=code`));
        await screen.findByTestId('stand-in-code');
      }
      pageDeleteAction()?.getElement().focus();
      const refresh = pageActions()[0]?.getElement();
      expect(refresh).toHaveAccessibleName('Refresh');
      const { input, submit } = await openDialog();
      const field = input.findNativeInput().getElement();
      field.focus();
      expect(field).toHaveFocus();
      input.setInputValue('confirm');
      expect(submit.getElement()).toBeEnabled();
      const reads = engine.gets.length;

      connection.set(notStartedResult());
      expect(deletionDialog()).toBeUndefined();
      expect(refresh).toHaveFocus();
      expect(refresh).toBeEnabled();
      const disconnectedDelete = pageDeleteAction();
      expect(disconnectedDelete?.getElement()).toHaveTextContent('Delete');
      expect(disconnectedDelete?.getElement()).toBeDisabled();
      disconnectedDelete?.click();
      submit.click();
      expect(deletionDialog()).toBeUndefined();
      expect(deleteRequests()).toEqual([]);

      engine.functions = [{ ...ORDERS, description: 'Replacement at the same endpoint' }];
      engine.answerFunction = (request) =>
        request.method === 'GET' && FUNCTION_PATH.test(request.url.pathname)
          ? replacement.promise
          : engine.emulator(request);
      connection.set(connectedResult());
      await waitFor(() => expect(engine.gets).toHaveLength(reads + 1));
      expect(await screen.findByText('Loading function')).toBeVisible();
      const pendingDelete = pageDeleteAction();
      pendingDelete?.click();
      submit.click();
      fireEvent.keyDown(input.findNativeInput().getElement(), { key: 'Enter' });
      expect(pendingDelete).toBeUndefined();
      expect(deletionDialog()).toBeUndefined();
      expect(deleteRequests()).toEqual([]);

      await act(async () => {
        replacement.resolve(
          engine.emulator({ method: 'GET', url: new URL('/2015-03-31/functions/orders', engineOrigin) }),
        );
      });
      await waitFor(() => {
        expect(value('Description')).toBe('Replacement at the same endpoint');
      });
      await openDialog();
      expectFreshConfirmation('orders');
      expect(deleteRequests()).toEqual([]);

      deletionControls().submit.click();
      await waitFor(() => expect(router.state.location.pathname).toBe('/aws/lambda/functions'));
      expect(deleteRequests()).toEqual(['orders']);
    },
  );

  it('opens main’s dialog holding this one function; deleted: the list’s route with the result in its Flashbar', async () => {
    const { router } = await openLoaded();

    const { input, submit, content } = await openDialog();
    expect(content.findAll('li').map((item) => norm(item.getElement().textContent))).toEqual(['orders']);
    input.setInputValue('confirm');
    submit.click();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/lambda/functions');
    });
    await waitFor(() => {
      expect(flashTexts()).toEqual(['1 function was deleted from the local emulator.']);
    });
    expect(engine.functions).toEqual([]);
  });

  it('failed: the page stays, shows the failure and reads the function again, which is then not found', async () => {
    const { router } = await openLoaded();
    const { input, submit } = await openDialog();
    // Deleted elsewhere meanwhile.
    engine.functions = [];
    const reads = engine.gets.length;

    input.setInputValue('confirm');
    submit.click();

    await waitFor(() => {
      expect(flashTexts()).toEqual([
        `Deleting orders failed ResourceNotFoundException: Function not found: ${ACCOUNT_ARN}:orders`,
      ]);
    });
    expect(router.state.location.pathname).toBe(pagePath('orders'));
    expect(await screen.findByText('Function not found')).toBeInTheDocument();
    expect(engine.gets.length).toBeGreaterThan(reads);
  });

  function openWithRecordedDeleteOutcomes() {
    const shown = vi.fn<PageFlash['show']>();
    const handedOver = vi.fn<PageFlash['handOver']>();
    const root = { current: null as HTMLDivElement | null };

    function Page() {
      const [items, setItems] = useState<FlashResult>();
      const current = useSyncExternalStore(connection.subscribe, connection.get);
      return (
        <AreaRootContext.Provider value={root}>
          <PageFlashContext.Provider
            value={{
              show: (result) => {
                shown(result);
                setItems(result);
              },
              handOver: handedOver,
            }}
          >
            <div
              ref={(element) => {
                root.current = element;
              }}
            >
              {items !== undefined && <Flashbar items={[...items]} />}
              <FunctionPage connection={current} params={{ name: 'orders' }} />
            </div>
          </PageFlashContext.Provider>
        </AreaRootContext.Provider>
      );
    }

    engine.functions = [ORDERS];
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[pagePath('orders')]}>
          <Page />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return { shown, handedOver };
  }

  it.each(['success', 'refusal'] as const)(
    'delivers one delete %s after an Invoke reread removes the confirmation in the same session',
    async (outcome) => {
      const invoke = deferredAnswer();
      const deletion = deferredAnswer();
      const detail = deferredAnswer();
      engine.answerInvoke = () => invoke.promise;
      engine.answerDelete = () => deletion.promise;
      const { shown, handedOver } = openWithRecordedDeleteOutcomes();
      await screen.findByTestId('stand-in-test');
      fireEvent.click(screen.getByRole('button', { name: 'Stand-in invoke' }));
      await waitFor(() => expect(engine.aws.filter(({ url }) => INVOKE_PATH.test(url.pathname))).toHaveLength(1));

      const { input, submit, cancel, content } = await openDialog();
      expect(cancel.getElement()).toBeEnabled();
      expect(deletionDialog()?.findHeader().findButton()?.getElement()).toHaveAccessibleName('Close modal');
      input.setInputValue('confirm');
      const field = input.findNativeInput().getElement();
      field.focus();
      act(() => {
        fireEvent.keyDown(field, { key: 'Enter' });
        fireEvent.keyDown(field, { key: 'Enter' });
      });
      await waitFor(() => expect(deleteRequests()).toEqual(['orders']));
      await waitFor(() => {
        expect(content.getElement()).toHaveTextContent('Deleting functions…');
        expect(cancel.getElement()).toBeDisabled();
        expect(deletionDialog()?.findHeader().findAllButtons()).toHaveLength(0);
        expect(submit.getElement()).toHaveAttribute('aria-disabled', 'true');
        expect(submit.getElement()).toHaveFocus();
      });
      cancel.click();
      fireEvent.keyDown(submit.getElement(), { key: 'Escape', keyCode: 27 });
      expect(deletionDialog()).toBeDefined();
      expect(submit.getElement()).toHaveFocus();
      expect(deleteRequests()).toEqual(['orders']);
      const reads = engine.gets.length;
      engine.answerFunction = () => detail.promise;

      await act(async () => invoke.resolve(json(200, { invoked: true })));
      await waitFor(() => expect(engine.gets).toHaveLength(reads + 1));
      engine.functions = [];
      engine.answerFunction = (request) => engine.emulator(request);
      await act(async () => detail.resolve(errorAnswer(404, 'ResourceNotFoundException', 'Function not found')));

      expect(await screen.findByText('Function not found')).toBeVisible();
      expect(deletionDialog()).toBeUndefined();
      expect(shown).not.toHaveBeenCalled();
      expect(handedOver).not.toHaveBeenCalled();

      await act(async () => {
        deletion.resolve(
          outcome === 'success'
            ? { status: 204, body: '' }
            : errorAnswer(404, 'ResourceNotFoundException', 'Already removed'),
        );
      });
      if (outcome === 'success') {
        await waitFor(() => expect(handedOver).toHaveBeenCalledTimes(1));
        expect(handedOver).toHaveBeenCalledWith('/aws/lambda/functions', [
          { type: 'success', content: '1 function was deleted from the local emulator.' },
        ]);
        expect(shown).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(shown).toHaveBeenCalledTimes(1));
        expect(flashTexts()).toEqual(['Deleting orders failed ResourceNotFoundException: Already removed']);
        expect(handedOver).not.toHaveBeenCalled();
      }
      expect(deleteRequests()).toEqual(['orders']);
    },
  );

  it.each(['leaving the page', 'replacing the session'] as const)(
    'does not dispatch an offline deletion after %s',
    async (boundary) => {
      const { client, router, unmount } = await openLoaded();
      const wasOnline = onlineManager.isOnline();
      try {
        act(() => onlineManager.setOnline(false));
        const { input, submit } = await openDialog();
        input.setInputValue('confirm');
        submit.click();
        await waitFor(() => {
          expect(client.getMutationCache().getAll()).toHaveLength(1);
          expect(client.getMutationCache().getAll()[0]?.state.isPaused).toBe(true);
        });
        const queued = client.getMutationCache().getAll()[0];
        expect(deleteRequests()).toEqual([]);

        if (boundary === 'leaving the page') {
          await act(() => router.navigate('/'));
        } else {
          connection.set(notStartedResult());
        }
        expect(deletionDialog()).toBeUndefined();
        engine.functions = [{ ...ORDERS, description: 'Replacement before the queued deletion resumes' }];
        if (boundary === 'replacing the session') {
          connection.set(connectedResult());
        }

        await act(async () => {
          onlineManager.setOnline(true);
          await client.resumePausedMutations();
        });
        await waitFor(() => {
          expect(queued?.state.status).toBe('error');
          expect(queued?.state.error).toMatchObject({ name: 'AbortError' });
        });
        expect(deleteRequests()).toEqual([]);

        if (boundary === 'leaving the page') {
          await act(() => router.navigate(pagePath('orders')));
        }
        await waitFor(() => {
          expect(value('Description')).toBe('Replacement before the queued deletion resumes');
        });
        expect(deleteRequests()).toEqual([]);
      } finally {
        unmount();
        onlineManager.setOnline(wasOnline);
      }
    },
  );

  it.each(['test', 'versions'] as const)(
    'reports reconnect progress and requires a new verified confirmation on %s',
    async (tab) => {
      const replacementRead = deferredAnswer();
      const versions = deferredAnswer();
      const aliases = deferredAnswer();
      const { client, router, unmount } = await openLoaded();
      if (tab === 'versions') {
        fireEvent.click(tabLink('versions'));
        await waitFor(() => {
          expect(releaseTable('Versions')?.findBodyCell(1, 1)?.getElement()).toHaveTextContent('$LATEST');
        });
      }
      const announcements = recordAnnouncements();
      const notice = () => PAGE.findContentLayout()?.findNotifications()?.findAlert() ?? null;
      const confirmationHint = 'The delete confirmation closed. Reopen Delete after verification.';
      async function expectNotice(header: string, detail: string) {
        expect(notice()?.findHeader()?.getElement()).toHaveTextContent(header);
        expect(notice()?.findContent().getElement()).toHaveTextContent(detail);
        await waitFor(() => {
          expect(announcements.some((message) => message.includes(header) && message.includes(detail))).toBe(true);
        });
      }
      const wasOnline = onlineManager.isOnline();
      const browserOnline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      try {
        const oldHealth = connection.value.result;
        const { input, submit } = await openDialog();
        input.setInputValue('confirm');
        // Model the query queue pausing before the old page receives its browser event.
        act(() => onlineManager.setOnline(false));
        submit.click();
        await waitFor(() => {
          expect(client.getMutationCache().getAll()[0]?.state.isPaused).toBe(true);
        });
        const queued = client.getMutationCache().getAll()[0];
        expect(deleteRequests()).toEqual([]);

        browserOnline.mockReturnValue(false);
        fireEvent(window, new Event('offline'));
        expect(deletionDialog()).toBeUndefined();
        await expectNotice('Browser is offline', confirmationHint);
        expect(PAGE.find('.aws-area-emulator-line')?.getElement()).toHaveTextContent('Connected at');
        if (tab === 'versions') {
          expect(tabs()?.findTabContent()?.findStatusIndicator()?.getElement()).toHaveTextContent(
            'Versions and aliases are unavailable until the emulator reconnects.',
          );
          expect(releaseTable('Versions')).toBeUndefined();
          expect(releaseTable('Aliases')).toBeUndefined();
        }

        engine.functions = [{ ...ORDERS, description: 'Replacement while the browser was offline' }];
        engine.answerRelease = ({ url }) => (url.pathname.endsWith('/versions') ? versions.promise : aliases.promise);
        engine.answerFunction = (request) =>
          request.method === 'GET' && FUNCTION_PATH.test(request.url.pathname)
            ? replacementRead.promise
            : engine.emulator(request);

        browserOnline.mockReturnValue(true);
        await act(async () => {
          window.dispatchEvent(new Event('online'));
          await client.resumePausedMutations();
        });
        await waitFor(() => {
          expect(queued?.state.status).toBe('error');
          expect(queued?.state.error).toMatchObject({ name: 'AbortError' });
        });
        expect(onlineManager.isOnline()).toBe(true);
        expect(connection.value.result).toBe(oldHealth);
        await expectNotice('Rechecking the emulator connection', confirmationHint);
        expect(PAGE.find('.aws-area-emulator-line')?.getElement()).toHaveTextContent('Connected at');
        if (tab === 'versions') {
          expect(tabs()?.findTabContent()?.findStatusIndicator()?.getElement()).toHaveTextContent(
            'Waiting for function verification',
          );
          expect(releaseTable('Versions')).toBeUndefined();
          expect(releaseTable('Aliases')).toBeUndefined();
        }
        expect(router.state.location.pathname).toBe(pagePath('orders'));
        expect(deleteRequests()).toEqual([]);
        const beforeHealthDelete = pageDeleteAction();
        expect(beforeHealthDelete?.getElement()).toHaveTextContent('Delete');
        expect(beforeHealthDelete?.getElement()).toBeDisabled();
        beforeHealthDelete?.click();
        expect(deletionDialog()).toBeUndefined();

        const beforeHealthReads = engine.gets.length;
        connection.set(connectedResult());
        await waitFor(() => expect(engine.gets.length).toBeGreaterThan(beforeHealthReads));
        await expectNotice('Verifying the function', confirmationHint);
        expect(tabs()).toBeNull();
        pageDeleteAction()?.click();
        expect(deletionDialog()).toBeUndefined();
        expect(deleteRequests()).toEqual([]);

        const request = { method: 'GET', url: new URL('/2015-03-31/functions/orders', engineOrigin) };
        await act(async () => replacementRead.resolve(engine.emulator(request)));
        await waitFor(() => expect(value('Description')).toBe('Replacement while the browser was offline'));
        await expectNotice('Function verified', 'Reopen Delete to confirm deletion again.');
        if (tab === 'versions') {
          const publish = () => releaseTable('Versions')?.findHeaderSlot()?.findHeader()?.findActions()?.findButton();
          expect(releaseTable('Versions')?.findLoadingText()?.getElement()).toHaveTextContent('Loading versions');
          expect(releaseTable('Aliases')?.findLoadingText()?.getElement()).toHaveTextContent('Loading aliases');
          expect(publish()?.getElement()).toHaveTextContent('Publish version');
          expect(publish()?.isDisabled()).toBe(true);
          publish()?.click();
          expect(engine.aws.filter(({ method, url }) => method === 'POST' && RELEASE_PATH.test(url.pathname))).toEqual(
            [],
          );

          await act(async () => {
            versions.resolve(json(200, { Versions: [] }));
            aliases.resolve(json(200, { Aliases: [] }));
          });
          await waitFor(() => {
            expect(releaseTable('Versions')?.findEmptySlot()?.getElement()).toHaveTextContent('No versions returned.');
            expect(releaseTable('Aliases')?.findEmptySlot()?.getElement()).toHaveTextContent('No aliases');
            expect(publish()?.isDisabled()).toBe(false);
          });
        } else {
          await act(async () => {
            versions.resolve(versionAnswer('2'));
            aliases.resolve(aliasAnswer('live', '2'));
          });
        }
        await openDialog();
        expect(notice()).toBeNull();
        expectFreshConfirmation('orders');
        expect(deleteRequests()).toEqual([]);

        deletionControls().submit.click();
        await waitFor(() => expect(router.state.location.pathname).toBe('/aws/lambda/functions'));
        expect(deleteRequests()).toEqual(['orders']);
      } finally {
        unmount();
        browserOnline.mockRestore();
        onlineManager.setOnline(wasOnline);
      }
    },
  );

  it('delivers an already dispatched delete after a native connectivity cycle within the same session', async () => {
    const deletion = deferredAnswer();
    engine.answerDelete = () => deletion.promise;
    const { shown, handedOver } = openWithRecordedDeleteOutcomes();
    await screen.findByTestId('stand-in-test');
    const wasOnline = onlineManager.isOnline();
    const browserOnline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      const { input, submit } = await openDialog();
      input.setInputValue('confirm');
      submit.click();
      await waitFor(() => expect(deleteRequests()).toEqual(['orders']));

      browserOnline.mockReturnValue(false);
      fireEvent(window, new Event('offline'));
      expect(deletionDialog()).toBeUndefined();
      browserOnline.mockReturnValue(true);
      fireEvent(window, new Event('online'));

      await act(async () => deletion.resolve({ status: 204, body: '' }));
      await waitFor(() => expect(handedOver).toHaveBeenCalledTimes(1));
      expect(shown).not.toHaveBeenCalled();
      expect(deleteRequests()).toEqual(['orders']);
    } finally {
      browserOnline.mockRestore();
      onlineManager.setOnline(wasOnline);
    }
  });

  it('ignores a submitted deletion that settles after the same-name function reconnects', async () => {
    const deletion = deferredAnswer();
    engine.answerDelete = () => deletion.promise;
    const { shown, handedOver } = openWithRecordedDeleteOutcomes();
    await screen.findByTestId('stand-in-test');
    const { input, submit } = await openDialog();
    input.setInputValue('confirm');
    submit.click();
    await waitFor(() => expect(deleteRequests()).toEqual(['orders']));

    connection.set(notStartedResult());
    expect(deletionDialog()).toBeUndefined();
    engine.functions = [{ ...ORDERS, description: 'Replacement after submitted deletion' }];
    connection.set(connectedResult());
    await waitFor(() => {
      expect(value('Description')).toBe('Replacement after submitted deletion');
    });

    await act(async () => {
      deletion.resolve({ status: 204, body: '' });
      await deletion.promise;
    });
    expect(shown).not.toHaveBeenCalled();
    expect(handedOver).not.toHaveBeenCalled();
    expect(deleteRequests()).toEqual(['orders']);
    const reopened = await openDialog();
    expect(reopened.input.getInputValue()).toBe('');
    expect(reopened.submit.getElement()).toBeDisabled();
  });

  it('is not offered while the function is not found', async () => {
    open(pagePath('gone'));

    await screen.findByText('Function not found');
    expect(pageDeleteAction()).toBeUndefined();
  });
});

describe('ready', () => {
  it('while the function is being created or updated each tab is told it is not ready; once the read says it is done, ready', async () => {
    engine.functions = [
      {
        ...ORDERS,
        moments: [
          { state: 'Active', lastUpdateStatus: 'InProgress' },
          { state: 'Active', lastUpdateStatus: 'Successful' },
        ],
      },
    ];
    open(`${pagePath('orders')}?tab=code`);
    await screen.findByTestId('stand-in-code');
    expect(handed.code?.ready).toBe(false);

    await waitFor(
      () => {
        expect(handed.code?.ready).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it('a Pending function hands "Configuration" not ready, and "Test" its invoke all the same', async () => {
    engine.functions = [{ ...ORDERS, moments: [{ state: 'Pending' }, { state: 'Pending' }] }];
    open(`${pagePath('orders')}?tab=configuration`);
    await screen.findByTestId('stand-in-configuration');

    expect(handed.configuration?.ready).toBe(false);
  });
});
