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

// A function's page rendered inside the area's layout, as Studio's frame renders the area, against a fake engine
// behind the page's `fetch` (test-criteria.md, issue 84, "Unit — services/lambda/pages/function-page.test.tsx").

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

const FUNCTION_PATH = /^\/2015-03-31\/functions\/([^/]+)$/;
const URL_PATH = /^\/2021-10-31\/functions\/([^/]+)\/url$/;

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
  /** The answer to `GetFunction`; by default the emulator's. */
  answerFunction: (request: SentRequest) => EngineAnswer = (request) => this.emulator(request);
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
    const sent = { method: request.method, url };
    this.aws.push(sent);
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
    return new Response(answer.body, {
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
  return { ...result, router };
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function headingText(): string {
  return norm(screen.getByRole('heading', { level: 1 }).textContent);
}

/** The key-value pairs of the section titled `title`, as label and value text, in order. */
function section(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: title });
  const container = PAGE.findAllContainers().find((found) => found.getElement().contains(heading));
  expect(container).toBeDefined();
  return (container as NonNullable<typeof container>).getElement();
}

function pairs(title: string): [string, string][] {
  const found = createWrapper(section(title)).findKeyValuePairs();
  expect(found).not.toBeNull();
  return (found?.findItems() ?? []).map((item) => [
    norm(item.findLabel()?.getElement().textContent),
    norm(item.findValue()?.getElement().textContent),
  ]);
}

function value(title: string, label: string): string | undefined {
  return pairs(title).find(([key]) => key === label)?.[1];
}

