import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// A bucket's page rendered inside the area's layout, as Studio's frame renders the area, against a fake engine behind
// the page's `fetch` (test-criteria.md, issue 256, "Unit — services/s3/pages/bucket-page.test.tsx").

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

function listAnswer(buckets: FakeBucket[]): Answer {
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>${buckets
      .map(bucketXml)
      .join('')}</Buckets></ListAllMyBucketsResult>`,
  };
}

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${xml(code)}</Code><Message>${xml(message)}</Message></Error>`,
  };
}

/** Whether `url` is a `ListBuckets` request. */
function isList(url: URL): boolean {
  return url.pathname === '/' && url.searchParams.get('x-id') === 'ListBuckets';
}

class FakeEngine {
  /** The buckets the emulator holds, in its order (names ascending). */
  buckets: FakeBucket[] = [];
  /** Every AWS request, its URL as sent. */
  readonly aws: URL[] = [];
  /** The answer to `ListBuckets`; by default the emulator's listing of `buckets`. */
  list: (url: URL) => EngineAnswer = (url) => this.listing(url);

  /** `ListBuckets` over `buckets`: `max-buckets` and `prefix`. */
  listing(url: URL): Answer {
    const size = Number(url.searchParams.get('max-buckets') ?? '1000');
    const prefix = url.searchParams.get('prefix') ?? '';
    return listAnswer(this.buckets.filter((bucket) => bucket.name.startsWith(prefix)).slice(0, size));
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'token-1' }), { status: 200 });
    }
    this.aws.push(url);
    const answer = await Promise.race([
      Promise.resolve(isList(url) ? this.list(url) : errorAnswer(404, 'NoSuchKey', 'not in this fake')),
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
    return this.aws.filter(isList);
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

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9100;
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

function open(path = '/aws/s3/buckets/alpha') {
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

function h1(): HTMLElement {
  return screen.getByRole('heading', { level: 1 });
}

function tabNames(): string[] {
  return screen.queryAllByRole('tab').map((tab) => tab.textContent);
}

async function expectTabs() {
  await waitFor(() => {
    expect(tabNames()).toEqual(TABS);
  });
}

/** Matches the element whose whole text is `text`, and none of its children alone. */
function byWholeText(text: string) {
  return (_: string, element: Element | null): boolean =>
    element !== null &&
    element.textContent === text &&
    [...element.children].every((child) => child.textContent !== text);
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

/** The page's own element whose whole text is `text`: outside the emulator line and the live regions. */
function onPage(text: string): HTMLElement {
  const found = screen
    .getAllByText(byWholeText(text))
    .filter(
      (element) => element.closest('.aws-area-emulator-line') === null && element.closest('[aria-live]') === null,
    );
  expect(found).toHaveLength(1);
  return found[0] as HTMLElement;
}

/** Waits for the page's own element whose whole text is `text`. */
async function findOnPage(text: string): Promise<HTMLElement> {
  return waitFor(() => onPage(text));
}

/** The type of the Cloudscape status indicator around `text` on the page (`…-status-error`, `…-status-info`, …). */
function statusType(text: string): string | undefined {
  for (let at: Element | null = onPage(text); at !== null; at = at.parentElement) {
    const match = [...at.classList]
      .map((name) => /status-(error|info|stopped|loading|success)/.exec(name))
      .find(Boolean);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

const TABS = ['Objects', 'Metadata', 'Properties', 'Permissions', 'Metrics', 'Management'];

const ALPHA: FakeBucket = {
  name: 'alpha',
  region: 'ap-northeast-2',
  date: '2026-10-30T14:18:34.000Z',
  arn: 'arn:aws:s3:::alpha',
};

async function openLoaded(path?: string) {
  engine.buckets = [ALPHA];
  const opened = open(path);
  await expectTabs();
  return opened;
}

/** An answer held until the case lets it go. */
function held(): { answer: Promise<Answer>; release: (answer: Answer) => void } {
  let release: (answer: Answer) => void = () => undefined;
  const answer = new Promise<Answer>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

// ---------------------------------------------------------------------------------------------------------------

describe('a bucket’s page, loaded', () => {
  it('the h1 is the name, with the description; six tabs in the spec’s order, "Properties" selected', async () => {
    await openLoaded();

    expect(h1()).toHaveTextContent(/^alpha$/);
    expect(screen.getByText('This bucket is in your local emulator, not in an AWS account.')).toBeInTheDocument();
    expect(tabNames()).toEqual(TABS);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-selected', tab.textContent === 'Properties' ? 'true' : 'false');
    }
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it.each(['/aws/s3/buckets/alpha', '/aws/s3/buckets/alpha/properties'])(
    'at %s, "Properties" is selected and the address stays as opened',
    async (path) => {
      const { router } = await openLoaded(path);

      expect(screen.getByRole('tab', { name: 'Properties' })).toHaveAttribute('aria-selected', 'true');
      expect(router.state.location.pathname).toBe(path);
    },
  );

  it('the name sits in the area’s breaking element, so a long word breaks inside the h1', async () => {
    const long = 'a'.repeat(63);
    engine.buckets = [{ name: long }];
    open(`/aws/s3/buckets/${long}`);
    await expectTabs();

    const breaking = within(h1()).getByText(long);
    expect(breaking).toHaveClass('aws-s3-break-anywhere');
  });

  it('the notice reads "These buckets are in your local emulator", with the (i) control', async () => {
    await openLoaded();

    expect(screen.getByText('These buckets are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About the local emulator' })).toBeInTheDocument();
  });
});

describe('a bucket’s page, its tabs', () => {
  it.each([
    ['Objects', '/aws/s3/buckets/alpha/objects'],
    ['Metadata', '/aws/s3/buckets/alpha/metadata'],
    ['Permissions', '/aws/s3/buckets/alpha/permissions'],
    ['Metrics', '/aws/s3/buckets/alpha/metrics'],
    ['Management', '/aws/s3/buckets/alpha/management'],
  ])('"%s" leads to %s', async (tab, path) => {
    const { router } = await openLoaded();

    expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('href', path);
    fireEvent.click(screen.getByRole('tab', { name: tab }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(path);
    });
  });

  it('"Properties" leads from the bucket’s route to /aws/s3/buckets/alpha/properties', async () => {
    const { router } = await openLoaded();

    expect(screen.getByRole('tab', { name: 'Properties' })).toHaveAttribute('href', '/aws/s3/buckets/alpha/properties');
    fireEvent.click(screen.getByRole('tab', { name: 'Properties' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/s3/buckets/alpha/properties');
    });
    expect(await screen.findByRole('tab', { name: 'Properties' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a click with a modifier key on "Properties" is left to the browser', async () => {
    const { router } = await openLoaded();

    fireEvent.click(screen.getByRole('tab', { name: 'Properties' }), { ctrlKey: true });

    expect(router.state.location.pathname).toBe('/aws/s3/buckets/alpha');
  });
});

describe('a bucket’s page, its read', () => {
  it('asks ListBuckets with the name as prefix and one bucket at most', async () => {
    await openLoaded();

    const [list] = engine.lists;
    expect(list?.searchParams.get('prefix')).toBe('alpha');
    expect(list?.searchParams.get('max-buckets')).toBe('1');
  });

  it('while the read is in flight → "Loading bucket", no tabs; then the tabs', async () => {
    const answer = held();
    engine.buckets = [ALPHA];
    engine.list = () => answer.answer;
    open();

    expect(await screen.findByText('Loading bucket')).toBeInTheDocument();
    expect(tabNames()).toEqual([]);
    answer.release(listAnswer([ALPHA]));

    await expectTabs();
    expect(screen.queryByText('Loading bucket')).toBeNull();
  });

  it('no bucket of that name → "Bucket not found", its sentence with the name, the link; no tabs; the h1 still the name', async () => {
    engine.buckets = [];
    open();

    expect(await screen.findByText('Bucket not found')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The emulator holds no bucket named “alpha”. It may have been deleted, or the emulator restarted.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'General purpose buckets', current: false })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'General purpose buckets' });
    expect(links.some((link) => link.closest('nav') === null && link.getAttribute('href') === '/aws/s3/buckets')).toBe(
      true,
    );
    expect(tabNames()).toEqual([]);
    expect(h1()).toHaveTextContent(/^alpha$/);
    expect(screen.queryByText('This bucket is in your local emulator, not in an AWS account.')).toBeNull();
  });

  it('a bucket whose name starts with the name asked, first under that prefix → "Bucket not found"', async () => {
    engine.buckets = [{ name: 'alpha-x' }];
    open();

    expect(await screen.findByText('Bucket not found')).toBeInTheDocument();
  });

  it('"General purpose buckets" of "Bucket not found" leads to the list', async () => {
    engine.buckets = [];
    const { router } = open();
    await screen.findByText('Bucket not found');

    const link = screen
      .getAllByRole('link', { name: 'General purpose buckets' })
      .find((candidate) => candidate.closest('nav') === null);
    expect(link).toBeDefined();
    fireEvent.click(link as HTMLElement);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/s3/buckets');
    });
  });
});

describe('a bucket’s page, a failed read', () => {
  it('501 → "Not implemented by the emulator", naming ListBuckets, as information, with "Retry"', async () => {
    engine.list = () => errorAnswer(501, 'NotImplemented', 'operation ListBuckets is scaffolded but not implemented');
    open();

    expect(await findOnPage('Not implemented by the emulator')).toBeInTheDocument();
    expect(
      screen.getByText('The emulator answered 501 Not Implemented for ListBuckets, so Studio cannot show the bucket.'),
    ).toBeInTheDocument();
    expect(statusType('Not implemented by the emulator')).toBe('info');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(tabNames()).toEqual([]);
  });

  it('AccessDenied → "Access denied" and the message returned, with "Retry"', async () => {
    engine.list = () => errorAnswer(403, 'AccessDenied', 'not for you');
    open();

    expect(await findOnPage('Access denied')).toBeInTheDocument();
    expect(screen.getByText('ListBuckets was refused: not for you')).toBeInTheDocument();
    expect(statusType('Access denied')).toBe('error');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('while the connection is not started → the line’s words, "The bucket could not be read.", "Connection status", "Retry"', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    engine.list = () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator is not running');
    open();

    expect(await findOnPage('The bucket could not be read.')).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(statusType(`Not started on port ${String(EMULATOR_PORT)}`)).toBe('stopped');
    const recovery = within(main)
      .getAllByRole('link', { name: 'Connection status' })
      .find((link) => link.closest('.aws-area-emulator-line') === null);
    expect(recovery).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('the engine’s EmulatorUnavailable while connected → "The emulator did not answer" and the engine’s message', async () => {
    engine.list = () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator at 127.0.0.1:9304 did not answer');
    open();

    expect(await findOnPage('The emulator did not answer')).toBeInTheDocument();
    expect(screen.getByText('the emulator at 127.0.0.1:9304 did not answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('at the network level → the engine sentence with its origin', async () => {
    engine.list = () => 'network-error';
    open();

    expect(await findOnPage(`The EmuForge engine at ${engineOrigin} did not answer`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('another code → "The bucket could not be read" and "`code`: message"', async () => {
    engine.list = () => errorAnswer(500, 'InternalError', 'something broke');
    open();

    expect(await findOnPage('The bucket could not be read')).toBeInTheDocument();
    expect(screen.getByText(byWholeText('InternalError: something broke'))).toBeInTheDocument();
  });

  it('"Retry" reads the page again; the failure is announced once', async () => {
    const said = recordAnnouncements();
    engine.buckets = [ALPHA];
    engine.list = () => errorAnswer(500, 'InternalError', 'something broke');
    open();
    await findOnPage('The bucket could not be read');
    const reads = engine.lists.length;

    engine.list = (url) => engine.listing(url);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await expectTabs();
    expect(engine.lists.length).toBe(reads + 1);
    expect(said.filter((text) => text === 'The bucket could not be read')).toHaveLength(1);
  });
});

describe('a bucket’s page, read again', () => {
  it('"Refresh" sends the page’s read again, then "Bucket refreshed" is announced', async () => {
    await openLoaded();
    const said = recordAnnouncements();
    const reads = engine.lists.length;

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(said).toContain('Bucket refreshed');
    });
    expect(engine.lists.length).toBe(reads + 1);
    await expectTabs();
  });

  it('"Refresh" of a bucket deleted meanwhile → "Bucket not found"', async () => {
    await openLoaded();

    engine.buckets = [];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('Bucket not found')).toBeInTheDocument();
    expect(tabNames()).toEqual([]);
  });

  it('the connection becomes connected after a failed read → the page reads again without any action', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    engine.buckets = [ALPHA];
    engine.list = () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator is not running');
    open();
    await findOnPage('The bucket could not be read.');
    const reads = engine.lists.length;

    engine.list = (url) => engine.listing(url);
    connection.set(connectedResult());

    await expectTabs();
    expect(engine.lists.length).toBe(reads + 1);
  });

  it('after the connection was down while the page was shown, it reads again once connected: a restarted emulator’s "Bucket not found"', async () => {
    await openLoaded();

    connection.set(notStartedResult());
    engine.buckets = [];
    connection.set(connectedResult());

    expect(await screen.findByText('Bucket not found')).toBeInTheDocument();
  });
});
