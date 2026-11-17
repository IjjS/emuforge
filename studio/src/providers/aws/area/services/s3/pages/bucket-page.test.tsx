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

const ok = (body: string): Answer => ({ status: 200, body: `<?xml version="1.0" encoding="UTF-8"?>${body}` });

/** The part of a bucket's configuration each section reads, by the subresource of its request. */
const PARTS = [
  'versioning',
  'abac',
  'tagging',
  'encryption',
  'intelligent-tiering',
  'logging',
  'notification',
  'accelerate',
  'object-lock',
  'requestPayment',
  'website',
] as const;
type Part = (typeof PARTS)[number];

/** The subresource of a request to a bucket (`/alpha?versioning`), if it is one of `PARTS`. */
function partOf(url: URL): Part | undefined {
  const keys = (url.search.slice(1) === '' ? [] : url.search.slice(1).split('&')).map((pair) =>
    decodeURIComponent(pair.split('=')[0] ?? ''),
  );
  return PARTS.find((part) => keys.includes(part));
}

/** What a bucket made with nothing set answers (requirement R2). */
const PLAIN: Record<Part, () => EngineAnswer> = {
  versioning: () => ok('<VersioningConfiguration/>'),
  abac: () => ok('<AbacStatus><Status>Disabled</Status></AbacStatus>'),
  tagging: () => errorAnswer(404, 'NoSuchTagSet', 'The TagSet does not exist'),
  encryption: () =>
    ok(
      '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm>' +
        '</ApplyServerSideEncryptionByDefault><BucketKeyEnabled>false</BucketKeyEnabled></Rule></ServerSideEncryptionConfiguration>',
    ),
  'intelligent-tiering': () =>
    ok(
      '<ListBucketIntelligentTieringConfigurationsOutput><IsTruncated>false</IsTruncated></ListBucketIntelligentTieringConfigurationsOutput>',
    ),
  logging: () => ok('<BucketLoggingStatus/>'),
  notification: () => ok('<NotificationConfiguration/>'),
  accelerate: () => ok('<AccelerateConfiguration/>'),
  'object-lock': () =>
    errorAnswer(
      404,
      'ObjectLockConfigurationNotFoundError',
      'Object Lock configuration does not exist for this bucket',
    ),
  requestPayment: () => ok('<RequestPaymentConfiguration><Payer>BucketOwner</Payer></RequestPaymentConfiguration>'),
  website: () =>
    errorAnswer(404, 'NoSuchWebsiteConfiguration', 'The specified bucket does not have a website configuration'),
};

const KMS_KEY = 'arn:aws:kms:us-east-1:000000000000:key/0f6b2c5e-1a2b-4c3d-9e8f-0123456789ab';
const QUEUE = 'arn:aws:sqs:us-east-1:000000000000:alpha-events';

/** What a bucket with every property set answers. */
const FULL: Record<Part, () => EngineAnswer> = {
  versioning: () => ok('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'),
  abac: () => ok('<AbacStatus><Status>Enabled</Status></AbacStatus>'),
  tagging: () =>
    ok(
      '<Tagging><TagSet><Tag><Key>team</Key><Value>storage</Value></Tag><Tag><Key>env</Key><Value>dev</Value></Tag></TagSet></Tagging>',
    ),
  encryption: () =>
    ok(
      '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>aws:kms</SSEAlgorithm>' +
        `<KMSMasterKeyID>${KMS_KEY}</KMSMasterKeyID></ApplyServerSideEncryptionByDefault>` +
        '<BucketKeyEnabled>true</BucketKeyEnabled></Rule></ServerSideEncryptionConfiguration>',
    ),
  'intelligent-tiering': () =>
    ok(
      '<ListBucketIntelligentTieringConfigurationsOutput><IsTruncated>false</IsTruncated>' +
        '<IntelligentTieringConfiguration><Id>archive-logs</Id><Filter><Prefix>logs/</Prefix></Filter><Status>Enabled</Status>' +
        '<Tiering><Days>90</Days><AccessTier>ARCHIVE_ACCESS</AccessTier></Tiering>' +
        '<Tiering><Days>180</Days><AccessTier>DEEP_ARCHIVE_ACCESS</AccessTier></Tiering></IntelligentTieringConfiguration>' +
        '</ListBucketIntelligentTieringConfigurationsOutput>',
    ),
  logging: () =>
    ok(
      '<BucketLoggingStatus><LoggingEnabled><TargetBucket>alpha-logs</TargetBucket><TargetPrefix>access/</TargetPrefix>' +
        '</LoggingEnabled></BucketLoggingStatus>',
    ),
  notification: () =>
    ok(
      '<NotificationConfiguration><QueueConfiguration><Id>to-queue</Id>' +
        `<Queue>${QUEUE}</Queue><Event>s3:ObjectCreated:Put</Event><Event>s3:ObjectRemoved:*</Event>` +
        '<Filter><S3Key><FilterRule><Name>prefix</Name><Value>in/</Value></FilterRule>' +
        '<FilterRule><Name>suffix</Name><Value>.csv</Value></FilterRule></S3Key></Filter></QueueConfiguration>' +
        '<EventBridgeConfiguration></EventBridgeConfiguration></NotificationConfiguration>',
    ),
  accelerate: () => ok('<AccelerateConfiguration><Status>Enabled</Status></AccelerateConfiguration>'),
  'object-lock': () =>
    ok(
      '<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention>' +
        '<Mode>GOVERNANCE</Mode><Days>1</Days></DefaultRetention></Rule></ObjectLockConfiguration>',
    ),
  requestPayment: () => ok('<RequestPaymentConfiguration><Payer>Requester</Payer></RequestPaymentConfiguration>'),
  website: () =>
    ok(
      '<WebsiteConfiguration><IndexDocument><Suffix>index.html</Suffix></IndexDocument>' +
        '<ErrorDocument><Key>error.html</Key></ErrorDocument></WebsiteConfiguration>',
    ),
};