function tabs() {
  return PAGE.findTabs();
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

function description(): string {
  return norm(
    PAGE.findAllHeaders()
      .find((h) => h.getElement() === header())
      ?.findDescription()
      ?.getElement().textContent,
  );
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

async function openLoaded(fn: FakeFunction = ORDERS) {
  engine.functions = [fn];
  const opened = open(pagePath(fn.name));
  await screen.findByRole('heading', { level: 2, name: 'Function overview' });
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------

describe('a function loaded', () => {
  it('the h1 its name, "Refresh", the six tabs with "Code" current, "Function overview" and "Runtime settings" with their fields in order', async () => {
    await openLoaded();

    expect(headingText()).toBe('orders');
    expect(within(header()).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    const found = tabs();
    expect(found).not.toBeNull();
    expect((found?.findTabLinks() ?? []).map((tab) => norm(tab.getElement().textContent))).toEqual([
      'Code',
      'Test',
      'Monitor',
      'Configuration',
      'Aliases',
      'Versions',
    ]);
    expect(norm(found?.findActiveTab()?.getElement().textContent)).toBe('Code');
    expect(pairs('Function overview').map(([label]) => label)).toEqual([
      'Description',
      'Last modified',
      'Function ARN',
      'Function URL',
    ]);
    expect(pairs('Runtime settings')).toEqual([
      ['Runtime', 'Node.js 22.x'],
      ['Handler', 'index.handler'],
      ['Architecture', 'arm64'],
    ]);
    expect(value('Function overview', 'Description')).toBe('Takes the orders');
    expect(value('Function overview', 'Last modified')).toMatch(
      /^November \d{1,2}, 2026, \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/,
    );
    expect(value('Function overview', 'Function ARN')).toBe(`${ACCOUNT_ARN}:orders`);
    // "Runtime settings" is the content of the tab "Code".
    expect(found?.findTabContent()?.getElement()).toContainElement(section('Runtime settings'));
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
    expect(description()).toBe('This function is in your local emulator, not in an AWS account.');
    expect(PAGE.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute('href', '/aws/lambda/functions');
  });

  it('each tab but "Code" leads to its route below the function’s path', async () => {
    const { router } = await openLoaded();

    const links = tabs()?.findTabLinks() ?? [];
    const hrefs = links.map((tab) => tab.getElement().getAttribute('href'));
    expect(hrefs.slice(1)).toEqual(
      ['test', 'monitor', 'configuration', 'aliases', 'versions'].map((tab) => `${pagePath('orders')}/${tab}`),
    );
    const sent = engine.gets.length;
    fireEvent.click(links[1]?.getElement() as HTMLElement);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`${pagePath('orders')}/test`);
    });
    // A route change of the area, with nothing sent to the emulator.
    expect(engine.gets).toHaveLength(sent);
    expect(screen.queryByRole('heading', { level: 2, name: 'Function overview' })).toBeNull();
  });

  it('"Function URL": the URL as text and not a link; "-" without one; "Not read" when it failed; "Not implemented by the emulator" on 501; the other values shown each time', async () => {
    const first = await openLoaded();
    expect(value('Function overview', 'Function URL')).toBe(ORDERS.url);
    expect(within(section('Function overview')).queryByRole('link')).toBeNull();
    first.unmount();

    const second = await openLoaded({ ...ORDERS, url: undefined });
    expect(value('Function overview', 'Function URL')).toBe('-');
    second.unmount();

    engine.answerUrl = () => errorAnswer(500, 'ServiceException', 'broken');
    const third = await openLoaded();
    // The one status indicator of the section is the URL's.
    expect(statusIn(section('Function overview'))).toEqual({ type: 'warning', text: 'Not read' });
    expect(value('Function overview', 'Function URL')).toBe('Not read');
    expect(value('Function overview', 'Function ARN')).toBe(`${ACCOUNT_ARN}:orders`);
    expect(value('Runtime settings', 'Handler')).toBe('index.handler');
    third.unmount();

    engine.answerUrl = () => errorAnswer(501, 'NotImplemented', 'GetFunctionUrlConfig is not implemented');
    await openLoaded();
    expect(value('Function overview', 'Function URL')).toBe('Not implemented by the emulator');
    expect(value('Function overview', 'Description')).toBe('Takes the orders');
    expect(value('Runtime settings', 'Runtime')).toBe('Node.js 22.x');
  });

  it('the page shows neither the signed URL of the code nor an environment variable of the answer', async () => {
    await openLoaded();

    expect(document.body.textContent).not.toContain('X-Amz-Signature');
    expect(document.body.textContent).not.toContain('signed-code-location');
    expect(document.body.textContent).not.toContain('orders-secret-value');
    expect(document.body.textContent).not.toContain('SECRET');
  });

  it('a description `<b id="injected">x</b>` is shown as that text, no element made from it', async () => {
    await openLoaded({ ...ORDERS, description: '<b id="injected">x</b>' });

    expect(value('Function overview', 'Description')).toBe('<b id="injected">x</b>');
    expect(document.getElementById('injected')).toBeNull();
  });
});

describe('the status line', () => {
  it('State Active, last update Successful: no status under the description', async () => {
    await openLoaded();

    expect(description()).toBe('This function is in your local emulator, not in an AWS account.');
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
      // The status is a line of its own under the description, its reason after it as text.
      expect(description()).toBe(
        `This function is in your local emulator, not in an AWS account.${status.text}${
          reason === undefined ? '' : ` ${reason}`
        }`,
      );
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
      expect(value('Function overview', 'Description')).toBe('Takes more orders');
    });
    expect(engine.gets).toHaveLength(2);
    expect(engine.urlGets).toHaveLength(2);
    await waitFor(() => {
      expect(said).toContain('Function refreshed');
    });
    expect(said.filter((text) => text === 'Function refreshed')).toHaveLength(1);
  });
});

describe('a function the emulator does not hold', () => {
  it('ResourceNotFoundException: the h1 the name, "Function not found", its sentence and the link "Event Functions"; no tabs and no section', async () => {
    const { router } = open(pagePath('gone'));

    await screen.findByText('Function not found');
    expect(headingText()).toBe('gone');
    expect(
      screen.getByText(
        'The emulator holds no function named “gone”. It may have been deleted, or the emulator restarted.',
      ),
    ).toBeInTheDocument();
    expect(tabs()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Function overview' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Runtime settings' })).toBeNull();
    // The content's link, not the crumb's or the side navigation's.
    const content = PAGE.findAllContainers().find((found) =>
      found.getElement().textContent.includes('Function not found'),
    );
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
