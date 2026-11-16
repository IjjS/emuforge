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

// The bucket list rendered inside the area's layout, as Studio's frame renders the area, against a fake engine
// behind the page's `fetch` (test-criteria.md, issue 56, "Unit — services/s3/pages/bucket-list-page.test.tsx").

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

interface FakeBucket {
  name: string;
  region?: string;
  date?: string;
  arn?: string;
}

interface Answer {
  status: number;
  body: string;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function bucketXml({ name, region, date, arn }: FakeBucket): string {
  return `<Bucket><Name>${xml(name)}</Name>${date === undefined ? '' : `<CreationDate>${date}</CreationDate>`}${
    region === undefined ? '' : `<BucketRegion>${region}</BucketRegion>`
  }${arn === undefined ? '' : `<BucketArn>${xml(arn)}</BucketArn>`}</Bucket>`;
}

function listAnswer(buckets: FakeBucket[], token?: string): Answer {
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>${buckets
      .map(bucketXml)
      .join('')}</Buckets>${
      token === undefined ? '' : `<ContinuationToken>${token}</ContinuationToken>`
    }</ListAllMyBucketsResult>`,
  };
}

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${xml(code)}</Code><Message>${xml(message)}</Message></Error>`,
  };
}

class FakeEngine {
  /** The buckets the emulator holds, in its order (names ascending). */
  buckets: FakeBucket[] = [];
  /** Every AWS request, its URL as sent. */
  readonly aws: URL[] = [];
  readonly sessions: URL[] = [];
  /** The answer to the next AWS requests; by default the emulator's listing of `buckets`. */
  answer: (url: URL, token: string | null) => EngineAnswer = (url) => this.listing(url);
  private sessionCount = 0;

