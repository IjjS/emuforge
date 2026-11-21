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
const PARTS = ['versioning', 'tagging', 'encryption', 'notification', 'website'] as const;
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
  tagging: () => errorAnswer(404, 'NoSuchTagSet', 'The TagSet does not exist'),
  encryption: () =>
    ok(
      '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm>' +
        '</ApplyServerSideEncryptionByDefault><BucketKeyEnabled>false</BucketKeyEnabled></Rule></ServerSideEncryptionConfiguration>',
    ),
  notification: () => ok('<NotificationConfiguration/>'),
  website: () =>
    errorAnswer(404, 'NoSuchWebsiteConfiguration', 'The specified bucket does not have a website configuration'),
};

const KMS_KEY = 'arn:aws:kms:us-east-1:000000000000:key/0f6b2c5e-1a2b-4c3d-9e8f-0123456789ab';
const QUEUE = 'arn:aws:sqs:us-east-1:000000000000:alpha-events';

/** What a bucket with every property set answers. */
const FULL: Record<Part, () => EngineAnswer> = {
  versioning: () => ok('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'),
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
  notification: () =>
    ok(
      '<NotificationConfiguration><QueueConfiguration><Id>to-queue</Id>' +
        `<Queue>${QUEUE}</Queue><Event>s3:ObjectCreated:Put</Event><Event>s3:ObjectRemoved:*</Event>` +
        '<Filter><S3Key><FilterRule><Name>prefix</Name><Value>in/</Value></FilterRule>' +
        '<FilterRule><Name>suffix</Name><Value>.csv</Value></FilterRule></S3Key></Filter></QueueConfiguration>' +
        '<EventBridgeConfiguration></EventBridgeConfiguration></NotificationConfiguration>',
    ),
  website: () =>
    ok(
      '<WebsiteConfiguration><IndexDocument><Suffix>index.html</Suffix></IndexDocument>' +
        '<ErrorDocument><Key>error.html</Key></ErrorDocument></WebsiteConfiguration>',
    ),
};

/** Whether `url` is a `ListObjectsV2` request. */
function isObjectList(url: URL): boolean {
  return url.searchParams.get('list-type') === '2';
}

/** An object the emulator holds, by its key. */
interface FakeObject {
  key: string;
  size?: number;
  date?: string;
  storageClass?: string;
}

/**
 * `ListObjectsV2` over `objects` (sorted by key) as the emulator answers it: `prefix`, the delimiter `/` folding deeper
 * keys into common prefixes, `max-keys` (or `pageSize` when set) and a token that is the index the next page starts at.
 */
function objectListing(objects: readonly FakeObject[], url: URL, pageSize?: number): Answer {
  const prefix = url.searchParams.get('prefix') ?? '';
  const delimiter = url.searchParams.get('delimiter');
  const size = pageSize ?? Number(url.searchParams.get('max-keys') ?? '1000');
  const start = Number(url.searchParams.get('continuation-token') ?? '0');
  const entries: ({ kind: 'object'; object: FakeObject } | { kind: 'prefix'; prefix: string })[] = [];
  for (const object of [...objects].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    if (!object.key.startsWith(prefix)) continue;
    const rest = object.key.slice(prefix.length);
    const at = delimiter === null ? -1 : rest.indexOf(delimiter);
    if (at === -1) {
      entries.push({ kind: 'object', object });
    } else {
      const common = prefix + rest.slice(0, at + 1);
      if (!entries.some((entry) => entry.kind === 'prefix' && entry.prefix === common)) {
        entries.push({ kind: 'prefix', prefix: common });
      }
    }
  }
  const page = entries.slice(start, start + size);
  const truncated = start + size < entries.length;
  const contents = page
    .flatMap((entry) => (entry.kind === 'object' ? [entry.object] : []))
    .map(
      ({ key, size: bytes = 0, date = '2026-11-18T10:00:00.000Z', storageClass = 'STANDARD' }) =>
        `<Contents><Key>${xml(key)}</Key><LastModified>${date}</LastModified><Size>${String(bytes)}</Size>` +
        `<StorageClass>${storageClass}</StorageClass></Contents>`,
    )
    .join('');
  const prefixes = page
    .flatMap((entry) => (entry.kind === 'prefix' ? [entry.prefix] : []))
    .map((common) => `<CommonPrefixes><Prefix>${xml(common)}</Prefix></CommonPrefixes>`)
    .join('');
  return ok(
    `<ListBucketResult><Name>alpha</Name><Prefix>${xml(prefix)}</Prefix><KeyCount>${String(page.length)}</KeyCount>` +
      `<IsTruncated>${String(truncated)}</IsTruncated>` +
      (truncated ? `<NextContinuationToken>${String(start + size)}</NextContinuationToken>` : '') +
      `${contents}${prefixes}</ListBucketResult>`,
  );
}