class FakeEngine {
  /** The buckets the emulator holds, in its order (names ascending). */
  buckets: FakeBucket[] = [];
  /** Every AWS request, its URL as sent. */
  readonly aws: URL[] = [];
  /** The answer to `ListBuckets`; by default the emulator's listing of `buckets`. */
  list: (url: URL) => EngineAnswer = (url) => this.listing(url);
  /** The answer to each section's read; by default a bucket with nothing set. */
  parts: Record<Part, () => EngineAnswer> = { ...PLAIN };

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
      Promise.resolve(this.answer(url)),
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

  private answer(url: URL): EngineAnswer {
    if (isList(url)) {
      return this.list(url);
    }
    const part = partOf(url);
    return part === undefined
      ? errorAnswer(400, 'InvalidRequest', `not in this fake: ${url.href}`)
      : this.parts[part]();
  }

  /** The `ListBuckets` requests sent so far. */
  get lists(): URL[] {
    return this.aws.filter(isList);
  }

  /** The requests of the section reading `part` sent so far. */
  reads(part: Part): URL[] {
    return this.aws.filter((url) => partOf(url) === part);
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

// ---------------------------------------------------------------------------------------------------------------
// The sections (R5.3, R5.4, R9.2, R10, R11.3).
// ---------------------------------------------------------------------------------------------------------------

const SECTIONS = [
  'Bucket overview',
  'Bucket Versioning',
  'Bucket ABAC',
  'Tags',
  'Default encryption',
  'S3 Intelligent-Tiering Archive configurations',
  'Server access logging',
  'Event notifications',
  'Amazon EventBridge',
  'Transfer acceleration',
  'Object Lock',
  'Requester pays',
  'Static website hosting',
];

const EVENTBRIDGE_FIELD = 'Send notifications to Amazon EventBridge for all events in this bucket';

const norm = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

/** The level-2 headings of the page's content, outside the side navigation, in order. */
function sectionHeadings(): string[] {
  return within(screen.getByRole('main'))
    .queryAllByRole('heading', { level: 2 })
    .filter((heading) => heading.closest('nav') === null)
    .map((heading) => norm(heading.textContent));
}

/** The section `title`: the largest element around its heading that holds no other level-2 heading. */
function section(title: string): HTMLElement {
  const heading = within(screen.getByRole('main'))
    .getAllByRole('heading', { level: 2 })
    .find((candidate) => norm(candidate.textContent) === title);
  expect(heading, `the section "${title}"`).toBeDefined();
  let box = heading as HTMLElement;
  while (box.parentElement !== null && box.parentElement.querySelectorAll('h2').length === 1) {
    box = box.parentElement;
  }
  return box;
}

/** The value under `label` in section `title`, or `null` when the section has no such field. */
function field(title: string, label: string): string | null {
  const dt = [...section(title).querySelectorAll('dt')].find((term) => norm(term.textContent) === label);
  let dd = dt?.nextElementSibling ?? null;
  while (dd !== null && dd.tagName !== 'DD') {
    dd = dd.nextElementSibling;
  }
  return dd === null ? null : norm(dd.textContent);
}

/** The data rows of section `title`'s table, each its cells' text. */
function tableRows(title: string): string[][] {
  return [...section(title).querySelectorAll('tbody tr')]
    .map((row) => [...row.querySelectorAll('td, th')].map((cell) => norm(cell.textContent)))
    .filter((cells) => cells.length > 1);
}

function sectionText(title: string): string {
  return norm(section(title).textContent);
}

async function expectSectionsShown() {
  await waitFor(() => {
    expect(sectionHeadings()).toEqual(SECTIONS);
    for (const title of SECTIONS) {
      expect(within(section(title)).queryByText('Loading')).toBeNull();
    }
  });
}

async function openBucket(parts: Partial<Record<Part, () => EngineAnswer>> = {}, bucket: FakeBucket = ALPHA) {
  engine.buckets = [bucket];
  engine.parts = { ...PLAIN, ...parts };
  const opened = open(`/aws/s3/buckets/${bucket.name}`);
  await expectSectionsShown();
  return opened;
}

describe('a bucket’s page, its sections', () => {
  it('a bucket with every property set → thirteen sections in the spec’s order, every one but "AWS CloudTrail data events"', async () => {
    await openBucket(FULL);

    expect(sectionHeadings()).toEqual(SECTIONS);
    expect(screen.queryByText('AWS CloudTrail data events')).toBeNull();
  });

  it('the same → each field shows its value', async () => {
    await openBucket(FULL);

    expect(field('Bucket overview', 'AWS Region')).toBe('Asia Pacific (Seoul) ap-northeast-2');
    expect(field('Bucket overview', 'Bucket ARN')).toBe('arn:aws:s3:::alpha');
    expect(field('Bucket overview', 'Creation date')).toMatch(
      /^(October|November) \d{1,2}, 2026, \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/,
    );
    expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Enabled');
    expect(field('Bucket ABAC', 'Bucket ABAC')).toBe('Enabled');
    expect(tableRows('Tags')).toEqual([
      ['team', 'storage'],
      ['env', 'dev'],
    ]);
    expect(field('Default encryption', 'Encryption type')).toBe(
      'Server-side encryption with AWS Key Management Service keys (SSE-KMS)',
    );
    expect(field('Default encryption', 'AWS KMS key')).toBe(KMS_KEY);
    expect(field('Default encryption', 'Bucket Key')).toBe('Enabled');
    expect(tableRows('S3 Intelligent-Tiering Archive configurations')).toEqual([
      ['archive-logs', 'Enabled', 'logs/', '90 days', '180 days'],
    ]);
    expect(field('Server access logging', 'Server access logging')).toBe('Enabled');
    expect(field('Server access logging', 'Destination bucket')).toBe('alpha-logs/access/');
    expect(tableRows('Event notifications')).toEqual([
      ['to-queue', 's3:ObjectCreated:Put, s3:ObjectRemoved:*', 'in/', '.csv', 'SQS queue', QUEUE],
    ]);
    expect(field('Amazon EventBridge', EVENTBRIDGE_FIELD)).toBe('On');
    expect(field('Transfer acceleration', 'Transfer acceleration')).toBe('Enabled');
    expect(field('Object Lock', 'Object Lock')).toBe('Enabled');
    expect(field('Object Lock', 'Default retention')).toBe('Enabled');
    expect(field('Object Lock', 'Retention mode')).toBe('Governance');
    expect(field('Object Lock', 'Default retention period')).toBe('1 day');
    expect(field('Requester pays', 'Requester pays')).toBe('Enabled');
    expect(field('Static website hosting', 'Static website hosting')).toBe('Enabled');
    expect(field('Static website hosting', 'Index document')).toBe('index.html');
    expect(field('Static website hosting', 'Error document')).toBe('error.html');
  });

  it('the column headings of the three tables, in the console’s words', async () => {
    await openBucket(FULL);

    const headings = (title: string) =>
      [...section(title).querySelectorAll('thead th')].map((cell) => norm(cell.textContent));
    expect(headings('Tags')).toEqual(['Key', 'Value']);
    expect(headings('S3 Intelligent-Tiering Archive configurations')).toEqual([
      'Name',
      'Status',
      'Prefix',
      'Archive Access tier',
      'Deep Archive Access tier',
    ]);
    expect(headings('Event notifications')).toEqual([
      'Event name',
      'Event types',
      'Prefix',
      'Suffix',
      'Destination type',
      'Destination',
    ]);
  });

  it('a plain bucket → "Disabled" or "Off", "-" where nothing is set, and the three tables’ empty texts', async () => {
    await openBucket();

    expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Disabled');
    expect(field('Bucket ABAC', 'Bucket ABAC')).toBe('Disabled');
    expect(field('Default encryption', 'Encryption type')).toBe(
      'Server-side encryption with Amazon S3 managed keys (SSE-S3)',
    );
    expect(field('Default encryption', 'AWS KMS key')).toBe('-');
    expect(field('Default encryption', 'Bucket Key')).toBe('Disabled');
    expect(field('Server access logging', 'Server access logging')).toBe('Disabled');
    expect(field('Server access logging', 'Destination bucket')).toBe('-');
    expect(field('Amazon EventBridge', EVENTBRIDGE_FIELD)).toBe('Off');
    expect(field('Transfer acceleration', 'Transfer acceleration')).toBe('Disabled');
    expect(field('Object Lock', 'Object Lock')).toBe('Disabled');
    expect(field('Object Lock', 'Default retention')).toBe('Disabled');
    expect(field('Object Lock', 'Retention mode')).toBe('-');
    expect(field('Object Lock', 'Default retention period')).toBe('-');
    expect(field('Requester pays', 'Requester pays')).toBe('Disabled');
    expect(field('Static website hosting', 'Static website hosting')).toBe('Disabled');
    expect(field('Static website hosting', 'Index document')).toBe('-');
    expect(field('Static website hosting', 'Error document')).toBe('-');
    expect(tableRows('Tags')).toEqual([]);
    expect(sectionText('Tags')).toContain('No tags');
    expect(sectionText('Tags')).toContain('This bucket has no tags.');
    expect(tableRows('S3 Intelligent-Tiering Archive configurations')).toEqual([]);
    expect(sectionText('S3 Intelligent-Tiering Archive configurations')).toContain('No configurations');
    expect(sectionText('S3 Intelligent-Tiering Archive configurations')).toContain(
      'This bucket has no Intelligent-Tiering Archive configurations.',
    );
    expect(tableRows('Event notifications')).toEqual([]);
    expect(sectionText('Event notifications')).toContain('No event notifications');
    expect(sectionText('Event notifications')).toContain('This bucket sends no event notifications.');
  });

  it('a bucket whose Region Studio has no name for → the code alone; an answer without a Region → "-"', async () => {
    await openBucket({}, { ...ALPHA, region: 'xx-unknown-9' });
    expect(field('Bucket overview', 'AWS Region')).toBe('xx-unknown-9');
  });

  it('an answer without a Region, an ARN or a date → "-" for each', async () => {
    await openBucket({}, { name: 'alpha' });

    expect(field('Bucket overview', 'AWS Region')).toBe('-');
    expect(field('Bucket overview', 'Bucket ARN')).toBe('-');
    expect(field('Bucket overview', 'Creation date')).toBe('-');
  });

  it('a truncated list of configurations → "More configurations exist than are shown here." under the table', async () => {
    await openBucket({
      'intelligent-tiering': () =>
        ok(
          '<ListBucketIntelligentTieringConfigurationsOutput><IsTruncated>true</IsTruncated><NextContinuationToken>t</NextContinuationToken>' +
            '<IntelligentTieringConfiguration><Id>one</Id><Status>Enabled</Status></IntelligentTieringConfiguration>' +
            '</ListBucketIntelligentTieringConfigurationsOutput>',
        ),
    });

    expect(tableRows('S3 Intelligent-Tiering Archive configurations')).toEqual([['one', 'Enabled', '-', '-', '-']]);
    expect(sectionText('S3 Intelligent-Tiering Archive configurations')).toContain(
      'More configurations exist than are shown here.',
    );
  });

  it('a list that is not truncated has no such line', async () => {
    await openBucket(FULL);

    expect(sectionText('S3 Intelligent-Tiering Archive configurations')).not.toContain('More configurations exist');
  });

  it('a tag value `<img src=x onerror=alert(1)>` → shown as text; the page holds no image', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    await openBucket({
      tagging: () => ok(`<Tagging><TagSet><Tag><Key>k</Key><Value>${xml(markup)}</Value></Tag></TagSet></Tagging>`),
      website: () =>
        ok(
          `<WebsiteConfiguration><IndexDocument><Suffix>${xml(markup)}</Suffix></IndexDocument></WebsiteConfiguration>`,
        ),
    });

    expect(tableRows('Tags')).toEqual([['k', markup]]);
    expect(field('Static website hosting', 'Index document')).toBe(markup);
    expect(screen.getByRole('main').querySelector('img')).toBeNull();
  });

  it('values the user or the emulator gives sit in the area’s breaking element: the ARN, a key, a tag key and value', async () => {
    const key = 'k'.repeat(128);
    await openBucket({
      ...FULL,
      tagging: () => ok(`<Tagging><TagSet><Tag><Key>${key}</Key><Value>v</Value></Tag></TagSet></Tagging>`),
    });

    for (const [title, text] of [
      ['Bucket overview', 'arn:aws:s3:::alpha'],
      ['Default encryption', KMS_KEY],
      ['Tags', key],
      ['Event notifications', QUEUE],
    ] as const) {
      expect(within(section(title)).getByText(text)).toHaveClass('aws-s3-break-anywhere');
    }
  });
});

describe('a bucket’s page, its sections’ buttons', () => {
  const BUTTONS: [string, string, string][] = [
    ['Bucket Versioning', 'Edit', '/aws/s3/bucket/alpha/property/versioning/edit'],
    ['Bucket ABAC', 'Edit', '/aws/s3/bucket/alpha/property/abac/edit'],
    ['Tags', 'Edit', '/aws/s3/bucket/alpha/property/tags/edit'],
    ['Default encryption', 'Edit', '/aws/s3/bucket/alpha/property/encryption/edit'],
    [
      'S3 Intelligent-Tiering Archive configurations',
      'Create configuration',
      '/aws/s3/bucket/alpha/property/intelligent-tiering/create',
    ],
    ['Server access logging', 'Edit', '/aws/s3/bucket/alpha/property/logging/edit'],
    ['Event notifications', 'Create event notification', '/aws/s3/bucket/alpha/property/event-notification/create'],
    ['Amazon EventBridge', 'Edit', '/aws/s3/bucket/alpha/property/eventbridge/edit'],
    ['Transfer acceleration', 'Edit', '/aws/s3/bucket/alpha/property/transfer-acceleration/edit'],
    ['Object Lock', 'Edit', '/aws/s3/bucket/alpha/property/object-lock/edit'],
    ['Requester pays', 'Edit', '/aws/s3/bucket/alpha/property/requester-pays/edit'],
    ['Static website hosting', 'Edit', '/aws/s3/bucket/alpha/property/website/edit'],
  ];

  it.each(BUTTONS)('"%s" has "%s", which leads to %s', async (title, label, path) => {
    const { router } = await openBucket();

    const button = within(section(title)).getByRole('link', { name: label });
    expect(button).toHaveAttribute('href', path);
    fireEvent.click(button);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(path);
    });
  });