  /** `ListBuckets` over `buckets`: `max-buckets`, `prefix` and `continuation-token` (the index of the next bucket). */
  listing(url: URL): Answer {
    const size = Number(url.searchParams.get('max-buckets') ?? '1000');
    const prefix = url.searchParams.get('prefix') ?? '';
    const from = Number(url.searchParams.get('continuation-token') ?? '0');
    const matching = this.buckets.filter((bucket) => bucket.name.startsWith(prefix));
    const page = matching.slice(from, from + size);
    const next = from + size < matching.length ? String(from + size) : undefined;
    return listAnswer(page, next);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      this.sessions.push(url);
      this.sessionCount += 1;
      return new Response(JSON.stringify({ token: `token-${String(this.sessionCount)}` }), { status: 200 });
    }
    this.aws.push(url);
    const answer = await Promise.race([
      Promise.resolve(this.answer(url, request.headers.get('x-emuforge-session'))),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(answer.body, { status: answer.status });
  };

  /** The `ListBuckets` requests sent so far. */
  get lists(): URL[] {
    return this.aws.filter((url) => url.pathname === '/' && url.searchParams.get('x-id') === 'ListBuckets');
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

const EMULATOR_PORT = 9304;
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
let nextPort = 8900;
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
      onPageTitle={() => undefined}
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path = '/aws/s3/buckets') {
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

/** The table's own heading, level 2, as shown: "General purpose buckets (3)". */
function titleText(): string {
  const heading = within(tableElement()).getByRole('heading', { level: 2 });
  return (heading.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The data rows' cells as text, by the column headings. */
function rows(): { name: string; region: string; date: string }[] {
  return (table().findRows() ?? []).map((row) => {
    const cells = [...row.getElement().querySelectorAll('td, th')].map((cell) =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    // The first cell holds the radio.
    return { name: cells[1] ?? '', region: cells[2] ?? '', date: cells[3] ?? '' };
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
    element.textContent === text &&
    [...element.children].every((child) => child.textContent !== text);
}

/** The table's empty slot, which a case expects to be there. */
function slot(): HTMLElement {
  const found = emptySlot();
  expect(found).not.toBeNull();
  return found as HTMLElement;
}

function emptySlot(): HTMLElement | null {
  return table().findEmptySlot()?.getElement() ?? null;
}

function action(name: string): HTMLElement {
  return within(tableElement()).getByRole('button', { name });
}

/** A Cloudscape button is disabled by `disabled`, or with a reason by `aria-disabled`. */
function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function filterInput(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Find buckets by name' });
}

function typeFilter(text: string) {
  fireEvent.change(filterInput(), { target: { value: text } });
}

function radio(name: string): HTMLInputElement {
  return screen.getByRole('radio', { name: `Select ${name}` });
}

function select(name: string) {
  fireEvent.click(radio(name));
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

function bucket(name: string, extra: Partial<FakeBucket> = {}): FakeBucket {
  return {
    name,
    region: 'ap-northeast-2',
    date: '2026-10-30T14:18:34.000Z',
    arn: `arn:aws:s3:::${name}`,
    ...extra,
  };
}

const ALPHA = bucket('alpha');
const BETA = bucket('beta', { region: 'us-east-1', date: '2026-11-01T00:00:00.000Z' });
const THREE = [ALPHA, BETA, bucket('gamma', { region: 'xx-unknown-9' })];

async function openLoaded(buckets: FakeBucket[] = THREE, path?: string) {
  engine.buckets = buckets;
  const opened = open(path);
  await expectNames(buckets.map((b) => b.name));
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------

describe('the bucket list, loaded', () => {
  it('three buckets: the h1, the tabs, the counted heading, the columns in order, one row per bucket in the answer’s order', async () => {
    await openLoaded();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Buckets');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['General purpose buckets', 'Directory buckets']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(titleText()).toBe('General purpose buckets (3)');
    const headings = (table().findColumnHeaders() ?? []).map((header) => header.getElement().textContent);
    // The first heading is the selection column's, named by its group.
    expect(headings).toEqual(['General purpose bucket selection', 'Name', 'AWS Region', 'Creation date']);
    expect(names()).toEqual(['alpha', 'beta', 'gamma']);
    expect(rows().map((row) => row.region)).toEqual([
      'Asia Pacific (Seoul) ap-northeast-2',
      'US East (N. Virginia) us-east-1',
      'xx-unknown-9',
    ]);
    for (const row of rows()) {
      expect(row.date).toMatch(/^(October|November) \d{1,2}, 2026, \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
    }
    for (const name of names()) {
      const link = within(tableElement()).getByRole('link', { name });
      expect(link).toHaveAttribute('href', `/aws/s3/buckets/${name}`);
      expect(screen.getByRole('rowheader', { name })).toContainElement(link);
    }
    expect(screen.getByRole('columnheader', { name: 'General purpose bucket selection' })).toBeInTheDocument();
  });

  it('the actions in order, the filter, the pagination, "Preferences" and "Info"', async () => {
    await openLoaded();

    const order = ['Info', 'Refresh Buckets', 'Copy ARN', 'Empty', 'Delete', 'Create bucket'].map((name) =>
      within(tableElement()).getByRole('button', { name }),
    );
    order.reduce((before, button) => {
      expect(before.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      return button;
    });
    expect(filterInput()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preferences' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Info' })).toBeInTheDocument();
  });

  it('no column heading has a sorting control', async () => {
    await openLoaded();

    for (const header of table().findColumnHeaders()) {
      expect(header.getElement()).not.toHaveAttribute('aria-sort');
      expect(within(header.getElement()).queryByRole('button')).toBeNull();
    }
    expect(table().findColumnSortingArea(1)).toBeNull();
  });
});

describe('selection and the actions', () => {
  it('no row selected: "Copy ARN", "Empty" and "Delete" are disabled with "Select a bucket first"', async () => {
    await openLoaded();

    for (const name of ['Copy ARN', 'Empty', 'Delete']) {
      expect(isDisabled(action(name))).toBe(true);
      expect(action(name)).toHaveAccessibleDescription('Select a bucket first');
    }
    expect(isDisabled(action('Create bucket'))).toBe(false);
    expect(isDisabled(action('Refresh Buckets'))).toBe(false);
  });

  it('a row selected by its radio: the three are enabled; another selected: only that one is', async () => {
    await openLoaded();

    select('alpha');
    for (const name of ['Copy ARN', 'Empty', 'Delete']) {
      expect(isDisabled(action(name))).toBe(false);
    }
    expect(radio('alpha')).toBeChecked();
    select('beta');
    expect(radio('beta')).toBeChecked();
    expect(radio('alpha')).not.toBeChecked();
    expect(screen.getAllByRole('radio').filter((input) => (input as HTMLInputElement).checked)).toHaveLength(1);
  });

  it('a bucket whose answer had no ARN: "Copy ARN" is disabled with "The emulator returned no ARN for this bucket"', async () => {
    await openLoaded([{ name: 'alpha', region: 'ap-northeast-2', date: '2026-10-30T14:18:34.000Z' }, bucket('beta')]);

    select('alpha');
    expect(isDisabled(action('Copy ARN'))).toBe(true);
    expect(action('Copy ARN')).toHaveAccessibleDescription('The emulator returned no ARN for this bucket');
    expect(isDisabled(action('Empty'))).toBe(false);
  });

  it('"Copy ARN" with the clipboard accepting: the answer’s ARN on the clipboard, "ARN copied" shown and announced, no request', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await openLoaded([bucket('alpha', { arn: 'arn:aws:s3:::alpha-as-the-emulator-wrote-it' })]);
    const said = recordAnnouncements();
    const sent = engine.aws.length;

    select('alpha');
    fireEvent.click(action('Copy ARN'));

    await waitFor(() => {
      expect(within(tableElement()).getByText('ARN copied')).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith('arn:aws:s3:::alpha-as-the-emulator-wrote-it');
    expect(said).toContain('ARN copied');
    expect(engine.aws.length).toBe(sent);
  });

  it('"Copy ARN" with the clipboard refusing: "Couldn\'t copy the ARN" shown and announced, never "ARN copied"', async () => {
    const writeText = vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await openLoaded([bucket('alpha')]);
    const said = recordAnnouncements();

    select('alpha');
    fireEvent.click(action('Copy ARN'));

    await waitFor(() => {
      expect(within(tableElement()).getByText("Couldn't copy the ARN")).toBeInTheDocument();
    });
    expect(said).toEqual(["Couldn't copy the ARN"]);
    expect(within(tableElement()).queryByText('ARN copied')).toBeNull();
  });

  it.each([
    ['Empty', '/aws/s3/bucket/alpha/empty'],
    ['Delete', '/aws/s3/bucket/alpha/delete'],
    ['Create bucket', '/aws/s3/bucket/create'],
  ])('"%s" leads to %s without a request to the engine', async (name, path) => {
    const { router } = await openLoaded();
    const sent = engine.aws.length;

    select('alpha');
    fireEvent.click(action(name));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(path);
    });
    expect(engine.aws.length).toBe(sent);
  });

  it('a name leads to the bucket’s route and the tab "Directory buckets" to /aws/s3/directory-buckets, without a request', async () => {
    const { router } = await openLoaded([bucket('my bucket%/x')]);
    const sent = engine.aws.length;

    fireEvent.click(within(tableElement()).getByRole('link', { name: 'my bucket%/x' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/s3/buckets/my%20bucket%25%2Fx');
    });
    act(() => {
      void router.navigate('/aws/s3/buckets');
    });
    await expectNames(['my bucket%/x']);
    const read = engine.aws.length;
    fireEvent.click(screen.getByRole('tab', { name: 'Directory buckets' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/s3/directory-buckets');
    });
    expect(engine.aws.length).toBe(read);
    expect(sent).toBe(1);
  });

  it('"Refresh Buckets": a new request, "Bucket list refreshed" announced, a selected bucket still there stays selected, one gone does not', async () => {
    await openLoaded();
    const said = recordAnnouncements();

    select('beta');
    engine.buckets = [ALPHA, BETA, bucket('delta')];
    fireEvent.click(action('Refresh Buckets'));
    await expectNames(['alpha', 'beta', 'delta']);
    expect(engine.lists).toHaveLength(2);
    await waitFor(() => {
      expect(said).toContain('Bucket list refreshed');
    });
    expect(radio('beta')).toBeChecked();

    engine.buckets = [ALPHA, bucket('delta')];
    fireEvent.click(action('Refresh Buckets'));
    await expectNames(['alpha', 'delta']);
    expect(engine.lists).toHaveLength(3);
    expect(screen.getAllByRole('radio').filter((input) => (input as HTMLInputElement).checked)).toHaveLength(0);
    expect(isDisabled(action('Empty'))).toBe(true);
    await waitFor(() => {
      expect(said.filter((text) => text === 'Bucket list refreshed')).toHaveLength(2);
    });
  });

  it('a name and an error message with markup are shown as text, no element made from them', async () => {
    const name = '<img src=x onerror=alert(1)>';
    await openLoaded([bucket(name)]);

    expect(names()).toEqual([name]);
    expect(document.querySelector('img')).toBeNull();

    engine.answer = () => errorAnswer(500, 'InternalError', '<b id="injected">bold</b>');
    fireEvent.click(action('Refresh Buckets'));
    await waitFor(() => {
      expect(emptySlot()).toHaveTextContent('InternalError: <b id="injected">bold</b>');
    });
    expect(document.getElementById('injected')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('the description and the notice', () => {
  it('connected: the description with the connection’s endpoint; otherwise without one', async () => {
    await openLoaded();

    expect(
      screen.getByText(byWholeText(`Buckets in your local emulator at ${EMULATOR_ENDPOINT}, not in an AWS account.`)),
    ).toBeInTheDocument();

    connection.set(notStartedResult());
    expect(screen.getByText(byWholeText('Buckets in your local emulator, not in an AWS account.'))).toBeInTheDocument();
    expect(
      screen.queryByText(byWholeText(`Buckets in your local emulator at ${EMULATOR_ENDPOINT}, not in an AWS account.`)),
    ).toBeNull();
  });

  it('the notice "These buckets are in your local emulator" and the (i) control are shown', async () => {
    await openLoaded();

    expect(screen.getByText('These buckets are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About the local emulator' })).toBeInTheDocument();
  });
});

describe('loading, empty and no match', () => {
  it('a request in flight, nothing loaded: "Loading buckets", no counter, the filter, pagination and preferences disabled', async () => {
    let release: (answer: Answer) => void = () => undefined;
    engine.answer = () =>
      new Promise<Answer>((resolve) => {
        release = resolve;
      });
    open();

    await waitFor(() => {
      expect(engine.lists).toHaveLength(1);
    });
    expect(within(tableElement()).getByText('Loading buckets')).toBeInTheDocument();
    expect(titleText()).toBe('General purpose buckets');
    expect(filterInput()).toBeDisabled();
    expect(isDisabled(screen.getByRole('button', { name: 'Next page' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Previous page' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Preferences' }))).toBe(true);

    act(() => {
      release(listAnswer([bucket('alpha')]));
    });
    await expectNames(['alpha']);
    expect(titleText()).toBe('General purpose buckets (1)');
    expect(filterInput()).toBeEnabled();
    expect(isDisabled(screen.getByRole('button', { name: 'Preferences' }))).toBe(false);
  });

  it('an empty answer, no filter: "No buckets", the sentence, "Create bucket" to /aws/s3/bucket/create; the counter "(0)"', async () => {
    const { router } = open();

    await waitFor(() => {
      expect(emptySlot()).toHaveTextContent('No buckets');
    });
    expect(emptySlot()).toHaveTextContent(
      'This emulator holds no general purpose buckets. It starts empty each time it restarts. Create one here, or with any tool pointed at the emulator.',
    );
    expect(titleText()).toBe('General purpose buckets (0)');
    fireEvent.click(within(slot()).getByRole('button', { name: 'Create bucket' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/s3/bucket/create');
    });
  });

  it('an empty answer with the filter "zz": "No matches", the sentence, "Clear filter" empties the filter and lists again', async () => {
    await openLoaded();

    typeFilter('zz');
    await waitFor(() => {
      expect(emptySlot()).toHaveTextContent('No matches');
    });
    expect(emptySlot()).toHaveTextContent('No bucket name starts with “zz”.');
    expect(engine.lists.at(-1)?.searchParams.get('prefix')).toBe('zz');

    fireEvent.click(within(slot()).getByRole('button', { name: 'Clear filter' }));
    expect(filterInput()).toHaveValue('');
    await expectNames(['alpha', 'beta', 'gamma']);
    expect(engine.lists.at(-1)?.searchParams.has('prefix')).toBe(false);
  });

  it('a filter with two results: "2 matches"; with one: "1 match"', async () => {
    await openLoaded([bucket('alpha'), bucket('alto'), bucket('beta')]);

    typeFilter('al');
    await expectNames(['alpha', 'alto']);
    expect(PAGE.findTextFilter()?.findResultsCount()?.getElement()).toHaveTextContent('2 matches');
    typeFilter('alp');
    await expectNames(['alpha']);
    expect(PAGE.findTextFilter()?.findResultsCount()?.getElement()).toHaveTextContent('1 match');
  });
});

describe('failure states', () => {
  async function openFailing(answer: EngineAnswer | (() => EngineAnswer)) {
    engine.answer = typeof answer === 'function' ? answer : () => answer;
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
    return { type: type ?? null, text: (indicator?.textContent ?? '').replace(/\s+/g, ' ').trim() };
  }

  it('HTTP 501: "Not implemented by the emulator", naming ListBuckets, as info and not an error, "Retry"; the actions stay', async () => {
    await openFailing(
      errorAnswer(501, 'NotImplemented', 'operation ListBuckets is scaffolded but not implemented in this emulator'),
    );

    expect(status()).toEqual({ type: 'info', text: 'Not implemented by the emulator' });
    expect(emptySlot()).toHaveTextContent(
      'The emulator answered 501 Not Implemented for ListBuckets, so Studio cannot list buckets.',
    );
    expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    for (const name of ['Refresh Buckets', 'Copy ARN', 'Empty', 'Delete', 'Create bucket']) {
      expect(action(name)).toBeInTheDocument();
    }
  });

  it('AccessDenied: "Access denied" with "ListBuckets was refused: " and the message returned', async () => {
    await openFailing(errorAnswer(403, 'AccessDenied', 'User is not allowed to list buckets'));

    expect(status()).toEqual({ type: 'error', text: 'Access denied' });
    expect(emptySlot()).toHaveTextContent('ListBuckets was refused: User is not allowed to list buckets');
  });

  it('the read fails and the connection is not started: "Not started on port <port>" as stopped, the sentence, "Connection status" to /, "Retry"', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(errorAnswer(503, 'EmulatorUnavailable', 'the emulator at 127.0.0.1:9304 refused the connection'));

    expect(status()).toEqual({ type: 'stopped', text: `Not started on port ${String(EMULATOR_PORT)}` });
    expect(emptySlot()).toHaveTextContent('The bucket list could not be read.');
    expect(within(slot()).getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
    expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it.each([
    ['not answering', notAnsweringResult, `Not answering at ${EMULATOR_ENDPOINT}`],
    [
      'engine not answering',
      (): CheckResult => ({ kind: 'engine-unreachable', checkedAt: Date.now(), lastEmulatorPort: EMULATOR_PORT }),
      'The EmuForge engine at <origin> is not answering',
    ],
    [
      'engine error',
      (): CheckResult => ({
        kind: 'engine-error',
        checkedAt: Date.now(),
        status: 500,
        code: 'Internal',
        message: 'broken',
      }),
      'The EmuForge engine answered with an error: Internal',
    ],
  ])(
    'the read fails and the connection is %s: the line’s words as an error, and the same three parts',
    async (_, result, words) => {
      connection.value = { result: result(), engineOrigin };
      await openFailing('network-error');

      expect(status()).toEqual({ type: 'error', text: words.replace('<origin>', engineOrigin) });
      expect(emptySlot()).toHaveTextContent('The bucket list could not be read.');
      expect(within(slot()).getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
      expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    },
  );

  it('501 while the connection is not connected: the "not implemented" state, not the "not connected" one', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(errorAnswer(501, 'NotImplemented', 'not here'));

    expect(status()).toEqual({ type: 'info', text: 'Not implemented by the emulator' });
    expect(emptySlot()).not.toHaveTextContent('Not started');
  });

  it.each(['EmulatorUnavailable', 'EmulatorTimeout'])(
    '%s while connected: "The emulator did not answer" with the engine’s message',
    async (code) => {
      await openFailing(errorAnswer(code === 'EmulatorTimeout' ? 504 : 503, code, `engine says ${code}`));

      expect(status()).toEqual({ type: 'error', text: 'The emulator did not answer' });
      expect(emptySlot()).toHaveTextContent(`engine says ${code}`);
    },
  );

  it('no answer from the engine while connected: "The EmuForge engine at <engine origin> did not answer"', async () => {
    await openFailing('network-error');

    expect(status()).toEqual({ type: 'error', text: `The EmuForge engine at ${engineOrigin} did not answer` });
  });

  it('any other error while connected: "The bucket list could not be read" with "<code>: <message>"', async () => {
    await openFailing(errorAnswer(400, 'InvalidArgument', 'The continuation token provided is incorrect'));

    expect(status()).toEqual({ type: 'error', text: 'The bucket list could not be read' });
    expect(emptySlot()).toHaveTextContent('InvalidArgument: The continuation token provided is incorrect');
  });

  it.each([
    ['not implemented', connectedResult, errorAnswer(501, 'NotImplemented', 'no'), 'Not implemented by the emulator'],
    ['access denied', connectedResult, errorAnswer(403, 'AccessDenied', 'no'), 'Access denied'],
    [
      'not connected',
      notStartedResult,
      errorAnswer(503, 'EmulatorUnavailable', 'no'),
      `Not started on port ${String(EMULATOR_PORT)}`,
    ],
    [
      'emulator did not answer',
      connectedResult,
      errorAnswer(504, 'EmulatorTimeout', 'no'),
      'The emulator did not answer',
    ],
    [
      'engine did not answer',
      connectedResult,
      'network-error' as const,
      'The EmuForge engine at <origin> did not answer',
    ],
    [
      'any other failure',
      connectedResult,
      errorAnswer(400, 'InvalidArgument', 'no'),
      'The bucket list could not be read',
    ],
  ])(
    '%s: its first line announced once; "Retry" asks for page 1 and a good answer shows the rows',
    async (_, result, answer, line) => {
      const first = line.replace('<origin>', engineOrigin);
      connection.value = { result: result(), engineOrigin };
      const said = recordAnnouncements();
      await openFailing(answer);
      await waitFor(() => {
        expect(said).toContain(first);
      });
      // The connection answers again in the same state: nothing new is said.
      connection.set(result());
      expect(said.filter((text) => text === first)).toHaveLength(1);

      engine.buckets = [bucket('alpha')];
      engine.answer = (url) => engine.listing(url);
      const before = engine.lists.length;
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectNames(['alpha']);
      expect(engine.lists).toHaveLength(before + 1);
      expect(engine.lists.at(-1)?.searchParams.has('continuation-token')).toBe(false);
    },
  );

  it('a failed read, then the connection becomes connected: a new request without any action, and its rows', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openFailing(errorAnswer(503, 'EmulatorUnavailable', 'refused'));
    const before = engine.lists.length;

    engine.buckets = [bucket('alpha')];
    engine.answer = (url) => engine.listing(url);
    connection.set(connectedResult());

    await expectNames(['alpha']);
    expect(engine.lists).toHaveLength(before + 1);
  });

  it('a failed read shown as an error, then the connection becomes not started: the "not connected" state, no new request', async () => {
    await openFailing(errorAnswer(503, 'EmulatorUnavailable', 'refused'));
    expect(status().text).toBe('The emulator did not answer');
    const before = engine.lists.length;

    connection.set(notStartedResult());

    expect(status()).toEqual({ type: 'stopped', text: `Not started on port ${String(EMULATOR_PORT)}` });
    expect(emptySlot()).toHaveTextContent('The bucket list could not be read.');
    expect(engine.lists).toHaveLength(before);
  });

  it('the next page fails: the failure state; "Retry" shows page 1', async () => {
    engine.buckets = Array.from({ length: 30 }, (_, index) => bucket(`b-${String(index + 10)}`));
    open();
    await waitFor(() => {
      expect(names()).toHaveLength(25);
    });

    engine.answer = (url) =>
      url.searchParams.has('continuation-token')
        ? errorAnswer(400, 'InvalidArgument', 'The continuation token provided is incorrect')
        : engine.listing(url);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(emptySlot()).toHaveTextContent('InvalidArgument: The continuation token provided is incorrect');
    });

    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(names()).toHaveLength(25);
    });
    expect(names()[0]).toBe('b-10');
    expect(PAGE.findPagination()?.findCurrentPage().getElement()).toHaveTextContent('1');
  });
});

describe('preferences and wrapping', () => {
  /** A button of the dialog's footer by its text (the dialog's own close control is named "Cancel" as well). */
  function footerButton(dialog: HTMLElement, text: string): HTMLElement {
    const found = within(dialog)
      .getAllByRole('button', { name: text })
      .find((button) => button.textContent === text);
    expect(found).toBeDefined();
    return found as HTMLElement;
  }

  /** Opens "Preferences"; its modal renders into the area's root once that commit is done. */
  async function preferencesDialog(): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    return screen.findByRole('dialog', { name: 'Preferences' });
  }

  /** The table's body cells wrap their text ("Wrap lines"). */
  function wraps(): boolean {
    // The cells of the three columns; the selection cell holds only its radio.
    const cells = [...tableElement().querySelectorAll('tbody td, tbody th')].filter(
      (cell) => cell.querySelector('input') === null,
    );
    // Cloudscape marks the content of a wrapping cell, the element inside it.
    return cells.length > 0 && cells.every((cell) => cell.querySelector('[class*="body-cell-wrap"]') !== null);
  }

  it('"Preferences": the dialog and its texts; "10 buckets" confirmed lists again with 10; cancel changes nothing; "Wrap lines" off stops the wrapping', async () => {
    await openLoaded();

    let dialog = await preferencesDialog();
    expect(within(dialog).getByText('Page size')).toBeInTheDocument();
    for (const size of ['10 buckets', '25 buckets', '50 buckets']) {
      expect(within(dialog).getByRole('radio', { name: size })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('radio', { name: '25 buckets' })).toBeChecked();
    expect(within(dialog).getByText('Wrap lines')).toBeInTheDocument();
    expect(within(dialog).getByText('Show all of a long name, Region or date')).toBeInTheDocument();
    expect(footerButton(dialog, 'Cancel')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: '10 buckets' }));
    fireEvent.click(footerButton(dialog, 'Confirm'));
    await waitFor(() => {
      expect(engine.lists.at(-1)?.searchParams.get('max-buckets')).toBe('10');
    });
    await expectNames(['alpha', 'beta', 'gamma']);
    const sent = engine.lists.length;

    dialog = await preferencesDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: '50 buckets' }));
    fireEvent.click(footerButton(dialog, 'Cancel'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Preferences' })).toBeNull();
    });
    expect(engine.lists).toHaveLength(sent);

    expect(wraps()).toBe(true);
    dialog = await preferencesDialog();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Wrap lines/ }));
    fireEvent.click(footerButton(dialog, 'Confirm'));
    await waitFor(() => {
      expect(wraps()).toBe(false);
    });
    expect(engine.lists).toHaveLength(sent);
  });

  it('a 63-character name, "Wrap lines" on as at the start: the cells wrap and the link holds all 63 characters', async () => {
    const name = `b${'x'.repeat(62)}`;
    await openLoaded([bucket(name)]);

    expect(wraps()).toBe(true);
    const link = within(tableElement()).getByRole('link', { name });
    expect(link.textContent).toBe(name);
    expect(link.textContent).toHaveLength(63);
    expect(tableElement().textContent).not.toContain('…');
  });

  it('unmounted after "10 buckets" and "Wrap lines" off, mounted again: 25 buckets asked for, "25 buckets" and "Wrap lines" on', async () => {
    const first = await openLoaded();
    let dialog = await preferencesDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: '10 buckets' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Wrap lines/ }));
    fireEvent.click(footerButton(dialog, 'Confirm'));
    await waitFor(() => {
      expect(engine.lists.at(-1)?.searchParams.get('max-buckets')).toBe('10');
    });
    first.unmount();

    open();
    await waitFor(() => {
      expect(engine.lists.at(-1)?.searchParams.get('max-buckets')).toBe('25');
    });
    await expectNames(['alpha', 'beta', 'gamma']);
    expect(wraps()).toBe(true);
    dialog = await preferencesDialog();
    expect(within(dialog).getByRole('radio', { name: '25 buckets' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Wrap lines/ })).toBeChecked();
  });
});

describe('help and the session', () => {
  it('"Info": the help panel with the heading "Buckets" and the four parts of R8.5; closed, focus on "Info"', async () => {
    await openLoaded();
    const info = screen.getByRole('button', { name: 'Info' });

    act(() => {
      info.focus();
      fireEvent.click(info);
    });

    const tools = PAGE.findAppLayout()?.findTools()?.getElement() as HTMLElement;
    await waitFor(() => {
      expect(within(tools).getByRole('heading', { name: 'Buckets' })).toBeVisible();
    });
    const text = (tools.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain(
      'This list is read from your local emulator each time you open or refresh it. It shows every general purpose bucket the emulator holds, whoever made it.',
    );
    expect(within(tools).getByRole('heading', { name: 'This is not AWS' })).toBeInTheDocument();
    expect(text).toContain(
      'Nothing here is in an AWS account, and Studio sends nothing to AWS. EmuForge Studio is a stand-alone local tool, not an AWS feature.',
    );
    expect(within(tools).getByRole('heading', { name: 'Finding a bucket' })).toBeInTheDocument();
    expect(text).toContain('The filter matches names that start with what you type.');
    expect(within(tools).getByRole('heading', { name: 'Actions' })).toBeInTheDocument();
    expect(text).toContain("Copy ARN copies the selected bucket's ARN.");
    expect(text).toContain('Empty, Delete and Create bucket open their own screens.');
    expect(text).not.toContain('Buckets are containers for data stored in S3.');

    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Close help panel' })[0] as HTMLElement);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Info' }));
    });
  });

  it('the engine refuses the session once: the rows after one new session, no failure state', async () => {
    engine.buckets = [bucket('alpha')];
    let refused = false;
    engine.answer = (url, token) => {
      if (!refused && token === 'token-1') {
        refused = true;
        return errorAnswer(401, 'SessionInvalid', 'The session is not known to this engine.');
      }
      return engine.listing(url);
    };
    open();

    await expectNames(['alpha']);
    expect(engine.sessions).toHaveLength(2);
    expect(refused).toBe(true);
    expect(emptySlot()?.querySelector('button') ?? null).toBeNull();
  });
});