class FakeEngine {
  /** The buckets the emulator holds, in its order (names ascending). */
  buckets: FakeBucket[] = [];
  /** The objects of the bucket the page shows. */
  objects: FakeObject[] = [];
  /** A page size the emulator keeps to whatever `max-keys` asks, so a case can page over a few keys. */
  objectPageSize: number | undefined;
  /** The answer to `ListObjectsV2`; by default the emulator's listing of `objects`. */
  objectList: (url: URL) => EngineAnswer = (url) => objectListing(this.objects, url, this.objectPageSize);
  /** Every AWS request, its URL as sent. */
  readonly aws: URL[] = [];
  readonly notificationReads: Request[] = [];
  readonly notificationWrites: string[] = [];
  writeNotifications: (body: string) => EngineAnswer = (body) => {
    this.parts.notification = () => ok(body);
    return { status: 204, body: '' };
  };
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
    const notification = partOf(url) === 'notification';
    const writing = notification && request.method === 'PUT';
    if (notification && !writing) this.notificationReads.push(request);
    const response = writing
      ? request.text().then((body) => {
          this.notificationWrites.push(body);
          return this.writeNotifications(body);
        })
      : this.answer(url);
    const answer = await Promise.race([
      Promise.resolve(response),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(answer.status === 204 ? null : answer.body, { status: answer.status });
  };

  private answer(url: URL): EngineAnswer {
    if (isList(url)) {
      return this.list(url);
    }
    if (isObjectList(url)) {
      return this.objectList(url);
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

  /** The `ListObjectsV2` requests sent so far. */
  get objectLists(): URL[] {
    return this.aws.filter(isObjectList);
  }

  /** The requests of the section reading `part` sent so far. */
  reads(part: Part): URL[] {
    return this.aws.filter((url) => partOf(url) === part);
  }
}

/** The tab "Properties" of the bucket alpha, where the cases of issue 256 open (issue 480). */
const PROPERTIES = '/aws/s3/buckets/alpha/properties';

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

/** The connection Studio hands the area, as a case sets it; each change re-renders the area as the frame does. */
class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  targetGeneration = 0;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;

  set(result: CheckResult | undefined) {
    const previous = this.value.result;
    if (
      previous?.kind === 'connected' &&
      result?.kind === 'connected' &&
      previous.target !== undefined &&
      previous.target !== result.target
    )
      this.targetGeneration += 1;
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

function connectedResult(): Extract<CheckResult, { kind: 'connected' }> {
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
      targetGeneration={connection.targetGeneration}
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

function open(path = PROPERTIES) {
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

/** The `h1`'s description, or `null` when the `h1` has none (issue 467, R3). */
function h1Description(): string | null {
  const header = createWrapper(document.body)
    .findAllHeaders()
    .find((found) => found.getElement().querySelector('h1') !== null);
  expect(header).toBeDefined();
  const description = header?.findDescription();
  return description === null || description === undefined ? null : (description.getElement().textContent ?? '');
}

/** The crumbs' texts, in order. */
function crumbs(): string[] {
  const group = createWrapper(document.body).findBreadcrumbGroup();
  expect(group).not.toBeNull();
  return (group as NonNullable<typeof group>)
    .findBreadcrumbLinks()
    .map((crumb) => (crumb.getElement().textContent ?? '').trim());
}

/** The copy controls inside `scope`: the buttons named "Copy …". */
function copyControls(scope: HTMLElement): HTMLElement[] {
  return within(scope).queryAllByRole('button', { name: /^Copy / });
}

/** Whether `first` comes before `second` in the document. */
function before(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

const TABS = ['Objects', 'Properties'];

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
  it('the h1 is the name, with no description (issue 467, R3); the two tabs "Objects" and "Properties", "Properties" selected', async () => {
    await openLoaded();

    expect(h1()).toHaveTextContent(/^alpha$/);
    expect(h1Description()).toBeNull();
    expect(tabNames()).toEqual(TABS);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-selected', tab.textContent === 'Properties' ? 'true' : 'false');
    }
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  // Issue 480 (test-criteria.md, "Unit s1"): the bare route and `/objects` show "Objects", `/properties` "Properties".
  it.each([
    ['/aws/s3/buckets/alpha', 'Objects'],
    ['/aws/s3/buckets/alpha/objects', 'Objects'],
    ['/aws/s3/buckets/alpha/properties', 'Properties'],
  ])(
    'at %s, "%s" is selected, the page has exactly the two tabs, and the address stays as opened',
    async (path, tab) => {
      const { router } = await openLoaded(path);

      expect(tabNames()).toEqual(['Objects', 'Properties']);
      expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      expect(router.state.location.pathname).toBe(path);
    },
  );

  it('a loaded bucket of a 63-character name: the h1 shows the whole name as a name, and the last crumb holds the whole name (issue 467, R6)', async () => {
    const long = 'a'.repeat(63);
    engine.buckets = [{ name: long }];
    open(`/aws/s3/buckets/${long}`);
    await expectTabs();

    expect(h1()).toHaveTextContent(long);
    expect(kindOf(h1(), long)).toBe('name');
    // The last crumb is the area's `BreadcrumbGroup` item, a string `area-layout.tsx` renders: its whole name, as
    // Cloudscape renders it (decisions.md, 2026-11-18 04:00).
    expect(crumbs().at(-1)).toBe(long);
    expect(document.querySelector('.aws-s3-break-anywhere')).toBeNull();
  });

  it.each([
    ['/aws/s3/buckets/alpha', 'objects'],
    ['/aws/s3/buckets/alpha/properties', 'buckets'],
  ])('at %s the notice reads "These %s are in your local emulator", with the (i) control', async (path, word) => {
    await openLoaded(path);

    expect(screen.getByText(`These ${word} are in your local emulator`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About the local emulator' })).toBeInTheDocument();
  });
});

describe('a bucket’s page, its tabs', () => {
  it.each([
    ['Objects', PROPERTIES, '/aws/s3/buckets/alpha'],
    ['Properties', '/aws/s3/buckets/alpha', PROPERTIES],
    ['Properties', '/aws/s3/buckets/alpha/objects', PROPERTIES],
  ])('"%s" from %s leads to %s', async (tab, from, path) => {
    const { router } = await openLoaded(from);

    expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('href', path);
    fireEvent.click(screen.getByRole('tab', { name: tab }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(path);
    });
    expect(await screen.findByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
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
    const sentence = onPage(
      'The emulator holds no bucket named “alpha”. It may have been deleted, or the emulator restarted.',
    );
    expect(kindOf(sentence, 'alpha')).toBe('name');
    expect(screen.getByRole('link', { name: 'General purpose buckets', current: false })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'General purpose buckets' });
    expect(links.some((link) => link.closest('nav') === null && link.getAttribute('href') === '/aws/s3/buckets')).toBe(
      true,
    );
    expect(tabNames()).toEqual([]);
    expect(h1()).toHaveTextContent(/^alpha$/);
    expect(h1Description()).toBeNull();
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
    expect(h1Description()).toBeNull();
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
  'Tags',
  'Default encryption',
  'Event notifications',
  'Static website hosting',
];

/** The sections issue 480 dropped (requirement, "Screens on main"). */
const DROPPED = [
  'Bucket ABAC',
  'S3 Intelligent-Tiering Archive configurations',
  'Server access logging',
  'Amazon EventBridge',
  'Transfer acceleration',
  'Object Lock',
  'Requester pays',
];

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
      expect(within(section(title)).queryByText(/^Loading(?: event notifications)?$/)).toBeNull();
    }
  });
}

async function openBucket(parts: Partial<Record<Part, () => EngineAnswer>> = {}, bucket: FakeBucket = ALPHA) {
  engine.buckets = [bucket];
  engine.parts = { ...PLAIN, ...parts };
  const opened = open(`/aws/s3/buckets/${bucket.name}/properties`);
  await expectSectionsShown();
  return opened;
}

describe('a bucket’s page, its sections', () => {
  it('a bucket with every property set → the six kept sections in the spec’s order, none of the seven dropped', async () => {
    await openBucket(FULL);

    expect(sectionHeadings()).toEqual(SECTIONS);
    expect(screen.queryByText('AWS CloudTrail data events')).toBeNull();
    for (const title of DROPPED) {
      expect(screen.queryByText(title)).toBeNull();
    }
  });

  it('the same → each field shows its value', async () => {
    await openBucket(FULL);

    expect(field('Bucket overview', 'AWS Region')).toBe('Asia Pacific (Seoul) ap-northeast-2');
    expect(field('Bucket overview', 'Bucket ARN')).toBe('arn:aws:s3:::alpha');
    expect(field('Bucket overview', 'Creation date')).toMatch(
      /^(October|November) \d{1,2}, 2026, \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/,
    );
    expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Enabled');
    expect(tableRows('Tags')).toEqual([
      ['team', 'storage'],
      ['env', 'dev'],
    ]);
    expect(field('Default encryption', 'Encryption type')).toBe(
      'Server-side encryption with AWS Key Management Service keys (SSE-KMS)',
    );
    expect(field('Default encryption', 'AWS KMS key')).toBe(KMS_KEY);
    expect(field('Default encryption', 'Bucket Key')).toBe('Enabled');
    expect(tableRows('Event notifications')).toEqual([
      [
        'to-queue',
        's3:ObjectCreated:Put, s3:ObjectRemoved:*',
        'in/',
        '.csv',
        'SQS queue',
        `${QUEUE}Open queue`,
        'EditDelete',
      ],
    ]);
    expect(field('Static website hosting', 'Static website hosting')).toBe('Enabled');
    expect(field('Static website hosting', 'Index document')).toBe('index.html');
    expect(field('Static website hosting', 'Error document')).toBe('error.html');
  });

  it('the column headings of the two tables, in the console’s words', async () => {
    await openBucket(FULL);

    const headings = (title: string) =>
      [...section(title).querySelectorAll('thead th')].map((cell) => norm(cell.textContent));
    expect(headings('Tags')).toEqual(['Key', 'Value']);
    expect(headings('Event notifications')).toEqual([
      'Event name',
      'Event types',
      'Prefix',
      'Suffix',
      'Destination type',
      'Destination',
      'Actions',
    ]);
  });

  it('a plain bucket → "Disabled", "-" where nothing is set, and the two tables’ empty texts', async () => {
    await openBucket();

    expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Disabled');
    expect(field('Default encryption', 'Encryption type')).toBe(
      'Server-side encryption with Amazon S3 managed keys (SSE-S3)',
    );
    expect(field('Default encryption', 'AWS KMS key')).toBe('-');
    expect(field('Default encryption', 'Bucket Key')).toBe('Disabled');
    expect(field('Static website hosting', 'Static website hosting')).toBe('Disabled');
    expect(field('Static website hosting', 'Index document')).toBe('-');
    expect(field('Static website hosting', 'Error document')).toBe('-');
    expect(tableRows('Tags')).toEqual([]);
    expect(sectionText('Tags')).toContain('No tags');
    expect(sectionText('Tags')).toContain('This bucket has no tags.');
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

  it('"Bucket overview": "Copy Bucket ARN" directly before the ARN, shown as an address; "AWS Region" and "Creation date" as fixed words (issue 467, R5, R6)', async () => {
    await openBucket(FULL);

    const overview = section('Bucket overview');
    const copy = within(overview).getByRole('button', { name: 'Copy Bucket ARN' });
    expect(copyControls(overview)).toEqual([copy]);
    expect(kindOf(overview, 'arn:aws:s3:::alpha')).toBe('address');
    const arn = [...overview.querySelectorAll('.aws-area-value')].find(
      (found) => found.textContent === 'arn:aws:s3:::alpha',
    );
    expect(before(copy, arn as Element)).toBe(true);
    expect(kindOf(overview, 'Asia Pacific (Seoul) ap-northeast-2')).toBe('fixed');
    expect(kindOf(overview, field('Bucket overview', 'Creation date') ?? '')).toBe('fixed');
  });

  it('"Default encryption" of a bucket with a KMS key → "Copy AWS KMS key" directly before the key, shown as an address; without one → "-" and no copy control (issue 467, R5)', async () => {
    const { unmount } = await openBucket(FULL);

    const encryption = section('Default encryption');
    const copy = within(encryption).getByRole('button', { name: 'Copy AWS KMS key' });
    expect(copyControls(encryption)).toEqual([copy]);
    expect(kindOf(encryption, KMS_KEY)).toBe('address');
    const key = [...encryption.querySelectorAll('.aws-area-value')].find((found) => found.textContent === KMS_KEY);
    expect(before(copy, key as Element)).toBe(true);
    unmount();

    await openBucket();
    expect(field('Default encryption', 'AWS KMS key')).toBe('-');
    expect(copyControls(section('Default encryption'))).toEqual([]);
    expect(copyControls(screen.getByRole('main')).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Copy Bucket ARN',
    ]);
  });

  it('a section whose read failed or is loading → no copy control in it (issue 467, R5)', async () => {
    const { unmount } = await openBucket({
      ...FULL,
      encryption: () => errorAnswer(500, 'InternalError', 'something broke'),
    });
    expect(sectionText('Default encryption')).toContain('InternalError: something broke');
    expect(copyControls(section('Default encryption'))).toEqual([]);
    unmount();

    const answer = held();
    engine.buckets = [ALPHA];
    engine.parts = { ...FULL, encryption: () => answer.answer };
    open();
    await waitFor(() => {
      expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Enabled');
    });
    expect(sectionText('Default encryption')).toContain('Loading');
    expect(copyControls(section('Default encryption'))).toEqual([]);
    answer.release(FULL.encryption() as Answer);
    await waitFor(() => {
      expect(copyControls(section('Default encryption'))).toHaveLength(1);
    });
  });

  it('the tables of the sections: a tag’s key and a notification’s name as names; a destination type as a fixed word; a tag’s value, a prefix and a suffix as free text; a destination ARN as an address (issue 467, R6)', async () => {
    await openBucket({
      ...FULL,
      tagging: () =>
        ok('<Tagging><TagSet><Tag><Key>archive-reports</Key><Value>kept for one year</Value></Tag></TagSet></Tagging>'),
    });

    const tags = section('Tags');
    expect(kindOf(tags, 'archive-reports')).toBe('name');
    expect(kindOf(tags, 'kept for one year')).toBe('text');
    const notifications = section('Event notifications');
    expect(kindOf(notifications, 'to-queue')).toBe('name');
    expect(kindOf(notifications, 'in/')).toBe('text');
    expect(kindOf(notifications, '.csv')).toBe('text');
    expect(kindOf(notifications, 'SQS queue')).toBe('fixed');
    expect(kindOf(notifications, QUEUE)).toBe('address');
    expect(document.querySelector('.aws-s3-break-anywhere')).toBeNull();
  });
});

describe('a bucket’s page, its sections’ buttons', () => {
  const BUTTONS: [string, string, string][] = [
    ['Bucket Versioning', 'Edit', '/aws/s3/bucket/alpha/property/versioning/edit'],
    ['Tags', 'Edit', '/aws/s3/bucket/alpha/property/tags/edit'],
    ['Default encryption', 'Edit', '/aws/s3/bucket/alpha/property/encryption/edit'],
    ['Event notifications', 'Create event notification', '/aws/s3/bucket/alpha/property/event-notification/create'],
    ['Static website hosting', 'Edit', '/aws/s3/bucket/alpha/property/website/edit'],
  ];

  it('the page has exactly the five buttons of the kept sections', async () => {
    await openBucket();

    const links = within(screen.getByRole('main'))
      .queryAllByRole('link')
      .filter((link) => link.closest('nav') === null && /\/property\//.test(link.getAttribute('href') ?? ''));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(BUTTONS.map(([, , path]) => path));
  });

  it.each(BUTTONS)('"%s" has "%s", which leads to %s', async (title, label, path) => {
    const { router } = await openBucket();

    const button = within(section(title)).getByRole('link', { name: label });
    expect(button).toHaveAttribute('href', path);
    fireEvent.click(button);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(path);
    });
  });

  it('"Bucket overview" has no button but the ARN’s copy control', async () => {
    await openBucket();

    expect(within(section('Bucket overview')).queryAllByRole('link')).toEqual([]);
    expect(
      within(section('Bucket overview'))
        .queryAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Copy Bucket ARN']);
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
      expect(field('Default encryption', 'Bucket Key')).toBe('Disabled');
      expect(field('Static website hosting', 'Static website hosting')).toBe('Disabled');
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
    engine.parts = { ...PLAIN, website: () => errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist') };
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
    expect(field('Static website hosting', 'Static website hosting')).toBe('Disabled');
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
    await openBucket({ versioning: () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator went away') });

    const text = sectionText('Bucket Versioning');
    expect(text).toContain('The emulator did not answer');
    expect(text).toContain('the emulator went away');
    expect(within(section('Bucket Versioning')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('501 → "Not implemented by the emulator" and the operation’s name in that section, as information', async () => {
    await openBucket({
      versioning: () => errorAnswer(501, 'NotImplemented', 'operation GetBucketVersioning is not implemented'),
    });

    const text = sectionText('Bucket Versioning');
    expect(text).toContain('Not implemented by the emulator');
    expect(text).toContain('GetBucketVersioning');
    const status = within(section('Bucket Versioning')).getByText('Not implemented by the emulator');
    expect(status.closest('[class*="status-info"]')).not.toBeNull();
  });

  it('while not connected → "Not read" in that section, with "Retry"', async () => {
    await openBucket({ encryption: () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator is not running') });
    // The page found the bucket while connected; the section's read failed after the line stopped saying so.
    connection.set(notStartedResult());

    await waitFor(() => {
      expect(sectionText('Default encryption')).toContain('Not read');
    });
    expect(within(section('Default encryption')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
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

  it('"Bucket refreshed" is announced only once every section’s read has answered again', async () => {
    await openBucket();
    const said = recordAnnouncements();
    const answer = held();
    const reads = engine.reads('versioning').length;
    engine.parts.versioning = () => answer.answer;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(engine.reads('versioning')).toHaveLength(reads + 1);
      expect(sectionText('Bucket Versioning')).toContain('Loading');
    });
    await waitFor(() => {
      expect(field('Static website hosting', 'Static website hosting')).not.toBeNull();
    });
    expect(said).not.toContain('Bucket refreshed');
    answer.release(ok('<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>'));

    await waitFor(() => {
      expect(said).toContain('Bucket refreshed');
    });
    expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Suspended');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Issue 480, the tab "Objects" (test-criteria.md, "Unit s1 — services/s3/pages/bucket-page.test.tsx").
// ---------------------------------------------------------------------------------------------------------------

const APP_OBJECTS: FakeObject[] = [
  { key: 'a.txt', size: 12 },
  { key: 'q?#%.txt', size: 1536, storageClass: 'STANDARD_IA' },
  { key: 'logs/2026/x.json', size: 20 },
  { key: 'logs/2026/y.json', size: 30 },
  { key: '한글/파일.txt', size: 5 },
];

/** The Objects table. */
function objectsTable() {
  const table = createWrapper(document.body)
    .findAllTables()
    .find((found) => found.findHeaderSlot()?.getElement().textContent?.includes('Objects') === true);
  expect(table, 'the Objects table').toBeDefined();
  return table as NonNullable<typeof table>;
}

/** The Objects table's rows, each its cells' text but the selection cell's. */
function objectRowsShown(): string[][] {
  return [...objectsTable().getElement().querySelectorAll('tbody tr')]
    .map((row) => [...row.querySelectorAll('td, th')].slice(1).map((cell) => norm(cell.textContent)))
    .filter((cells) => cells.length > 1);
}

/** The Key column of the rows shown. */
function keysShown(): string[] {
  return objectRowsShown().map(([key]) => key ?? '');
}

async function expectKeys(keys: string[]) {
  await waitFor(() => {
    expect(keysShown()).toEqual(keys);
  });
}

async function openObjects(path = '/aws/s3/buckets/alpha', objects: FakeObject[] = APP_OBJECTS) {
  engine.buckets = [ALPHA];
  engine.objects = objects;
  const opened = open(path);
  await expectTabs();
  return opened;
}

/** The empty slot's text, a space after each block (title, sentence, line) as a reader hears them apart. */
function objectsEmptySlot(): string {
  const slot = objectsTable().findEmptySlot()?.getElement().cloneNode(true);
  if (!(slot instanceof HTMLElement)) return '';
  for (const block of slot.querySelectorAll('div, p, strong, b')) block.append(' ');
  return norm(slot.textContent);
}

function objectsAction(name: string): HTMLElement {
  return within(objectsTable().getElement()).getByRole('button', { name });
}

/** A Cloudscape button is disabled by `disabled`, or with a reason by `aria-disabled`. */
function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function selectRow(name: string) {
  fireEvent.click(within(objectsTable().getElement()).getByRole('checkbox', { name: `Select ${name}` }));
}

function selectedNames(): string[] {
  return within(objectsTable().getElement())
    .queryAllByRole('checkbox')
    .filter(
      (box) => (box as HTMLInputElement).checked && /^Select (?!every)/.test(box.getAttribute('aria-label') ?? ''),
    )
    .map((box) => (box.getAttribute('aria-label') ?? '').replace(/^Select /, ''));
}

/** The crumbs with their links: the text, and the address of a link or `null` for the current page. */
function crumbLinks(): [string, string | null][] {
  return (createWrapper(document.body).findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((item) => {
    const element = item.getElement();
    const link = element.closest('a[href]') ?? element.querySelector('a[href]');
    return [(element.textContent ?? '').trim(), link?.getAttribute('href') ?? null];
  });
}

function typeObjectFilter(text: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find objects by prefix' }), { target: { value: text } });
}

describe('the tab "Objects", its rows', () => {
  it('folders first, then objects: Key, Type, Last modified, Size, Storage class; a folder "Folder" and "-"', async () => {
    await openObjects();

    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);
    const headings = (objectsTable().findColumnHeaders() ?? []).map((header) => norm(header.getElement().textContent));
    expect(headings.slice(1)).toEqual(['Key', 'Type', 'Last modified', 'Size', 'Storage class']);
    const [logs, , a, q] = objectRowsShown();
    expect(logs).toEqual(['logs/', 'Folder', '-', '-', '-']);
    expect(a?.slice(0, 2)).toEqual(['a.txt', 'txt']);
    expect(a?.[2]).toMatch(/^November 18, 2026, \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
    expect(a?.slice(3)).toEqual(['12 B', 'STANDARD']);
    expect(q?.slice(3)).toEqual(['1.5 KiB', 'STANDARD_IA']);
    expect(objectsTable().findHeaderSlot()?.getElement().textContent).toContain('(4)');
  });

  it('asks ListObjectsV2 for the root with the delimiter /, 100 keys and no prefix, after the bucket was found', async () => {
    await openObjects();
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);

    const [request] = engine.objectLists;
    expect(request?.pathname).toMatch(/^\/alpha\/?$/);
    expect(request?.searchParams.get('delimiter')).toBe('/');
    expect(request?.searchParams.get('max-keys')).toBe('100');
    expect(request?.searchParams.has('prefix')).toBe(false);
    expect(engine.aws.findIndex(isList)).toBeLessThan(engine.aws.indexOf(request as URL));
    // The tab "Properties" is not read on the tab "Objects".
    for (const part of PARTS) {
      expect(engine.reads(part), part).toEqual([]);
    }
  });

  it('a folder’s link leads to its prefix’s address and shows its rows; each crumb part to its own prefix, the last not a link', async () => {
    const { router } = await openObjects();
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);

    const logs = within(objectsTable().getElement()).getByRole('link', { name: 'logs/' });
    expect(logs).toHaveAttribute('href', '/aws/s3/buckets/alpha?prefix=logs%2F');
    fireEvent.click(logs);
    await expectKeys(['2026/']);
    fireEvent.click(within(objectsTable().getElement()).getByRole('link', { name: '2026/' }));
    await expectKeys(['x.json', 'y.json']);

    expect(router.state.location.search).toBe('?prefix=logs%2F2026%2F');
    expect(engine.objectLists.at(-1)?.searchParams.get('prefix')).toBe('logs/2026/');
    expect(crumbLinks().slice(3)).toEqual([
      ['Buckets', '/aws/s3/buckets'],
      ['alpha', '/aws/s3/buckets/alpha'],
      ['logs', '/aws/s3/buckets/alpha?prefix=logs%2F'],
      ['2026', null],
    ]);
    expect(screen.getByRole('tab', { name: 'Objects' })).toHaveAttribute('aria-selected', 'true');

    const crumb = screen.getAllByRole('link', { name: 'logs' }).find((link) => link.closest('nav') !== null);
    fireEvent.click(crumb as HTMLElement);
    await expectKeys(['2026/']);
    expect(router.state.location.search).toBe('?prefix=logs%2F');
  });

  it('an object’s key leads to its page, the key in the query', async () => {
    await openObjects();
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);

    expect(within(objectsTable().getElement()).getByRole('link', { name: 'q?#%.txt' })).toHaveAttribute(
      'href',
      `/aws/s3/buckets/alpha/object?${new URLSearchParams({ key: 'q?#%.txt' }).toString()}`,
    );
  });

  it('a key `<img src=x onerror=alert(1)>` is shown as text; the page holds no image', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    await openObjects('/aws/s3/buckets/alpha', [{ key: markup }]);

    await expectKeys([markup]);
    expect(screen.getByRole('main').querySelector('img')).toBeNull();
  });
});

describe('the tab "Objects", its states', () => {
  it('while the listing is in flight → "Loading objects"; then the rows', async () => {
    const answer = held();
    engine.objectList = () => answer.answer;
    await openObjects();

    await waitFor(() => {
      expect(objectsTable().findLoadingText()?.getElement()).toHaveTextContent('Loading objects');
    });
    answer.release(objectListing(APP_OBJECTS, new URL('http://x/alpha?list-type=2&delimiter=%2F')));
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);
  });

  it('an empty bucket → "No objects" and the root’s sentence', async () => {
    await openObjects('/aws/s3/buckets/alpha', []);

    await waitFor(() => {
      expect(objectsEmptySlot()).toBe(
        'No objects This bucket holds no objects yet. Upload a file, or write one from your app or the AWS CLI.',
      );
    });
  });

  it('an empty folder (its own empty object only) → "No objects" and "Nothing is stored under logs/."', async () => {
    await openObjects('/aws/s3/buckets/alpha?prefix=logs%2F', [{ key: 'logs/' }]);

    await waitFor(() => {
      expect(objectsEmptySlot()).toBe('No objects Nothing is stored under logs/.');
    });
    expect(keysShown()).toEqual([]);
  });

  it('a filter with no match → "No matches" and the sentence with the folder and the text', async () => {
    await openObjects('/aws/s3/buckets/alpha?prefix=logs%2F2026%2F');
    await expectKeys(['x.json', 'y.json']);

    typeObjectFilter('z');

    await waitFor(() => {
      expect(objectsEmptySlot()).toContain('No matches No key under logs/2026/ starts with z.');
    });
  });

  it.each(['/aws/s3/buckets/alpha', '/aws/s3/buckets/alpha/objects'])(
    'at %s, a bucket the emulator does not hold → "No bucket alpha", its sentence and "Go to Buckets"',
    async (path) => {
      engine.buckets = [];
      open(path);

      expect(await findOnPage('No bucket alpha')).toBeInTheDocument();
      expect(screen.getByText('The local emulator holds no bucket of this name.')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: 'Go to Buckets' });
      expect(link).toHaveAttribute('href', '/aws/s3/buckets');
      expect(tabNames()).toEqual([]);
    },
  );

  it('the listing answers NoSuchBucket → "No bucket alpha" in place of the table', async () => {
    engine.objectList = () => errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
    await openObjects();

    expect(await findOnPage('No bucket alpha')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Buckets' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Find objects by prefix' })).toBeNull();
  });

  it('a failed listing → "The objects could not be read", the code and message, and "Retry", which asks again', async () => {
    engine.objectList = () => errorAnswer(500, 'InternalError', 'something broke');
    await openObjects();

    await waitFor(() => {
      expect(objectsEmptySlot()).toContain('The objects could not be read');
    });
    expect(objectsEmptySlot()).toContain('InternalError: something broke');
    const asked = engine.objectLists.length;
    engine.objectList = (url) => objectListing(engine.objects, url);
    fireEvent.click(objectsAction('Retry'));

    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);
    expect(engine.objectLists.length).toBe(asked + 1);
  });

  it('a 501 → "Not implemented by the emulator: ListObjectsV2", as information', async () => {
    engine.objectList = () => errorAnswer(501, 'NotImplemented', 'operation ListObjectsV2 is scaffolded');
    await openObjects();

    await waitFor(() => {
      expect(objectsEmptySlot()).toContain('Not implemented by the emulator: ListObjectsV2');
    });
    const status = within(objectsTable().getElement()).getByText('Not implemented by the emulator:', {
      exact: false,
    });
    expect(status.closest('[class*="status-info"]')).not.toBeNull();
  });
});

describe('the tab "Objects", its filter, "Refresh" and pages', () => {
  it('"Find objects by prefix" asks with the folder plus the text, page 1', async () => {
    await openObjects('/aws/s3/buckets/alpha?prefix=logs%2F2026%2F');
    await expectKeys(['x.json', 'y.json']);

    typeObjectFilter('x');

    await expectKeys(['x.json']);
    const last = engine.objectLists.at(-1);
    expect(last?.searchParams.get('prefix')).toBe('logs/2026/x');
    expect(last?.searchParams.has('continuation-token')).toBe(false);
  });

  it('"Refresh" asks page 1 again and shows an object written since; "Objects refreshed" is announced', async () => {
    await openObjects();
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);
    const said = recordAnnouncements();
    const asked = engine.objectLists.length;

    engine.objects = [...APP_OBJECTS, { key: 'b.txt', size: 1 }];
    fireEvent.click(objectsAction('Refresh'));

    await expectKeys(['logs/', '한글/', 'a.txt', 'b.txt', 'q?#%.txt']);
    expect(engine.objectLists.length).toBe(asked + 1);
    expect(engine.objectLists.at(-1)?.searchParams.has('continuation-token')).toBe(false);
    await waitFor(() => {
      expect(said).toContain('Objects refreshed');
    });
  });

  it('next and previous pages follow the tokens; the counter says more remain while truncated', async () => {
    engine.objectPageSize = 2;
    await openObjects();
    await expectKeys(['logs/', 'a.txt']);
    expect(objectsTable().findHeaderSlot()?.getElement().textContent).toContain('(2+)');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await expectKeys(['한글/', 'q?#%.txt']);
    expect(engine.objectLists.at(-1)?.searchParams.get('continuation-token')).toBe('2');
    expect(objectsTable().findHeaderSlot()?.getElement().textContent).toContain('(2)');
    expect(objectsTable().findHeaderSlot()?.getElement().textContent).not.toContain('+');

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await expectKeys(['logs/', 'a.txt']);
    expect(engine.objectLists.at(-1)?.searchParams.has('continuation-token')).toBe(false);
  });
});

describe('the tab "Objects", its selection and "Copy S3 URI"', () => {
  it('"Copy S3 URI" with one selected row puts s3://alpha/{key} on the clipboard and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await openObjects();
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);
    const said = recordAnnouncements();
    const sent = engine.aws.length;

    selectRow('q?#%.txt');
    fireEvent.click(objectsAction('Copy S3 URI'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('s3://alpha/q?#%.txt');
    });
    expect(await within(objectsTable().getElement()).findByText('S3 URI copied')).toBeInTheDocument();
    await waitFor(() => {
      expect(said).toContain('S3 URI copied');
    });
    expect(engine.aws.length).toBe(sent);
  });

  it('a folder’s S3 URI is its whole prefix', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await openObjects('/aws/s3/buckets/alpha?prefix=logs%2F');
    await expectKeys(['2026/']);

    selectRow('2026/');
    fireEvent.click(objectsAction('Copy S3 URI'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('s3://alpha/logs/2026/');
    });
  });

  it('with no row or two rows selected, "Copy S3 URI" is unavailable', async () => {
    await openObjects();
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);

    expect(isDisabled(objectsAction('Copy S3 URI'))).toBe(true);
    selectRow('a.txt');
    expect(isDisabled(objectsAction('Copy S3 URI'))).toBe(false);
    selectRow('logs/');
    expect(selectedNames()).toEqual(['logs/', 'a.txt']);
    expect(isDisabled(objectsAction('Copy S3 URI'))).toBe(true);
  });

  it('the selection is cleared by a page change', async () => {
    engine.objectPageSize = 2;
    await openObjects();
    await expectKeys(['logs/', 'a.txt']);
    selectRow('logs/');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await expectKeys(['한글/', 'q?#%.txt']);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await expectKeys(['logs/', 'a.txt']);

    expect(selectedNames()).toEqual([]);
  });

  it('the selection is cleared by a filter', async () => {
    await openObjects();
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);
    selectRow('a.txt');

    typeObjectFilter('a');
    await expectKeys(['a.txt']);

    expect(selectedNames()).toEqual([]);
  });

  it('the selection is cleared by "Refresh"', async () => {
    await openObjects();
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);
    selectRow('a.txt');
    const asked = engine.objectLists.length;

    fireEvent.click(objectsAction('Refresh'));
    await waitFor(() => {
      expect(engine.objectLists.length).toBe(asked + 1);
    });
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);

    expect(selectedNames()).toEqual([]);
  });

  it('the selection is cleared by a prefix change', async () => {
    const { router } = await openObjects();
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);
    selectRow('a.txt');

    fireEvent.click(within(objectsTable().getElement()).getByRole('link', { name: 'logs/' }));
    await expectKeys(['2026/']);
    act(() => {
      void router.navigate(-1);
    });
    await expectKeys(['logs/', '한글/', 'a.txt', 'q?#%.txt']);

    expect(selectedNames()).toEqual([]);
  });
});

const NOTIFICATION_CREATE = '/aws/s3/bucket/alpha/property/event-notification/create';
const NOTIFICATION_EDIT = '/aws/s3/bucket/alpha/property/event-notification/~to-queue/edit';

function queueRule(id: string | undefined, arn = QUEUE) {
  return `<QueueConfiguration>${id === undefined ? '' : `<Id>${xml(id)}</Id>`}<Queue>${xml(arn)}</Queue><Event>s3:ObjectCreated:Put</Event></QueueConfiguration>`;
}

function notificationDocument(...rules: string[]) {
  return ok(`<NotificationConfiguration>${rules.join('')}</NotificationConfiguration>`);
}

async function startDelete() {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete to-queue' }));
  return screen.findByRole('dialog', { name: 'Delete event notification' });
}

function confirmDelete(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

describe('bucket event notifications', () => {
  it('shows a loading state, readable destinations, and actions for only unique named queues and functions', async () => {
    const pending = held();
    engine.buckets = [ALPHA];
    engine.parts.notification = () => pending.answer;
    open();
    expect(await screen.findByText('Loading event notifications')).toBeVisible();
    pending.release(
      notificationDocument(
        queueRule('unique'),
        queueRule('duplicate'),
        queueRule(undefined, 'invalid<'),
        '<TopicConfiguration><Id>duplicate</Id><Topic>arn:aws:sns:us-east-1:000000000000:topic</Topic><Event>s3:ObjectCreated:Copy</Event></TopicConfiguration>',
        '<CloudFunctionConfiguration><Id>fn</Id><CloudFunction>arn:aws:lambda:us-east-1:000000000000:function:fn:1</CloudFunction><Event>s3:ObjectCreated:Put</Event><Event>s3:ObjectRemoved:*</Event></CloudFunctionConfiguration>',
      ),
    );
    expect(await screen.findByRole('link', { name: 'Edit unique' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Edit fn' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete unique' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete fn' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: 'Edit duplicate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete duplicate' })).toBeNull();
    expect(screen.getAllByText('Read only')).toHaveLength(3);
    expect(screen.getByText('invalid<')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Edit fn' }).closest('tr')).toHaveTextContent(
      's3:ObjectCreated:Put, s3:ObjectRemoved:*',
    );
    for (const queue of screen.getAllByRole('link', { name: 'Open queue' })) {
      expect(queue).toHaveAttribute('href', '/aws/sqs/queues/queue/alpha-events');
    }
    expect(screen.getByRole('link', { name: 'Open function monitor' })).toHaveAttribute(
      'href',
      '/aws/lambda/functions/function/fn?tab=monitor',
    );
  });

  it('keeps actions and the copyable destination in the first column at narrow widths', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly onResize: ResizeObserverCallback) {}

        observe(element: Element) {
          if (element.querySelector('th')?.textContent?.trim() === 'Event name') {
            this.onResize([{ target: element, contentRect: { width: 348 } } as ResizeObserverEntry], this);
          }
        }

        unobserve() {}

        disconnect() {}
      },
    );

    await openBucket(FULL);
    const notificationSection = within(section('Event notifications'));
    const row = notificationSection.getByRole('link', { name: 'Edit to-queue' }).closest('tr');
    const firstCell = row?.cells[0];
    if (firstCell === undefined) throw new Error('Expected the first notification cell');
    const controls = within(firstCell);
    expect(controls.getByRole('link', { name: 'Edit to-queue' })).toBeVisible();
    expect(controls.getByRole('button', { name: 'Delete to-queue' })).toBeVisible();
    expect(controls.getByRole('link', { name: 'Open queue' })).toBeVisible();
    expect(controls.getByRole('button', { name: 'Copy Destination ARN' })).toBeVisible();
    expect(firstCell).toHaveTextContent(QUEUE);
    for (const column of ['Event types', 'Prefix', 'Suffix', 'Destination type']) {
      expect(notificationSection.getByRole('columnheader', { name: column })).toBeVisible();
    }
  });

  const ids = ['.', '..', '~.', '~..', 'parent/child', 'literal%2F'];
  it.each(ids)('follows and freshly opens the exact rule with ID %s', async (id) => {
    const { router, unmount } = await openBucket({
      notification: () => notificationDocument(...ids.map((value) => queueRule(value))),
    });
    const hrefs = within(section('Event notifications'))
      .getAllByRole('link', { name: /^Edit / })
      .map((link) => link.getAttribute('href'));
    expect(new Set(hrefs).size).toBe(ids.length);
    const link = screen.getByRole('link', { name: `Edit ${id}` });
    const href = link.getAttribute('href') ?? '';
    expect(href).toBe(`/aws/s3/bucket/alpha/property/event-notification/~${encodeURIComponent(id)}/edit`);
    fireEvent.click(link);
    expect(await screen.findByRole('textbox', { name: 'Notification name' })).toHaveValue(id);
    expect(router.state.location.pathname).toBe(href);
    unmount();
    open(href);
    expect(await screen.findByRole('textbox', { name: 'Notification name' })).toHaveValue(id);
    expect(engine.notificationWrites).toEqual([]);
  });

  it('rejects an unmarked edit segment and offers a return link', async () => {
    open(NOTIFICATION_EDIT.replace('~to-queue', 'to-queue'));
    expect(await screen.findByText('The notification address is invalid.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Return to Properties' })).toHaveAttribute('href', PROPERTIES);
    expect(engine.notificationWrites).toEqual([]);
  });

  it('names the delete target, cancels without writing, then removes only the confirmed rule', async () => {
    await openBucket({ notification: () => notificationDocument(queueRule('to-queue'), queueRule('keep')) });
    let dialog = await startDelete();
    expect(dialog).toHaveTextContent('Stop sending matching events for to-queue?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(engine.notificationWrites).toHaveLength(0);
    dialog = await startDelete();
    confirmDelete(dialog);
    expect(await screen.findByText('Event notification deleted')).toBeVisible();
    expect(engine.notificationWrites).toHaveLength(1);
    expect(engine.notificationWrites[0]).toContain('<Id>keep</Id>');
    expect(engine.notificationWrites[0]).not.toContain('<Id>to-queue</Id>');
  });

  describe.each(['Create', 'Edit'])('%s verified flash', (mode) => {
    it.each(['notifications first', 'other sections first'])('survives new Properties reads with %s', async (order) => {
      const editing = mode === 'Edit';
      const verify = held();
      const notifications = held();
      const versioning = held();
      engine.buckets = [ALPHA];
      let saved = '';
      engine.parts.notification = () =>
        editing ? notificationDocument(queueRule('to-queue')) : notificationDocument();
      engine.writeNotifications = (body) => {
        saved = body;
        engine.parts.notification = () => verify.answer;
        return { status: 204, body: '' };
      };
      const { router } = open(editing ? NOTIFICATION_EDIT : NOTIFICATION_CREATE);
      const name = await screen.findByRole('textbox', { name: 'Notification name' });
      if (editing) {
        fireEvent.change(screen.getByRole('textbox', { name: 'Prefix (optional)' }), { target: { value: 'ready/' } });
      } else {
        fireEvent.change(name, { target: { value: 'new' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Destination ARN' }), { target: { value: QUEUE } });
      }
      fireEvent.click(screen.getByRole('button', { name: editing ? 'Save changes' : 'Create event notification' }));
      await waitFor(() => expect(engine.notificationReads).toHaveLength(3));
      expect(router.state.location.pathname).toBe(editing ? NOTIFICATION_EDIT : NOTIFICATION_CREATE);
      expect(screen.queryByText('Event notification saved')).toBeNull();
      engine.parts.notification = () => notifications.answer;
      engine.parts.versioning = () => versioning.answer;
      verify.release(ok(saved));
      expect(await screen.findByText('Event notification saved')).toBeVisible();
      expect(router.state.location.pathname).toBe(PROPERTIES);
      await waitFor(() => expect(engine.reads('versioning')).toHaveLength(1));
      const releaseNotifications = async () => {
        notifications.release(ok(saved));
        expect(await screen.findByRole('link', { name: editing ? 'Edit to-queue' : 'Edit new' })).toBeVisible();
      };
      const releaseVersioning = async () => {
        versioning.release(FULL.versioning() as Answer);
        await waitFor(() => expect(field('Bucket Versioning', 'Bucket Versioning')).toBe('Enabled'));
      };
      if (order === 'notifications first') {
        await releaseNotifications();
        await releaseVersioning();
      } else {
        await releaseVersioning();
        await releaseNotifications();
      }
      expect(screen.getAllByText('Event notification saved')).toHaveLength(1);
    });
  });

  it.each(['verification first', 'other sections first'])(
    'confirms deletion once with %s even when a section goes missing',
    async (order) => {
      await openBucket({ notification: () => notificationDocument(queueRule('to-queue')) });
      const verify = held();
      const versioning = held();
      engine.writeNotifications = () => {
        engine.parts.notification = () => verify.answer;
        return { status: 204, body: '' };
      };
      confirmDelete(await startDelete());
      await waitFor(() => expect(engine.notificationReads).toHaveLength(3));
      engine.parts.versioning = () => versioning.answer;
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(engine.reads('versioning')).toHaveLength(2));
      engine.parts.notification = () => notificationDocument();
      const releaseVersioning = async () => {
        versioning.release(errorAnswer(404, 'NoSuchBucket', 'Bucket missing'));
        expect(await screen.findByText('Bucket not found')).toBeVisible();
      };
      if (order === 'other sections first') {
        await releaseVersioning();
        expect(screen.queryByText('Event notification deleted')).toBeNull();
      }
      verify.release(notificationDocument());
      expect(await screen.findByText('Event notification deleted')).toBeVisible();
      if (order === 'verification first') await releaseVersioning();
      expect(screen.queryByRole('dialog', { name: 'Delete event notification' })).toBeNull();
      expect(screen.getAllByText('Event notification deleted')).toHaveLength(1);
      expect(engine.notificationWrites).toHaveLength(1);
      expect(engine.notificationWrites[0]).not.toContain('<QueueConfiguration');
    },
  );

  it('refuses to replace the configuration when the fresh read fails, with read recovery', async () => {
    await openBucket({ notification: () => notificationDocument(queueRule('to-queue')) });
    const dialog = await startDelete();
    const preWrite = held();
    engine.parts.notification = () => preWrite.answer;
    confirmDelete(dialog);
    expect(within(section('Event notifications')).getByText('Deleting event notification')).toBeVisible();
    preWrite.release(errorAnswer(400, 'InvalidRequest', 'Fresh read refused'));
    expect(await within(section('Event notifications')).findByText(/Fresh read refused/)).toBeVisible();
    expect(engine.notificationWrites).toEqual([]);
    expect(screen.getByRole('button', { name: 'Delete to-queue' })).toBeDisabled();
    engine.parts.notification = () => notificationDocument(queueRule('to-queue'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Delete to-queue' })).toBeEnabled();
  });

  it.each([
    [403, 'AccessDenied', 'You may not delete this notification', false],
    [501, 'NotImplemented', 'PutBucketNotificationConfiguration', true],
  ])('shows a failed delete status %s and preserves the action', async (status, code, detail, disabled) => {
    await openBucket({ notification: () => notificationDocument(queueRule('to-queue')) });
    engine.writeNotifications = () => errorAnswer(status, code, detail);
    confirmDelete(await startDelete());
    expect(await screen.findByText(new RegExp(detail))).toBeVisible();
    expect(screen.queryByText('Event notification deleted')).toBeNull();
    const button = screen.getByRole('button', { name: 'Delete to-queue' });
    if (disabled) {
      expect(button).toBeDisabled();
      expect(screen.getByText('Not implemented by the emulator')).toBeVisible();
    } else expect(button).toBeEnabled();
  });

  it.each(['failure', 'different configuration'])('only repeats the verification read after %s', async (mode) => {
    await openBucket({ notification: () => notificationDocument(queueRule('to-queue')) });
    engine.writeNotifications = () => {
      engine.parts.notification = () =>
        mode === 'failure'
          ? errorAnswer(400, 'InvalidRequest', 'Readback refused')
          : notificationDocument(queueRule('to-queue'));
      return { status: 204, body: '' };
    };
    confirmDelete(await startDelete());
    const retry = await screen.findByRole('button', { name: 'Check again' });
    expect(screen.queryByText('Event notification deleted')).toBeNull();
    if (mode === 'failure') expect(screen.getByText(/Readback refused/)).toBeVisible();
    else {
      expect(screen.getByText('The saved configuration differs from the requested change.')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Observed event notifications' })).toBeVisible();
    }
    const reads = engine.notificationReads.length;
    engine.parts.notification = () => notificationDocument();
    fireEvent.click(retry);
    expect(await screen.findByText('Event notification deleted')).toBeVisible();
    expect(engine.notificationReads.length).toBeGreaterThan(reads);
    expect(engine.notificationWrites).toHaveLength(1);
  });

  describe.each(['leave', 'switch target'])('while deleting, %s', (cause) => {
    it.each(['pre-write read', 'verification success', 'verification failure'])('abandons a held %s', async (step) => {
      connection.set({ ...connectedResult(), target: 'first' });
      const original = notificationDocument(queueRule('to-queue'));
      const { router } = await openBucket({ notification: () => original });
      const pending = held();
      if (step === 'pre-write read') engine.parts.notification = () => pending.answer;
      else {
        engine.writeNotifications = () => {
          engine.parts.notification = () => pending.answer;
          return { status: 204, body: '' };
        };
      }
      confirmDelete(await startDelete());
      await waitFor(() => expect(engine.notificationReads).toHaveLength(step === 'pre-write read' ? 2 : 3));
      const request = engine.notificationReads.at(-1);
      engine.parts.notification = () => original;
      if (cause === 'leave') await act(() => router.navigate('/'));
      else {
        connection.set({ ...connectedResult(), target: 'second' });
        expect(await screen.findByRole('button', { name: 'Delete to-queue' })).toBeEnabled();
      }
      expect(request?.signal.aborted).toBe(true);
      const reads = engine.notificationReads.length;
      await act(async () => {
        pending.release(
          step === 'verification failure' ? errorAnswer(400, 'InvalidRequest', 'Late failure') : notificationDocument(),
        );
        await pending.answer;
      });
      expect(engine.notificationReads).toHaveLength(reads);
      expect(engine.notificationWrites).toHaveLength(step === 'pre-write read' ? 0 : 1);
      expect(screen.queryByText('Event notification deleted')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
      expect(router.state.location.pathname).toBe(cause === 'leave' ? '/' : PROPERTIES);
    });
  });
});
