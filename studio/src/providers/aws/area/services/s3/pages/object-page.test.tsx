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

// An object's page rendered inside the area's layout, as Studio's frame renders the area, against a fake engine behind
// the page's `fetch` (test-criteria.md, issue 480, "Unit s2 — services/s3/pages/object-page.test.tsx").

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  body?: string | Uint8Array | null;
  headers?: Record<string, string>;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ok = (body: string): Answer => ({ status: 200, body: `<?xml version="1.0" encoding="UTF-8"?>${body}` });

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${xml(code)}</Code><Message>${xml(message)}</Message></Error>`,
  };
}

/** An object the emulator holds. */
interface FakeObject {
  key: string;
  body: Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
  tags?: [string, string][];
  cacheControl?: string;
}

/** One request as the engine saw it. */
interface Seen {
  method: string;
  url: URL;
  range: string | null;
  body: string;
}

const LAST_MODIFIED = 'Wed, 18 Nov 2026 10:00:00 GMT';

class FakeEngine {
  buckets = ['alpha'];
  objects: FakeObject[] = [];
  readonly seen: Seen[] = [];
  /** A case's own answers, tried before the emulator's. */
  head: ((key: string) => EngineAnswer | undefined) | undefined;
  tagging: ((key: string) => EngineAnswer | undefined) | undefined;
  get: ((key: string, range: string | null) => EngineAnswer | undefined) | undefined;

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'token-1' }), { status: 200 });
    }
    const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    this.seen.push({ method: request.method, url, range: request.headers.get('range'), body });
    const answer = await Promise.race([
      Promise.resolve(this.answer(request.method, url, request.headers.get('range'), body)),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(request.method === 'HEAD' ? null : ((answer.body ?? null) as BodyInit | null), {
      status: answer.status,
      headers: answer.headers ?? {},
    });
  };

  private object(key: string): FakeObject | undefined {
    return this.objects.find((object) => object.key === key);
  }

  private headers(object: FakeObject): Record<string, string> {
    return {
      'content-type': object.contentType ?? 'binary/octet-stream',
      'content-length': String(object.body.length),
      etag: '"0123456789abcdef0123456789abcdef"',
      'last-modified': LAST_MODIFIED,
      ...(object.cacheControl === undefined ? {} : { 'cache-control': object.cacheControl }),
      ...Object.fromEntries(Object.entries(object.metadata ?? {}).map(([k, v]) => [`x-amz-meta-${k}`, v])),
    };
  }

  private answer(method: string, url: URL, range: string | null, body: string): EngineAnswer {
    if (url.pathname === '/' && url.searchParams.get('x-id') === 'ListBuckets') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const names = this.buckets.filter((name) => name.startsWith(prefix)).slice(0, 1);
      return ok(
        `<ListAllMyBucketsResult><Buckets>${names
          .map((name) => `<Bucket><Name>${xml(name)}</Name><BucketRegion>us-east-1</BucketRegion></Bucket>`)
          .join('')}</Buckets></ListAllMyBucketsResult>`,
      );
    }
    const [, bucket = '', ...rest] = url.pathname.split('/');
    const key = rest.map((part) => decodeURIComponent(part)).join('/');
    const known = this.buckets.includes(bucket);
    if (url.searchParams.has('versioning')) {
      return ok('<VersioningConfiguration/>');
    }
    if (method === 'POST' && url.searchParams.has('delete')) {
      if (!known) return errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
      const keys = [...body.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => match[1] ?? '');
      this.objects = this.objects.filter((object) => !keys.includes(object.key));
      return ok(
        `<DeleteResult>${keys.map((deleted) => `<Deleted><Key>${deleted}</Key></Deleted>`).join('')}</DeleteResult>`,
      );
    }
    if (url.searchParams.has('tagging')) {
      const own = this.tagging?.(key);
      if (own !== undefined) return own;
      const object = this.object(key);
      if (!known) return errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
      if (object === undefined) return errorAnswer(404, 'NoSuchKey', 'The specified key does not exist.');
      return ok(
        `<Tagging><TagSet>${(object.tags ?? [])
          .map(([k, v]) => `<Tag><Key>${xml(k)}</Key><Value>${xml(v)}</Value></Tag>`)
          .join('')}</TagSet></Tagging>`,
      );
    }
    if (method === 'HEAD') {
      const own = this.head?.(key);
      if (own !== undefined) return own;
      const object = known ? this.object(key) : undefined;
      return object === undefined ? { status: 404 } : { status: 200, headers: this.headers(object) };
    }
    if (method === 'GET') {
      const own = this.get?.(key, range);
      if (own !== undefined) return own;
      const object = known ? this.object(key) : undefined;
      if (object === undefined) return errorAnswer(404, 'NoSuchKey', 'The specified key does not exist.');
      const match = range === null ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
      if (match === null) {
        return { status: 200, body: object.body, headers: this.headers(object) };
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), object.body.length - 1);
      const part = object.body.slice(start, end + 1);
      return {
        status: 206,
        body: part,
        headers: {
          ...this.headers(object),
          'content-length': String(part.length),
          'content-range': `bytes ${String(start)}-${String(end)}/${String(object.body.length)}`,
        },
      };
    }
    return errorAnswer(400, 'InvalidRequest', `not in this fake: ${method} ${url.href}`);
  }

  requests(method: string, test: (seen: Seen) => boolean = () => true): Seen[] {
    return this.seen.filter((seen) => seen.method === method && test(seen));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

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

function connectedResult(): CheckResult {
  return {
    kind: 'connected',
    checkedAt: Date.now(),
    emulator: { port: EMULATOR_PORT, endpoint: `https://127.0.0.1:${String(EMULATOR_PORT)}` },
  };
}