  it('"Bucket overview" has no button', async () => {
    await openBucket();

    expect(within(section('Bucket overview')).queryAllByRole('link')).toEqual([]);
    expect(within(section('Bucket overview')).queryAllByRole('button')).toEqual([]);
  });
});

describe('a bucket’s page, a section’s read', () => {
  it('each section reads its own operation once on opening, after the page found the bucket', async () => {
    await openBucket();

    const listAt = engine.aws.findIndex(isList);
    for (const part of PARTS) {
      expect(engine.reads(part), part).toHaveLength(1);
      const read = engine.reads(part)[0] as URL;
      // Path-style, to the bucket of the page.
      expect(read.pathname).toMatch(/^\/alpha\/?$/);
      expect(engine.aws.indexOf(read)).toBeGreaterThan(listAt);
    }
  });

  it('while a section’s read is in flight → "Loading" in that section, the others’ values shown', async () => {
    const answer = held();
    engine.buckets = [ALPHA];
    engine.parts = { ...PLAIN, versioning: () => answer.answer };
    open();

    await waitFor(() => {
      expect(field('Bucket ABAC', 'Bucket ABAC')).toBe('Disabled');
      expect(field('Requester pays', 'Requester pays')).toBe('Disabled');
    });
    expect(sectionText('Bucket Versioning')).toContain('Loading');
    expect(field('Bucket Versioning', 'Bucket Versioning')).toBeNull();
    answer.release(ok('<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>'));

    await waitFor(() => {
      expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Suspended');
    });
    expect(sectionText('Bucket Versioning')).not.toContain('Loading');
  });

  it('a section’s read answers "no such bucket" → the whole page shows "Bucket not found"', async () => {
    engine.buckets = [ALPHA];
    engine.parts = { ...PLAIN, logging: () => errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist') };
    open();

    expect(await screen.findByText('Bucket not found')).toBeInTheDocument();
    expect(tabNames()).toEqual([]);
    expect(sectionHeadings()).toEqual([]);
    expect(h1()).toHaveTextContent(/^alpha$/);
  });

  it('another code → that section shows the failure, code and message and "Retry"; its heading and button stay; the others show their values', async () => {
    await openBucket({ encryption: () => errorAnswer(500, 'InternalError', 'something broke') });

    const text = sectionText('Default encryption');
    expect(text).toContain('The bucket could not be read');
    expect(text).toContain('InternalError: something broke');
    expect(within(section('Default encryption')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(section('Default encryption')).getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(field('Default encryption', 'Encryption type')).toBeNull();
    expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Disabled');
    expect(field('Object Lock', 'Object Lock')).toBe('Disabled');
  });

  it('"Retry" of a section reads that section alone', async () => {
    await openBucket({ encryption: () => errorAnswer(500, 'InternalError', 'something broke') });
    const before = Object.fromEntries(PARTS.map((part) => [part, engine.reads(part).length]));
    const lists = engine.lists.length;

    engine.parts.encryption = PLAIN.encryption;
    fireEvent.click(within(section('Default encryption')).getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(field('Default encryption', 'Bucket Key')).toBe('Disabled');
    });
    for (const part of PARTS) {
      expect(engine.reads(part), part).toHaveLength((before[part] ?? 0) + (part === 'encryption' ? 1 : 0));
    }
    expect(engine.lists).toHaveLength(lists);
  });

  it('a failed table section shows its failure in the table, with "Retry"', async () => {
    await openBucket({ tagging: () => errorAnswer(500, 'InternalError', 'tags broke') });

    expect(sectionText('Tags')).toContain('InternalError: tags broke');
    expect(sectionText('Tags')).not.toContain('No tags');
    expect(within(section('Tags')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(section('Tags')).getByRole('link', { name: 'Edit' })).toBeInTheDocument();
  });

  it('AccessDenied → "Access denied" and the message returned in that section, with "Retry"', async () => {
    await openBucket({ website: () => errorAnswer(403, 'AccessDenied', 'not for you') });

    const text = sectionText('Static website hosting');
    expect(text).toContain('Access denied');
    expect(text).toContain('GetBucketWebsite was refused: not for you');
    expect(within(section('Static website hosting')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('the engine’s EmulatorUnavailable while connected → "The emulator did not answer", the engine’s message and "Retry"', async () => {
    await openBucket({ accelerate: () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator went away') });

    const text = sectionText('Transfer acceleration');
    expect(text).toContain('The emulator did not answer');
    expect(text).toContain('the emulator went away');
    expect(within(section('Transfer acceleration')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('501 → "Not implemented by the emulator" and the operation’s name in that section, as information', async () => {
    await openBucket({ abac: () => errorAnswer(501, 'NotImplemented', 'operation GetBucketAbac is not implemented') });

    const text = sectionText('Bucket ABAC');
    expect(text).toContain('Not implemented by the emulator');
    expect(text).toContain('GetBucketAbac');
    const status = within(section('Bucket ABAC')).getByText('Not implemented by the emulator');
    expect(status.closest('[class*="status-info"]')).not.toBeNull();
  });

  it('while not connected → "Not read" in that section, with "Retry"', async () => {
    await openBucket({ 'object-lock': () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator is not running') });
    // The page found the bucket while connected; the section's read failed after the line stopped saying so.
    connection.set(notStartedResult());

    await waitFor(() => {
      expect(sectionText('Object Lock')).toContain('Not read');
    });
    expect(within(section('Object Lock')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('a bucket’s page, "Refresh" and its sections', () => {
  it('"Refresh" sends the page’s read and every section’s read again, then announces "Bucket refreshed"', async () => {
    await openBucket();
    const said = recordAnnouncements();

    engine.parts.versioning = FULL.versioning;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Enabled');
    });
    expect(said).toContain('Bucket refreshed');
    expect(engine.lists).toHaveLength(2);
    for (const part of PARTS) {
      expect(engine.reads(part), part).toHaveLength(2);
    }
  });
});
