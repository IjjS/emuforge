import createWrapper, { type FormFieldWrapper, type ModalWrapper } from '@cloudscape-design/components/test-utils/dom';
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
  bucket?: string;
  key: string;
  body: Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
  tags?: [string, string][];
  cacheControl?: string;
  redirect?: string;
}

/** One request as the engine saw it. */
interface Seen {
  method: string;
  url: URL;
  range: string | null;
  body: string;
  signal: AbortSignal;
  headers: Headers;
}

const LAST_MODIFIED = 'Wed, 18 Nov 2026 10:00:00 GMT';

class FakeEngine {
  buckets = ['alpha'];
  objects: FakeObject[] = [];
  readonly seen: Seen[] = [];
  /** A case's own answers, tried before the emulator's. */
  beforeCopy: (() => Answer | undefined | Promise<Answer | undefined>) | undefined;
  remove: ((key: string) => Answer | undefined) | undefined;
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
    this.seen.push({
      method: request.method,
      url,
      range: request.headers.get('range'),
      body,
      signal: request.signal,
      headers: request.headers,
    });
    const answer = await Promise.race([
      Promise.resolve(this.answer(request.method, url, request.headers, body)),
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

  private object(bucket: string, key: string): FakeObject | undefined {
    return this.objects.find((object) => (object.bucket ?? 'alpha') === bucket && object.key === key);
  }

  private headers(object: FakeObject): Record<string, string> {
    return {
      'content-type': object.contentType ?? 'binary/octet-stream',
      'content-length': String(object.body.length),
      etag: '"0123456789abcdef0123456789abcdef"',
      'last-modified': LAST_MODIFIED,
      ...(object.cacheControl === undefined ? {} : { 'cache-control': object.cacheControl }),
      ...(object.redirect === undefined ? {} : { 'x-amz-website-redirect-location': object.redirect }),
      ...Object.fromEntries(Object.entries(object.metadata ?? {}).map(([k, v]) => [`x-amz-meta-${k}`, v])),
    };
  }

  private async copy(bucket: string, key: string, headers: Headers): Promise<Answer> {
    const refusal = await this.beforeCopy?.();
    if (refusal !== undefined) return refusal;
    if (!this.buckets.includes(bucket)) return errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist.');
    const copySource = headers.get('x-amz-copy-source') ?? '';
    const [sourceBucket = '', ...sourceParts] = decodeURIComponent(copySource).split('/');
    const source = this.object(sourceBucket, sourceParts.join('/'));
    if (source === undefined) return errorAnswer(404, 'NoSuchKey', 'The specified key does not exist.');
    const existing = this.object(bucket, key);
    if (existing !== undefined && headers.get('if-none-match') === '*') {
      return errorAnswer(412, 'PreconditionFailed', 'At least one of the pre-conditions you specified did not hold');
    }
    const copy: FakeObject = { ...source, bucket, key };
    delete copy.redirect;
    if (headers.get('x-amz-metadata-directive') === 'REPLACE') {
      copy.contentType = headers.get('content-type') ?? '';
      copy.metadata = Object.fromEntries(
        [...headers.entries()]
          .filter(([name]) => name.startsWith('x-amz-meta-'))
          .map(([name, value]) => [name.slice('x-amz-meta-'.length), value]),
      );
      const redirect = headers.get('x-amz-website-redirect-location');
      if (redirect !== null) copy.redirect = redirect;
    }
    this.objects = [...this.objects.filter((object) => object !== existing), copy];
    return ok('<CopyObjectResult><ETag>"copied"</ETag></CopyObjectResult>');
  }

  private answer(method: string, url: URL, headers: Headers, body: string): EngineAnswer {
    const range = headers.get('range');
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
    if (method === 'PUT' && headers.has('x-amz-copy-source')) return this.copy(bucket, key, headers);
    if (method === 'DELETE') {
      const refusal = this.remove?.(key);
      if (refusal !== undefined) return refusal;
      this.objects = this.objects.filter((object) => object !== this.object(bucket, key));
      return { status: 204 };
    }
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
      const object = this.object(bucket, key);
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
      const object = known ? this.object(bucket, key) : undefined;
      return object === undefined ? { status: 404 } : { status: 200, headers: this.headers(object) };
    }
    if (method === 'GET') {
      const own = this.get?.(key, range);
      if (own !== undefined) return own;
      const object = known ? this.object(bucket, key) : undefined;
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

  generation = 0;

  switchTarget() {
    this.generation += 1;
    this.value = { ...this.value };
    for (const listener of this.listeners) listener();
  }
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
      targetGeneration={connection.generation}
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

function objectTable(title: string) {
  return createWrapper(document.body)
    .findAllTables()
    .find((table) => table.findHeaderSlot()?.getElement().textContent?.trim().startsWith(title));
}

/** The section headed `title`: a container or a table, its h2 starting with the title. */
function section(title: string): HTMLElement {
  const wrapper = createWrapper(document.body);
  const table = objectTable(title);
  if (table !== undefined) return table.getElement();
  const container = wrapper
    .findAllContainers()
    .find((found) => found.findHeader()?.getElement().textContent?.trim().startsWith(title));
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
  const table = objectTable(title);
  if (table === undefined) throw new Error(`No table ${title}`);
  return table.findRows().map((_, index) =>
    table.findColumnHeaders().map(
      (_, column) =>
        table
          .findBodyCell(index + 1, column + 1)
          ?.getElement()
          .textContent?.trim() ?? '',
    ),
  );
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
  it('the sections in order: Object overview, Preview, then the metadata and Tags', async () => {
    engine.objects = [APP_JSON];
    open('cfg/app.json');
    await shown();
    // The page's own sections: the side navigation's header ("Amazon S3") left out.
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .filter((heading) => heading.closest('nav') === null && heading.textContent !== 'Amazon S3')
      .map((heading) => (heading.textContent ?? '').replace(/\s*\(\d+\)$/, '').trim());
    expect(headings).toEqual([
      'Object overview',
      'Preview',
      'System-defined metadata',
      'User-defined metadata',
      'Tags',
    ]);
  });

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

const ORIGINAL_KEY = APP_JSON.key;
const DESTINATION_KEY = 'cfg/copy app.json';

function delayed<T>() {
  let finish!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

const ACTION_TITLES = { copy: 'Copy object', rename: 'Rename object', edit: 'Edit object properties' } as const;
const modal = () => createWrapper(document.body).findModal();

function actionsDropdown() {
  const dropdown = createWrapper(document.body)
    .findAllButtonDropdowns()
    .find((found) => found.findNativeButton().getElement().textContent?.trim() === 'Actions');
  if (dropdown === undefined) throw new Error('No object actions dropdown');
  return dropdown;
}

async function findDialog(title: string) {
  return waitFor(() => {
    const dialog = modal();
    if (dialog === null) throw new Error(`No dialog titled ${title}`);
    expect(dialog.findHeader().getElement()).toHaveTextContent(title);
    return dialog;
  });
}

async function changeDialog(id: keyof typeof ACTION_TITLES) {
  const dropdown = actionsDropdown();
  fireEvent.click(dropdown.findNativeButton().getElement());
  const item = dropdown.findItemById(id, { disabled: false });
  if (item === null) throw new Error(`No enabled action ${id}`);
  expect(item.getElement()).toHaveTextContent(ACTION_TITLES[id]);
  fireEvent.click(item.getElement());
  return findDialog(ACTION_TITLES[id]);
}

function dialogBody(dialog: ModalWrapper) {
  return dialog.findContent().getElement();
}

function formField(dialog: ModalWrapper, name: string) {
  const field = createWrapper(dialogBody(dialog))
    .findAllFormFields()
    .find((found) => found.findLabel()?.getElement().textContent?.trim() === name);
  if (field === undefined) throw new Error(`No form field ${name}`);
  return field;
}

function fieldInput(field: FormFieldWrapper) {
  const input = createWrapper(field.getElement()).findInput();
  if (input === null) throw new Error('No input for the field');
  return input.findNativeInput().getElement();
}

function changeInput(dialog: ModalWrapper, name: string, value: string) {
  fireEvent.change(fieldInput(formField(dialog, name)), { target: { value } });
}

function dialogButton(dialog: ModalWrapper, name: string) {
  const footer = dialog.findFooter();
  if (footer === null) throw new Error('No dialog footer');
  return within(footer.getElement()).getByRole('button', { name });
}

function metadataEditor(dialog: ModalWrapper) {
  const editor = createWrapper(dialogBody(dialog)).findAttributeEditor();
  if (editor === null) throw new Error('No user metadata editor');
  return editor;
}

function metadataField(dialog: ModalWrapper, row: number, column: number) {
  const field = metadataEditor(dialog).findRow(row)?.findField(column);
  if (field == null) throw new Error(`No metadata field at row ${row}, column ${column}`);
  return field;
}

async function renameConfirmation(occupied: boolean, destination = DESTINATION_KEY) {
  const form = await changeDialog('rename');
  changeInput(form, 'New key', destination);
  fireEvent.click(dialogButton(form, 'Rename object'));
  return findDialog(occupied ? 'Replace existing object?' : 'Rename object?');
}

function expectNoWrites() {
  expect(engine.requests('PUT')).toHaveLength(0);
  expect(engine.requests('DELETE')).toHaveLength(0);
}

function expectAddress(router: ReturnType<typeof open>, key: string, bucket = 'alpha') {
  expect(router.state.location.pathname + router.state.location.search).toBe(objectAddress(key, bucket));
}

function previewText() {
  return within(section('Preview')).getByRole('region', { name: 'Object preview' });
}

type FlashType = 'success' | 'warning' | 'info';

function flashes(type: FlashType) {
  return createWrapper(document.body).findFlashbar()?.findItemsByType(type) ?? [];
}

function flash(type: FlashType) {
  const [item] = flashes(type);
  if (item === undefined) throw new Error(`No ${type} flash item`);
  return item;
}

describe('changing an object from its detail', () => {
  beforeEach(() => {
    engine.objects = [APP_JSON];
  });

  it('offers all three actions for an empty regular object', async () => {
    engine.objects = [{ ...APP_JSON, body: new Uint8Array() }];
    open(ORIGINAL_KEY);
    await shown();
    for (const id of ['copy', 'rename', 'edit'] as const) {
      const dialog = await changeDialog(id);
      fireEvent.click(dialogButton(dialog, 'Cancel'));
      await waitFor(() => expect(modal()).toBeNull());
    }
    expectNoWrites();
  });

  it('opens a copied object under a new key in the same bucket', async () => {
    const router = open(ORIGINAL_KEY);
    await shown();
    const dialog = await changeDialog('copy');
    expect(fieldInput(formField(dialog, 'Destination bucket'))).toHaveValue('alpha');
    changeInput(dialog, 'Destination key', DESTINATION_KEY);
    fireEvent.click(dialogButton(dialog, 'Copy object'));

    await waitFor(() => expectAddress(router, DESTINATION_KEY));
    await waitFor(() => expect(previewText()).toHaveTextContent('"name":"app"'));
    expect(flash('success').findHeader()?.getElement()).toHaveTextContent('Object copied.');
    expect(engine.objects.map(({ key }) => key)).toEqual([ORIGINAL_KEY, DESTINATION_KEY]);
  });

  it.each([
    { id: 'copy', label: 'Copy object', field: 'Destination key' },
    { id: 'rename', label: 'Rename object', field: 'New key' },
  ] as const)('blocks $label with an empty key or the original location', async ({ id, label, field }) => {
    open(ORIGINAL_KEY);
    await shown();
    const dialog = await changeDialog(id);
    expect(dialogButton(dialog, label)).toBeDisabled();
    changeInput(dialog, field, ORIGINAL_KEY);
    expect(dialogButton(dialog, label)).toBeDisabled();
    expectNoWrites();
  });

  it.each([
    { id: 'copy', field: 'Destination key', alias: 'cfg/./app.json' },
    { id: 'rename', field: 'New key', alias: 'cfg/other/../app.json' },
  ] as const)('blocks a destination that would normalize to the original for $id', async ({ id, field, alias }) => {
    const router = open(ORIGINAL_KEY);
    await shown();
    const initialHeads = engine.requests('HEAD').length;
    const dialog = await changeDialog(id);
    changeInput(dialog, field, alias);
    expect(formField(dialog, field).findError()?.getElement()).toHaveTextContent(
      'Use a key without . or .. path segments.',
    );
    const submit = dialogButton(dialog, ACTION_TITLES[id]);
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(engine.requests('HEAD')).toHaveLength(initialHeads);
    expectNoWrites();
    expectAddress(router, ORIGINAL_KEY);
    expect(engine.objects).toEqual([APP_JSON]);
  });

  it('shows a bodyless destination HEAD refusal and does not write', async () => {
    engine.head = (key) => (key === DESTINATION_KEY ? { status: 403 } : undefined);
    open(ORIGINAL_KEY);
    await shown();
    const dialog = await changeDialog('copy');
    changeInput(dialog, 'Destination key', DESTINATION_KEY);
    fireEvent.click(dialogButton(dialog, 'Copy object'));
    expect(await within(dialogBody(dialog)).findByText(/HTTP 403/)).toBeInTheDocument();
    expectNoWrites();
  });

  it('requires the whole destination key for replacement and can cancel a copy without writing', async () => {
    engine.buckets.push('beta');
    engine.objects.push({ ...APP_JSON, bucket: 'beta', key: DESTINATION_KEY, body: encoder.encode('old') });
    open(ORIGINAL_KEY);
    await shown();
    const form = await changeDialog('copy');
    changeInput(form, 'Destination bucket', 'beta');
    changeInput(form, 'Destination key', DESTINATION_KEY);
    fireEvent.click(dialogButton(form, 'Copy object'));
    const dialog = await findDialog('Replace existing object?');
    expect(dialogBody(dialog)).toHaveTextContent(`s3://beta/${DESTINATION_KEY}`);
    const confirmation = fieldInput(formField(dialog, 'Enter destination key to confirm'));
    expect(confirmation).toHaveFocus();
    expect(confirmation).toHaveAccessibleDescription(/existing destination object will be replaced/);
    expect(confirmation).toHaveAccessibleDescription(/Expected key cfg\/copy app\.json/);
    expect(confirmation).not.toHaveAccessibleDescription(/Enter the exact key shown above/);
    changeInput(dialog, 'Enter destination key to confirm', `s3://beta/${DESTINATION_KEY}`);
    expect(dialogButton(dialog, 'Replace object')).toBeDisabled();
    expect(confirmation).toHaveAccessibleDescription(/Enter the exact key shown above/);
    changeInput(dialog, 'Enter destination key to confirm', DESTINATION_KEY);
    expect(dialogButton(dialog, 'Replace object')).toBeEnabled();
    fireEvent.click(dialogButton(dialog, 'Cancel'));
    expectNoWrites();
    expect(engine.objects.map(({ body }) => new TextDecoder().decode(body))).toEqual([
      '{"name":"app","debug":true}',
      'old',
    ]);
  });

  it.each([true, false])('warns about deletion and redirect loss before a rename (occupied: %s)', async (occupied) => {
    engine.objects = [{ ...APP_JSON, redirect: '/home' }];
    if (occupied) engine.objects.push({ ...APP_JSON, key: DESTINATION_KEY });
    open(ORIGINAL_KEY);
    await shown();
    const dialog = await renameConfirmation(occupied);
    expect(dialogBody(dialog)).toHaveTextContent(`s3://alpha/${ORIGINAL_KEY}`);
    expect(dialogBody(dialog)).toHaveTextContent(`s3://alpha/${DESTINATION_KEY}`);
    expect(dialogBody(dialog)).toHaveTextContent('The original key will be deleted');
    expect(dialogBody(dialog)).toHaveTextContent('The renamed object will lose its website redirect.');
    const input = occupied ? 'Enter destination key to confirm' : 'Enter original key to confirm';
    const submit = occupied ? 'Replace object' : 'Rename object';
    const confirmation = fieldInput(formField(dialog, input));
    expect(confirmation).toHaveFocus();
    expect(confirmation).toHaveAccessibleDescription(/original key will be deleted/);
    expect(confirmation).toHaveAccessibleDescription(/renamed object will lose its website redirect/);
    changeInput(dialog, input, occupied ? 'copy app.json' : 'app.json');
    expect(dialogButton(dialog, submit)).toBeDisabled();
    changeInput(dialog, input, occupied ? DESTINATION_KEY : ORIGINAL_KEY);
    expect(dialogButton(dialog, submit)).toBeEnabled();
    fireEvent.click(dialogButton(dialog, 'Cancel'));
    expectNoWrites();
  });

  it('replaces the destination before deleting the source and opens the copied body', async () => {
    engine.objects.push({ ...APP_JSON, key: DESTINATION_KEY, body: encoder.encode('old') });
    const copy = delayed<undefined>();
    engine.beforeCopy = () => copy.promise;
    const router = open(ORIGINAL_KEY);
    await shown();
    const dialog = await renameConfirmation(true);
    changeInput(dialog, 'Enter destination key to confirm', DESTINATION_KEY);
    fireEvent.click(dialogButton(dialog, 'Replace object'));
    await waitFor(() => expect(engine.requests('PUT')).toHaveLength(1));
    expect(engine.requests('PUT').map(({ url }) => decodeURIComponent(url.pathname))).toEqual([
      `/alpha/${DESTINATION_KEY}`,
    ]);
    expect(engine.requests('DELETE')).toHaveLength(0);
    await act(async () => copy.finish(undefined));

    await waitFor(() => expectAddress(router, DESTINATION_KEY));
    expect(engine.requests('DELETE').map(({ url }) => url.pathname)).toEqual([`/alpha/${ORIGINAL_KEY}`]);
    await waitFor(() => expect(previewText()).toHaveTextContent('"name":"app"'));
    expect(flash('success').findHeader()?.getElement()).toHaveTextContent('Object renamed.');
  });

  it('omits the redirect warning if the original has no redirect', async () => {
    open(ORIGINAL_KEY);
    await shown();
    const dialog = await renameConfirmation(false);
    expect(dialogBody(dialog)).not.toHaveTextContent('website redirect');
  });

  it.each(['copy', 'rename'] as const)(
    'requires replacement confirmation when a destination appears during %s',
    async (id) => {
      const competitor = { ...APP_JSON, key: DESTINATION_KEY, body: encoder.encode('another client') };
      const router = open(ORIGINAL_KEY);
      await shown();
      if (id === 'copy') {
        const form = await changeDialog('copy');
        changeInput(form, 'Destination key', DESTINATION_KEY);
        engine.beforeCopy = () => {
          engine.beforeCopy = undefined;
          engine.objects.push(competitor);
          return undefined;
        };
        fireEvent.click(dialogButton(form, 'Copy object'));
      } else {
        const confirmation = await renameConfirmation(false);
        engine.objects.push(competitor);
        changeInput(confirmation, 'Enter original key to confirm', ORIGINAL_KEY);
        fireEvent.click(dialogButton(confirmation, 'Rename object'));
      }

      const replacement = await findDialog('Replace existing object?');
      expect(dialogBody(replacement)).toHaveTextContent('PreconditionFailed');
      expect(engine.requests('PUT').map(({ headers }) => headers.get('if-none-match'))).toEqual(['*']);
      expect(engine.requests('DELETE')).toHaveLength(0);
      expect(engine.objects).toEqual([APP_JSON, competitor]);
      expectAddress(router, ORIGINAL_KEY);

      const field = fieldInput(formField(replacement, 'Enter destination key to confirm'));
      expect(field).toHaveFocus();
      expect(field).toHaveValue('');
      expect(dialogButton(replacement, 'Replace object')).toBeDisabled();
      changeInput(replacement, 'Enter destination key to confirm', DESTINATION_KEY);
      fireEvent.click(dialogButton(replacement, 'Replace object'));
      await waitFor(() => expectAddress(router, DESTINATION_KEY));
      expect(engine.requests('PUT').map(({ headers }) => headers.get('if-none-match'))).toEqual(['*', null]);
      expect(engine.requests('DELETE')).toHaveLength(id === 'copy' ? 0 : 1);
      await waitFor(() => expect(previewText()).toHaveTextContent('"name":"app"'));
    },
  );

  it.each([
    'Bucket alpha can hold at most 1000 objects.',
    'Bucket alpha can hold at most 67108864 bytes. Copy would use 67123368 bytes.',
  ])('shows the original limit rejection and keeps the source: %s', async (message) => {
    engine.beforeCopy = () => errorAnswer(400, 'ValidationException', message);
    open(ORIGINAL_KEY);
    await shown();
    const dialog = await renameConfirmation(false);
    changeInput(dialog, 'Enter original key to confirm', ORIGINAL_KEY);
    fireEvent.click(dialogButton(dialog, 'Rename object'));
    expect(await within(dialogBody(dialog)).findByText('ValidationException')).toBeInTheDocument();
    expect(dialogBody(dialog)).toHaveTextContent(message);
    expect(engine.requests('DELETE')).toHaveLength(0);
    expect(engine.objects.map(({ key }) => key)).toEqual([ORIGINAL_KEY]);
  });

  it.each([
    { status: 403, code: 'AccessDeniedException', message: 'This policy denies deleting the original.' },
    { status: 503, code: 'ServiceUnavailable', message: 'Deletion temporarily unavailable.' },
  ])('reports a $status deletion refusal once and leaves both objects', async ({ status, code, message }) => {
    engine.remove = () => errorAnswer(status, code, message);
    const router = open(ORIGINAL_KEY);
    await shown();
    const dialog = await renameConfirmation(false);
    changeInput(dialog, 'Enter original key to confirm', ORIGINAL_KEY);
    fireEvent.click(dialogButton(dialog, 'Rename object'));

    await waitFor(() => {
      const heading = flash('warning').findHeader()?.getElement();
      expect(heading).toHaveTextContent('Object copied, but the original could not be deleted.');
      expect(heading?.contains(document.activeElement)).toBe(true);
    });
    const content = flash('warning').findContent()?.getElement();
    expect(content).toHaveTextContent(code);
    expect(content).toHaveTextContent(message);
    expect(content).toHaveTextContent(`s3://alpha/${DESTINATION_KEY}`);
    expect(content).toHaveTextContent(`s3://alpha/${ORIGINAL_KEY}`);
    expectAddress(router, ORIGINAL_KEY);
    expect(engine.requests('DELETE').map(({ url }) => url.pathname)).toEqual([`/alpha/${ORIGINAL_KEY}`]);
    expect(engine.objects.map(({ key }) => key)).toEqual([ORIGINAL_KEY, DESTINATION_KEY]);
  });

  it('identifies a 501 and keeps the action visible but disabled', async () => {
    engine.beforeCopy = () => errorAnswer(501, 'NotImplemented', 'Copy is unavailable.');
    open(ORIGINAL_KEY);
    await shown();
    const dialog = await changeDialog('copy');
    changeInput(dialog, 'Destination key', DESTINATION_KEY);
    fireEvent.click(dialogButton(dialog, 'Copy object'));
    await waitFor(() =>
      expect(flash('info').findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
    );
    expect(flash('info').findContent()?.getElement()).toHaveTextContent(
      'The emulator answered 501 Not Implemented for CopyObject.',
    );

    const dropdown = actionsDropdown();
    fireEvent.click(dropdown.findNativeButton().getElement());
    const unavailable = dropdown.findItemById('copy', { disabled: true });
    if (unavailable === null) throw new Error('Expected an unavailable copy action');
    expect(unavailable.getElement()).toHaveTextContent('Copy object');
    fireEvent.click(unavailable.getElement());
    expect(modal()).toBeNull();
    expect(engine.requests('PUT')).toHaveLength(1);
  });

  it('prefills the property editor and saves added, changed and removed metadata rows', async () => {
    engine.objects = [{ ...APP_JSON, metadata: { owner: 'ci', remove: 'old' } }];
    const router = open(ORIGINAL_KEY);
    await shown();
    const dialog = await changeDialog('edit');
    expect(fieldInput(formField(dialog, 'Content type'))).toHaveValue('application/json');
    const originalValue = fieldInput(metadataField(dialog, 1, 2));
    expect(originalValue).toHaveValue('ci');
    expect(fieldInput(metadataField(dialog, 2, 2))).toHaveValue('old');
    fireEvent.change(originalValue, { target: { value: 'qa' } });
    const remove = metadataEditor(dialog).findRow(2)?.findRemoveButton();
    if (remove == null) throw new Error('Expected a remove control on the second metadata row');
    fireEvent.click(remove.getElement());
    fireEvent.click(metadataEditor(dialog).findAddButton().getElement());
    fireEvent.change(fieldInput(metadataField(dialog, 2, 1)), { target: { value: 'stage' } });
    fireEvent.change(fieldInput(metadataField(dialog, 2, 2)), { target: { value: 'test' } });
    changeInput(dialog, 'Content type', 'text/plain');
    fireEvent.click(dialogButton(dialog, 'Save changes'));

    await waitFor(() => expect(overviewValue('Content type')).toBe('text/plain'));
    expect(tableRows('User-defined metadata')).toEqual([
      ['owner', 'qa'],
      ['stage', 'test'],
    ]);
    expectAddress(router, ORIGINAL_KEY);
    expect(flash('success').findContent()?.getElement()).toHaveTextContent('Object properties updated.');
  });

  it('sends only one write when Save changes is clicked repeatedly', async () => {
    const copy = delayed<undefined>();
    engine.beforeCopy = () => copy.promise;
    open(ORIGINAL_KEY);
    await shown();
    const dialog = await changeDialog('edit');
    changeInput(dialog, 'Content type', 'text/plain');
    const save = dialogButton(dialog, 'Save changes');
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(engine.requests('PUT')).toHaveLength(1));
    await act(async () => copy.finish(undefined));
    await waitFor(() =>
      expect(flash('success').findContent()?.getElement()).toHaveTextContent('Object properties updated.'),
    );
    expect(engine.requests('PUT')).toHaveLength(1);
  });

  it('marks both metadata keys that would produce the same header and blocks the save', async () => {
    open(ORIGINAL_KEY);
    await shown();
    const dialog = await changeDialog('edit');
    const save = dialogButton(dialog, 'Save changes');
    fireEvent.click(metadataEditor(dialog).findAddButton().getElement());
    const original = fieldInput(metadataField(dialog, 1, 1));
    const added = fieldInput(metadataField(dialog, 2, 1));

    for (const key of ['owner', 'OWNER']) {
      fireEvent.change(added, { target: { value: key } });
      expect(original).toHaveAccessibleDescription('Use a different metadata key.');
      expect(added).toHaveAccessibleDescription('Use a different metadata key.');
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expectNoWrites();
    }

    fireEvent.change(added, { target: { value: 'stage' } });
    expect(original).not.toHaveAccessibleDescription(/Use a different metadata key/);
    expect(added).not.toHaveAccessibleDescription(/Use a different metadata key/);
    expect(save).toBeEnabled();
  });

  it('keeps an edit refusal in the dialog without a success result', async () => {
    engine.beforeCopy = () => errorAnswer(404, 'NoSuchKey', 'The specified key does not exist.');
    open(ORIGINAL_KEY);
    await shown();
    const trigger = action('Actions');
    trigger.focus();
    const dialog = await changeDialog('edit');
    changeInput(dialog, 'Content type', 'text/plain');
    fireEvent.click(dialogButton(dialog, 'Save changes'));
    expect(await within(dialogBody(dialog)).findByText('NoSuchKey')).toBeInTheDocument();
    expect(dialogBody(dialog)).toHaveTextContent('The specified key does not exist.');
    expect(dialogBody(dialog).contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toHaveTextContent('The specified key does not exist.');
    expect(fieldInput(formField(dialog, 'Content type'))).toHaveValue('text/plain');
    expect(flashes('success')).toHaveLength(0);
    fireEvent.keyDown(document.activeElement ?? dialogBody(dialog), { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(modal()).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('aborts an old target rename and suppresses its delete, readback, navigation and flash', async () => {
    const copy = delayed<Answer>();
    engine.beforeCopy = () => copy.promise;
    const router = open(ORIGINAL_KEY);
    await shown();
    const dialog = await renameConfirmation(false);
    changeInput(dialog, 'Enter original key to confirm', ORIGINAL_KEY);
    fireEvent.click(dialogButton(dialog, 'Rename object'));
    await waitFor(() => expect(engine.requests('PUT')).toHaveLength(1));
    const [write] = engine.requests('PUT');
    if (write === undefined) throw new Error('Expected a copy request');

    await act(async () => connection.switchTarget());
    expect(write.signal.aborted).toBe(true);
    await waitFor(() => expect(previewText()).toHaveTextContent('"name":"app"'));
    const observed = engine.seen.length;
    await act(async () => copy.finish(ok('<CopyObjectResult><ETag>"old-target"</ETag></CopyObjectResult>')));

    expect(engine.seen).toHaveLength(observed);
    expect(engine.requests('DELETE')).toHaveLength(0);
    expectAddress(router, ORIGINAL_KEY);
    expect(flashes('success')).toHaveLength(0);
  });

  it.each(['tags', 'preview'])('keeps the cross-bucket copy result when %s returns first', async (first) => {
    engine.buckets.push('beta');
    const tags = delayed<Answer>();
    const preview = delayed<Answer>();
    engine.tagging = (key) => (key === DESTINATION_KEY ? tags.promise : undefined);
    engine.get = (key) => (key === DESTINATION_KEY ? preview.promise : undefined);
    const router = open(ORIGINAL_KEY);
    await shown();
    const dialog = await changeDialog('copy');
    changeInput(dialog, 'Destination bucket', 'beta');
    changeInput(dialog, 'Destination key', DESTINATION_KEY);
    fireEvent.click(dialogButton(dialog, 'Copy object'));
    await waitFor(() => expectAddress(router, DESTINATION_KEY, 'beta'));
    await waitFor(() => expect(overviewValue('Content type')).toBe('application/json'));

    const finishTags = async () => {
      await act(async () =>
        tags.finish(ok('<Tagging><TagSet><Tag><Key>phase</Key><Value>copy</Value></Tag></TagSet></Tagging>')),
      );
      await waitFor(() => expect(within(section('Tags')).getByText('copy')).toBeInTheDocument());
    };
    const finishPreview = async () => {
      await act(async () => preview.finish({ status: 200, body: APP_JSON.body }));
      await waitFor(() => expect(previewText()).toHaveTextContent('"name":"app"'));
    };

    await (first === 'tags' ? finishTags() : finishPreview());
    expect(flash('success').findHeader()?.getElement()).toHaveTextContent('Object copied.');
    await (first === 'tags' ? finishPreview() : finishTags());
    expectAddress(router, DESTINATION_KEY, 'beta');
    expect(flash('success').findHeader()?.getElement()).toHaveTextContent('Object copied.');
    expect(h1()).toHaveTextContent('copy app.json');
  });

  it('keeps the rename result when the original recheck responds missing before the destination loads', async () => {
    const destination = delayed<Answer>();
    let sawMissingOriginal = false;
    engine.head = (key) => {
      if (key === ORIGINAL_KEY && !engine.objects.some((object) => object.key === key)) {
        sawMissingOriginal = true;
        return { status: 404 };
      }
      return key === DESTINATION_KEY && engine.objects.some((object) => object.key === key)
        ? destination.promise
        : undefined;
    };
    const router = open(ORIGINAL_KEY);
    await shown();
    const dialog = await renameConfirmation(false);
    changeInput(dialog, 'Enter original key to confirm', ORIGINAL_KEY);
    fireEvent.click(dialogButton(dialog, 'Rename object'));
    await waitFor(() => expectAddress(router, DESTINATION_KEY));
    expect(sawMissingOriginal).toBe(true);
    expect(flash('success').findHeader()?.getElement()).toHaveTextContent('Object renamed.');
    await act(async () =>
      destination.finish({
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(APP_JSON.body.length) },
      }),
    );
    await waitFor(() => expect(previewText()).toHaveTextContent('"name":"app"'));
    expect(flash('success').findHeader()?.getElement()).toHaveTextContent('Object renamed.');
  });

  it.each(['tags', 'preview'])(
    'keeps saved properties and success when the refreshed %s returns first',
    async (first) => {
      const tags = delayed<Answer>();
      const preview = delayed<Answer>();
      open(ORIGINAL_KEY);
      await shown();
      await waitFor(() => expect(previewText()).toHaveTextContent('"name":"app"'));
      await waitFor(() => expect(within(section('Tags')).getByText('dev')).toBeInTheDocument());
      engine.tagging = () => tags.promise;
      engine.get = () => preview.promise;
      const dialog = await changeDialog('edit');
      changeInput(dialog, 'Content type', 'text/plain');
      fireEvent.change(fieldInput(metadataField(dialog, 1, 2)), { target: { value: 'qa' } });
      fireEvent.click(dialogButton(dialog, 'Save changes'));

      function assertSaved() {
        expect(overviewValue('Content type')).toBe('text/plain');
        expect(tableRows('User-defined metadata')).toEqual([['owner', 'qa']]);
        expect(flash('success').findContent()?.getElement()).toHaveTextContent('Object properties updated.');
      }
      await waitFor(assertSaved);
      const finishTags = async () => {
        await act(async () =>
          tags.finish(ok('<Tagging><TagSet><Tag><Key>env</Key><Value>dev</Value></Tag></TagSet></Tagging>')),
        );
        await waitFor(() => expect(within(section('Tags')).getByText('dev')).toBeInTheDocument());
      };
      const finishPreview = async () => {
        await act(async () => preview.finish({ status: 200, body: APP_JSON.body }));
        await waitFor(() => expect(previewText()).toHaveTextContent('"name":"app"'));
      };

      await (first === 'tags' ? finishTags() : finishPreview());
      assertSaved();
      await (first === 'tags' ? finishPreview() : finishTags());
      assertSaved();
    },
  );
});