let nextPort = 9400;
let engine: FakeEngine;
let connection: Connection;

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
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: engineEndpoint(nextPort) };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const encoder = new TextEncoder();

function objectAddress(key: string, bucket = 'alpha'): string {
  return `/aws/s3/buckets/${bucket}/object?${new URLSearchParams({ key }).toString()}`;
}

function open(key: string, bucket = 'alpha') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [objectAddress(key, bucket)] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const APP_JSON: FakeObject = {
  key: 'cfg/app.json',
  body: encoder.encode('{"name":"app","debug":true}'),
  contentType: 'application/json',
  metadata: { owner: 'ci' },
  tags: [['env', 'dev']],
  cacheControl: 'no-cache',
};

function h1(): HTMLElement {
  return screen.getByRole('heading', { level: 1 });
}

/** The section headed `title`: a container or a table, its h2 starting with the title. */
function section(title: string): HTMLElement {
  const wrapper = createWrapper(document.body);
  const heads = (element: HTMLElement) =>
    [...element.querySelectorAll('h2')].some((h2) => (h2.textContent ?? '').trim().startsWith(title));
  const table = wrapper.findAllTables().find((found) => heads(found.getElement()));
  if (table !== undefined) return table.getElement();
  const container = wrapper.findAllContainers().find((found) => {
    const header = found.findHeader();
    return header !== null && heads(header.getElement());
  });
  if (container === undefined) throw new Error(`No section ${title}`);
  return container.getElement();
}

/** The value beside the label `label` of the overview. */
function overviewValue(label: string): string {
  const pairs = createWrapper(section('Object overview')).findKeyValuePairs();
  const item = pairs?.findItems().find((found) => found.findLabel()?.getElement().textContent === label);
  return (item?.findValue()?.getElement().textContent ?? '').trim();
}

/** The rows of the table headed `title`, each its cells' texts. */
function tableRows(title: string): string[][] {
  return [...section(title).querySelectorAll('tbody tr')]
    .map((row) => [...row.querySelectorAll('td, th')].map((cell) => (cell.textContent ?? '').trim()))
    .filter((cells) => cells.length > 1);
}

function isGetObject(seen: Seen): boolean {
  return seen.url.searchParams.get('x-id') === 'GetObject';
}

/** Matches the element whose whole text is `text`, and none of its children alone. */
function byWholeText(text: string | RegExp) {
  const matches = (value: string) => (typeof text === 'string' ? value === text : text.test(value));
  return (_: string, element: Element | null): boolean =>
    element !== null &&
    matches(element.textContent ?? '') &&
    [...element.children].every((child) => !matches(child.textContent ?? ''));
}

/** The page's own element whose whole text is `text`, outside the live regions. */
function onPage(text: string | RegExp): HTMLElement {
  const found = screen.getAllByText(byWholeText(text)).filter((element) => element.closest('[aria-live]') === null);
  expect(found).toHaveLength(1);
  return found[0] as HTMLElement;
}

async function findOnPage(text: string | RegExp): Promise<HTMLElement> {
  let element: HTMLElement | undefined;
  await waitFor(() => {
    element = onPage(text);
  });
  return element as HTMLElement;
}

/** Whether `element` is inside the disabled reason of a button. */
function reasonsHold(element: Element): boolean {
  return screen
    .getAllByRole('button')
    .flatMap((button) => (button.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== ''))
    .some((id) => document.getElementById(id)?.contains(element) === true);
}

/** The address of the page's link whose text is `text`. */
function linkTo(text: string): string | null {
  const links = screen.getAllByRole('link').filter((link) => link.textContent === text);
  expect(links).toHaveLength(1);
  return links[0]?.getAttribute('href') ?? null;
}

function action(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

/** A disabled button's reason, as Cloudscape names it to assistive technology. */
function disabledReason(element: HTMLElement): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

function crumbLinks(): [string, string | null][] {
  return (createWrapper(document.body).findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((item) => {
    const element = item.getElement();
    const link = element.closest('a[href]') ?? element.querySelector('a[href]');
    return [(element.textContent ?? '').trim(), link?.getAttribute('href') ?? null];
  });
}

async function shown() {
  await screen.findByRole('heading', { level: 2, name: 'Object overview' });
}

// ---------------------------------------------------------------------------------------------------------------
// Cases.
// ---------------------------------------------------------------------------------------------------------------

describe('the object page, what HeadObject and GetObjectTagging report', () => {
  it('the overview values, the system and user metadata, and the tags', async () => {
    engine.objects = [APP_JSON];
    open('cfg/app.json');
    await shown();

    expect(overviewValue('Key')).toBe('cfg/app.json');
    expect(overviewValue('S3 URI')).toBe('s3://alpha/cfg/app.json');
    expect(overviewValue('ARN')).toBe('arn:aws:s3:::alpha/cfg/app.json');
    expect(overviewValue('Size')).toBe('27 bytes');
    expect(overviewValue('Content type')).toBe('application/json');
    expect(overviewValue('Last modified')).toMatch(/^November 18, 2026, \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
    expect(overviewValue('ETag')).toBe('"0123456789abcdef0123456789abcdef"');
    expect(overviewValue('Storage class')).toBe('STANDARD');
    for (const label of ['Key', 'S3 URI', 'ARN']) {
      expect(within(section('Object overview')).getByRole('button', { name: `Copy ${label}` })).toBeInTheDocument();
    }

    expect(tableRows('System-defined metadata')).toEqual([
      ['Content-Type', 'application/json'],
      ['Cache-Control', 'no-cache'],
    ]);
    expect(tableRows('User-defined metadata')).toEqual([['owner', 'ci']]);
    await waitFor(() => {
      expect(tableRows('Tags')).toEqual([['env', 'dev']]);
    });
    await waitFor(() => {
      expect(within(section('Preview')).getByRole('region', { name: 'Object preview' })).toHaveTextContent(
        '{"name":"app","debug":true}',
      );
    });
  });

  it('a size of 1024 bytes or more shows the exact count and the short form', async () => {
    engine.objects = [{ key: 'big.log', body: new Uint8Array(204_800).fill(0x61), contentType: 'text/plain' }];
    open('big.log');
    await shown();
    expect(overviewValue('Size')).toBe('204,800 bytes (200.0 KiB)');
    await waitFor(() => {
      expect(within(section('Preview')).getByText('Showing the first 64 KiB of 200.0 KiB.')).toBeInTheDocument();
    });
    const range = engine.requests('GET', (seen) => seen.range !== null);
    expect(range.map((seen) => seen.range)).toEqual(['bytes=0-65535']);
  });

  it('an object without metadata of a kind, or without tags, says so', async () => {
    engine.objects = [{ key: 'plain.bin', body: new Uint8Array([1, 2]), contentType: 'application/octet-stream' }];
    open('plain.bin');
    await shown();
    expect(within(section('User-defined metadata')).getByText('No metadata of this kind.')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(section('Tags')).getByText('This object has no tags.')).toBeInTheDocument();
    });
    expect(
      within(section('Preview')).getByText('No preview for this type. Download the object to open it.'),
    ).toBeInTheDocument();
    expect(engine.requests('GET', (seen) => seen.range !== null)).toHaveLength(0);
  });

  it("a section's own failure leaves the others shown: tags fail, the overview and the preview stand", async () => {
    engine.objects = [APP_JSON];
    engine.tagging = () => errorAnswer(400, 'InvalidRequest', 'tagging broke');
    open('cfg/app.json');
    await shown();

    await waitFor(() => {
      expect(within(section('Tags')).getByText(/tagging broke/)).toBeInTheDocument();
    });
    expect(within(section('Tags')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(overviewValue('Key')).toBe('cfg/app.json');
    await waitFor(() => {
      expect(within(section('Preview')).getByRole('region', { name: 'Object preview' })).toBeInTheDocument();
    });
  });

  it('the preview failing leaves the overview, the metadata and the tags shown', async () => {
    engine.objects = [APP_JSON];
    engine.get = () => errorAnswer(400, 'InvalidRequest', 'get broke');
    open('cfg/app.json');
    await shown();
    await waitFor(() => {
      expect(within(section('Preview')).getByText(/get broke/)).toBeInTheDocument();
    });
    expect(tableRows('User-defined metadata')).toEqual([['owner', 'ci']]);
    await waitFor(() => {
      expect(tableRows('Tags')).toEqual([['env', 'dev']]);
    });
  });
});

describe('the object page, when the object or the bucket is gone', () => {
  it('HeadObject not found and ListBuckets listing the bucket → "No object" with "Go to alpha"', async () => {
    open('x.txt');
    await findOnPage('No object x.txt');
    onPage('Bucket alpha in the local emulator holds no object with this key.');
    expect(linkTo('Go to alpha')).toBe('/aws/s3/buckets/alpha');
    expect(engine.requests('GET', (seen) => seen.url.searchParams.get('x-id') === 'ListBuckets')).toHaveLength(1);
  });

  it('HeadObject not found and ListBuckets not listing the bucket → "No bucket"', async () => {
    engine.buckets = [];
    open('x.txt');
    await findOnPage('No bucket alpha');
    expect(screen.getByText('The local emulator holds no bucket of this name.')).toBeInTheDocument();
    expect(linkTo('Go to Buckets')).toBe('/aws/s3/buckets');
  });

  it('a 501 of HeadObject names it and shows the actions unavailable', async () => {
    engine.head = () => ({ status: 501 });
    open('x.txt');
    // The state's line, besides the reasons the two actions give.
    await waitFor(() => {
      expect(
        screen
          .getAllByText(byWholeText('Not implemented by the emulator: HeadObject'))
          .some((element) => !reasonsHold(element)),
      ).toBe(true);
    });
    expect(isDisabled(action('Download'))).toBe(true);
    expect(disabledReason(action('Download'))).toContain('Not implemented by the emulator: HeadObject');
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(disabledReason(action('Delete'))).toContain('Not implemented by the emulator: HeadObject');
  });

  it('a 501 of GetObjectTagging names it in "Tags"; the rest stands', async () => {
    engine.objects = [APP_JSON];
    engine.tagging = () => errorAnswer(501, 'NotImplemented', 'not here');
    open('cfg/app.json');
    await shown();
    await waitFor(() => {
      expect(within(section('Tags')).getByText('GetObjectTagging')).toBeInTheDocument();
    });
    expect(within(section('Tags')).getByText('Not implemented by the emulator')).toBeInTheDocument();
    expect(isDisabled(action('Download'))).toBe(false);
  });

  it('a 501 of GetObject names it in "Preview" and shows "Download" unavailable', async () => {
    engine.objects = [APP_JSON];
    engine.get = () => ({ status: 501 });
    open('cfg/app.json');
    await shown();
    await waitFor(() => {
      expect(within(section('Preview')).getByText('GetObject')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(isDisabled(action('Download'))).toBe(true);
    });
    expect(disabledReason(action('Download'))).toContain('Not implemented by the emulator: GetObject');
  });

  it('a HeadObject failure without a code → the generic failure with its HTTP status and "Retry"', async () => {
    engine.objects = [APP_JSON];
    let fail = true;
    engine.head = () => (fail ? { status: 503 } : undefined);
    open('cfg/app.json');
    await findOnPage('The object could not be read');
    onPage(/^HTTP 503/);

    fail = false;
    const before = engine.requests('HEAD').length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await shown();
    expect(engine.requests('HEAD').length).toBeGreaterThan(before);
  });
});

describe('the object page, its frame', () => {
  it('the notice reads "These objects are in your local emulator"', async () => {
    engine.objects = [APP_JSON];
    open('cfg/app.json');
    await shown();
    expect(screen.getByText('These objects are in your local emulator')).toBeInTheDocument();
  });

  it('crumbs: Buckets, the bucket, each prefix part to its prefix, the last part not a link; h1 the last part', async () => {
    engine.objects = [{ ...APP_JSON, key: 'logs/2026/x.json' }];
    open('logs/2026/x.json');
    await shown();
    const crumbs = crumbLinks();
    expect(crumbs.slice(-5)).toEqual([
      ['Buckets', '/aws/s3/buckets'],
      ['alpha', '/aws/s3/buckets/alpha'],
      ['logs', '/aws/s3/buckets/alpha?prefix=logs%2F'],
      ['2026', '/aws/s3/buckets/alpha?prefix=logs%2F2026%2F'],
      ['x.json', null],
    ]);
    expect(h1()).toHaveTextContent(/^x\.json$/);
  });

  it('a key ending in "/": the h1 is the whole key, and "Download" is unavailable with "This key names a folder."', async () => {
    engine.objects = [{ key: 'a/b/', body: new Uint8Array(), contentType: 'application/x-directory' }];
    open('a/b/');
    await shown();
    expect(h1()).toHaveTextContent(/^a\/b\/$/);
    expect(crumbLinks().slice(-3)).toEqual([
      ['alpha', '/aws/s3/buckets/alpha'],
      ['a', '/aws/s3/buckets/alpha?prefix=a%2F'],
      ['a/b/', null],
    ]);
    expect(isDisabled(action('Download'))).toBe(true);
    expect(disabledReason(action('Download'))).toContain('This key names a folder.');
  });
});

describe('the object page, "Download"', () => {
  it('asks the whole body, saves a blob: file under the last part, and revokes the URL', async () => {
    engine.objects = [APP_JSON];
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, {}));
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:http://studio/1';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });
    open('cfg/app.json');
    await shown();

    fireEvent.click(action('Download'));
    await waitFor(() => {
      expect(clicks).toEqual([{ href: 'blob:http://studio/1', download: 'app.json' }]);
    });
    expect(create).toHaveBeenCalledTimes(1);
    const whole = engine.requests('GET', (seen) => isGetObject(seen) && seen.range === null);
    expect(whole).toHaveLength(1);
    expect([...new Uint8Array(await (blobs[0] as Blob).arrayBuffer())]).toEqual([...APP_JSON.body]);
    expect((blobs[0] as Blob).type).toBe('application/json');
    await waitFor(() => {
      expect(revoke).toHaveBeenCalledWith('blob:http://studio/1');
    });
  });

  it('is unavailable while in progress, keeps focus, and shows a failure with its message', async () => {
    engine.objects = [APP_JSON];
    let answer: (value: Answer) => void = () => undefined;
    engine.get = (_key, range) =>
      range === null
        ? new Promise<Answer>((resolve) => {
            answer = resolve;
          })
        : undefined;
    open('cfg/app.json');
    await shown();

    const button = action('Download');
    act(() => {
      button.focus();
    });
    fireEvent.click(button);
    await waitFor(() => {
      expect(isDisabled(action('Download'))).toBe(true);
    });
    expect(document.activeElement).toBe(action('Download'));
    fireEvent.click(action('Download'));
    expect(engine.requests('GET', (seen) => isGetObject(seen) && seen.range === null)).toHaveLength(1);

    act(() => {
      // A code the SDK does not send again.
      answer(errorAnswer(400, 'InvalidRequest', 'download broke'));
    });
    await waitFor(() => {
      expect(screen.getByText(/download broke/)).toBeInTheDocument();
    });
    expect(screen.getByText('Downloading the object failed')).toBeInTheDocument();
    expect(isDisabled(action('Download'))).toBe(false);
  });
});

describe('the object page, "Delete"', () => {
  it("opens the dialog for the key; after a delete the address is the Objects tab at the key's prefix", async () => {
    engine.objects = [APP_JSON];
    const router = open('cfg/app.json');
    await shown();

    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(byWholeText('Delete cfg/app.json?'))).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        '/aws/s3/buckets/alpha?prefix=cfg%2F',
      );
    });
    expect(engine.requests('POST')).toHaveLength(1);
    expect(engine.requests('POST')[0]?.body).toContain('<Key>cfg/app.json</Key>');
    expect(await screen.findByText('Deleted 1 object.')).toBeInTheDocument();
  });
});
