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
import { PART_SIZE } from '../upload';

// The Upload page rendered inside the area's layout, as Studio's frame renders the area, against a fake engine behind
// the page's `fetch` (test-criteria.md, issue 480, "Unit s3 — services/s3/pages/upload-page.test.tsx").

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  body?: string | null;
  headers?: Record<string, string>;
}

type EngineAnswer = Answer | Promise<Answer>;

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ok = (body: string): Answer => ({ status: 200, body: `<?xml version="1.0" encoding="UTF-8"?>${body}` });

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${xml(code)}</Code><Message>${xml(message)}</Message></Error>`,
  };
}

/** One request as the engine saw it. */
interface Seen {
  method: string;
  /** The operation, from the SDK's `x-id`, or `HeadObject` for a HEAD. */
  operation: string;
  key: string;
  url: URL;
  contentType: string | null;
  bytes: Uint8Array;
  /** The request's signal aborted before its answer. */
  aborted: boolean;
  /** Its answer was given. */
  answered: boolean;
}

/** The operation a request is, by its method and query, as S3 tells them apart. */
function operationOf(method: string, url: URL): string {
  const has = (name: string) => url.searchParams.has(name);
  if (method === 'HEAD') return 'HeadObject';
  if (method === 'POST' && has('uploads')) return 'CreateMultipartUpload';
  if (method === 'PUT' && has('uploadId')) return 'UploadPart';
  if (method === 'POST' && has('uploadId')) return 'CompleteMultipartUpload';
  if (method === 'DELETE' && has('uploadId')) return 'AbortMultipartUpload';
  if (method === 'PUT') return 'PutObject';
  if (method === 'GET' && url.pathname === '/') return 'ListBuckets';
  if (method === 'GET' && has('list-type')) return 'ListObjectsV2';
  return `${method} ${url.searchParams.get('x-id') ?? ''}`;
}

/** Whether two byte arrays hold the same bytes (compared whole, not element by element). */
function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && Buffer.from(a).equals(Buffer.from(b));
}

/** An answer held until the case gives it. */
function held(): { answer: Promise<Answer>; give: (answer: Answer) => void } {
  let give: (answer: Answer) => void = () => undefined;
  const answer = new Promise<Answer>((resolve) => {
    give = resolve;
  });
  return { answer, give };
}

class FakeEngine {
  buckets = ['alpha'];
  /** Keys `HeadObject` finds. */
  existing: string[] = [];
  readonly seen: Seen[] = [];
  /** A case's own answers, tried before the emulator's. */
  own: ((seen: Seen) => EngineAnswer | undefined) | undefined;
  private uploads = 0;

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'token-1' }), { status: 200 });
    }
    const bytes =
      request.method === 'GET' || request.method === 'HEAD'
        ? new Uint8Array()
        : new Uint8Array(await request.arrayBuffer());
    const [, , ...rest] = url.pathname.split('/');
    const seen: Seen = {
      method: request.method,
      operation: operationOf(request.method, url),
      key: rest.map((part) => decodeURIComponent(part)).join('/'),
      url,
      contentType: request.headers.get('content-type'),
      bytes,
      aborted: false,
      answered: false,
    };
    this.seen.push(seen);
    const answer = await Promise.race([
      Promise.resolve(this.own?.(seen) ?? this.answer(seen)),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          if (seen.answered) return;
          seen.aborted = true;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    seen.answered = true;
    return new Response(seen.method === 'HEAD' ? null : (answer.body ?? null), {
      status: answer.status,
      headers: answer.headers ?? {},
    });
  };

  private answer(seen: Seen): EngineAnswer {
    const { url, operation, key } = seen;
    if (url.pathname === '/' && operation === 'ListBuckets') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const names = this.buckets.filter((name) => name.startsWith(prefix)).slice(0, 1);
      return ok(
        `<ListAllMyBucketsResult><Buckets>${names
          .map((name) => `<Bucket><Name>${xml(name)}</Name><BucketRegion>us-east-1</BucketRegion></Bucket>`)
          .join('')}</Buckets></ListAllMyBucketsResult>`,
      );
    }
    switch (operation) {
      case 'HeadObject':
        return this.existing.includes(key)
          ? { status: 200, headers: { 'content-length': '3', 'content-type': 'text/plain', etag: '"e"' } }
          : { status: 404 };
      case 'ListObjectsV2':
        return ok(
          '<ListBucketResult><Name>alpha</Name><Prefix></Prefix><KeyCount>0</KeyCount><MaxKeys>100</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>',
        );
      case 'PutObject':
        return { status: 200, headers: { etag: '"put"' } };
      case 'CreateMultipartUpload':
        this.uploads += 1;
        return ok(
          `<InitiateMultipartUploadResult><Bucket>alpha</Bucket><Key>${xml(key)}</Key><UploadId>upload-${String(this.uploads)}</UploadId></InitiateMultipartUploadResult>`,
        );
      case 'UploadPart':
        return { status: 200, headers: { etag: `"part-${url.searchParams.get('partNumber') ?? ''}"` } };
      case 'CompleteMultipartUpload':
        return ok(
          `<CompleteMultipartUploadResult><Bucket>alpha</Bucket><Key>${xml(key)}</Key><ETag>"done-2"</ETag></CompleteMultipartUploadResult>`,
        );
      case 'AbortMultipartUpload':
        return { status: 204 };
      default:
        return errorAnswer(400, 'InvalidRequest', `not in this fake: ${seen.method} ${url.href}`);
    }
  }

  requests(operation: string): Seen[] {
    return this.seen.filter((seen) => seen.operation === operation);
  }

  /** What was sent, in order, but the reads of the page. */
  writes(): string[] {
    return this.seen
      .filter((seen) => !['ListBuckets', 'HeadObject', 'ListObjectsV2'].includes(seen.operation))
      .map((seen) => seen.operation);
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

let nextPort = 9600;
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

function uploadAddress(prefix = '', bucket = 'alpha'): string {
  return `/aws/s3/bucket/${bucket}/upload${prefix === '' ? '' : `?${new URLSearchParams({ prefix }).toString()}`}`;
}

function open(prefix = '', bucket = 'alpha') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [uploadAddress(prefix, bucket)] },
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
// Files and readers.
// ---------------------------------------------------------------------------------------------------------------

function textFile(name: string, text: string, type = 'text/plain'): File {
  return new File([new TextEncoder().encode(text)], name, { type });
}

/** A file of `size` bytes, each byte its index modulo 251, so every slice differs. */
function bigFile(name: string, size: number, type = 'application/octet-stream'): File {
  const pattern = new Uint8Array(251).map((_, index) => index);
  const bytes = new Uint8Array(size);
  for (let start = 0; start < size; start += pattern.length) {
    bytes.set(pattern.subarray(0, Math.min(pattern.length, size - start)), start);
  }
  return new File([bytes], name, { type });
}

async function shownPage() {
  await screen.findByRole('heading', { level: 1, name: 'Upload' });
}

/** Adds `files` through "Add files", as a user's pick does. */
function addFiles(...files: File[]) {
  const upload = createWrapper(document.body).findFileUpload();
  if (upload === null) throw new Error('No "Add files"');
  const input = upload.findNativeInput().getElement();
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

function filesTable(): HTMLElement {
  const table = createWrapper(document.body)
    .findAllTables()
    .find((found) => found.findHeaderSlot()?.getElement().textContent?.startsWith('Files') === true);
  if (table === undefined) throw new Error('No table "Files"');
  return table.getElement();
}

/** The rows of the table "Files": name, size, type, status. */
function fileRows(): string[][] {
  return [...filesTable().querySelectorAll('tbody tr')]
    .map((row) => [...row.querySelectorAll('td, th')].map((cell) => (cell.textContent ?? '').trim()))
    .filter((cells) => cells.length > 1)
    .map((cells) => cells.filter((_, index) => index < 4));
}

function statusOf(name: string): string {
  const row = fileRows().find((cells) => cells[0] === name);
  return row?.[3] ?? '';
}

function action(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

function flashes(type: 'success' | 'error' | 'info'): string[] {
  return (createWrapper(document.body).findFlashbar()?.findItemsByType(type) ?? []).map((item) =>
    (item.getElement().textContent ?? '').trim(),
  );
}

function crumbLinks(): [string, string | null][] {
  return (createWrapper(document.body).findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((item) => {
    const element = item.getElement();
    const link = element.closest('a[href]') ?? element.querySelector('a[href]');
    return [(element.textContent ?? '').trim(), link?.getAttribute('href') ?? null];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Cases.
// ---------------------------------------------------------------------------------------------------------------

describe('the Upload page, the files chosen', () => {
  it('lists each added file with name, size and type, "binary/octet-stream" without one, and removes one', async () => {
    open('logs/');
    await shownPage();
    expect(within(filesTable()).getByText('No files')).toBeInTheDocument();
    expect(within(filesTable()).getByText('Add the files to put in this folder.')).toBeInTheDocument();

    addFiles(textFile('note.txt', 'twenty bytes of text'), new File([new Uint8Array(2048)], 'raw', { type: '' }));
    await waitFor(() => {
      expect(fileRows()).toEqual([
        ['note.txt', '20 B', 'text/plain', '-'],
        ['raw', '2.0 KiB', 'binary/octet-stream', '-'],
      ]);
    });

    fireEvent.click(action('Remove note.txt'));
    expect(fileRows().map((cells) => cells[0])).toEqual(['raw']);
    fireEvent.click(action('Remove raw'));
    expect(within(filesTable()).getByText('No files')).toBeInTheDocument();
  });

  it('a key HeadObject finds says "Replaces an existing object"', async () => {
    engine.existing = ['logs/old.txt'];
    open('logs/');
    await shownPage();
    addFiles(textFile('old.txt', 'x'), textFile('new.txt', 'y'));
    await waitFor(() => {
      expect(statusOf('old.txt')).toBe('Replaces an existing object');
    });
    expect(statusOf('new.txt')).toBe('-');
    expect(engine.requests('HeadObject').map((seen) => seen.key)).toEqual(['logs/old.txt', 'logs/new.txt']);
  });
});

describe('the Upload page, the puts', () => {
  it('a file up to 8 MiB is one PutObject of its key, type and body', async () => {
    open('logs/');
    await shownPage();
    const file = bigFile('exact.bin', PART_SIZE, 'image/png');
    addFiles(textFile('note.txt', 'twenty bytes of text'), file);
    fireEvent.click(action('Upload'));
    await screen.findByText('Uploaded 2 of 2 files.');

    expect(engine.writes()).toEqual(['PutObject', 'PutObject']);
    const [note, exact] = engine.requests('PutObject');
    expect(note?.key).toBe('logs/note.txt');
    expect(note?.contentType).toBe('text/plain');
    expect(new TextDecoder().decode(note?.bytes)).toBe('twenty bytes of text');
    expect(exact?.key).toBe('logs/exact.bin');
    expect(exact?.contentType).toBe('image/png');
    expect(sameBytes(exact?.bytes, new Uint8Array(await file.arrayBuffer()))).toBe(true);
  });

  it('above 8 MiB: CreateMultipartUpload, ⌈size/8 MiB⌉ parts of 8 MiB slices in order, Complete with their ETags', async () => {
    open();
    await shownPage();
    const size = 2 * PART_SIZE + 5;
    const file = bigFile('big.bin', size);
    addFiles(file);
    fireEvent.click(action('Upload'));
    await screen.findByText('Uploaded 1 of 1 files.');

    expect(engine.writes()).toEqual([
      'CreateMultipartUpload',
      'UploadPart',
      'UploadPart',
      'UploadPart',
      'CompleteMultipartUpload',
    ]);
    expect(engine.requests('CreateMultipartUpload')[0]?.contentType).toBe('application/octet-stream');
    const whole = new Uint8Array(await file.arrayBuffer());
    const parts = engine.requests('UploadPart');
    parts.forEach((part, index) => {
      expect(part.key).toBe('big.bin');
      expect(part.url.searchParams.get('partNumber')).toBe(String(index + 1));
      expect(part.url.searchParams.get('uploadId')).toBe('upload-1');
      expect(sameBytes(part.bytes, whole.slice(index * PART_SIZE, Math.min((index + 1) * PART_SIZE, size)))).toBe(true);
    });
    const complete = new TextDecoder().decode(engine.requests('CompleteMultipartUpload')[0]?.bytes);
    expect([...complete.matchAll(/<Part>(.*?)<\/Part>/g)].map((match) => match[1])).toEqual([
      '<ETag>&quot;part-1&quot;</ETag><PartNumber>1</PartNumber>',
      '<ETag>&quot;part-2&quot;</ETag><PartNumber>2</PartNumber>',
      '<ETag>&quot;part-3&quot;</ETag><PartNumber>3</PartNumber>',
    ]);
    expect(statusOf('big.bin')).toBe('Uploaded');
  });

  it('a part\'s failure → AbortMultipartUpload and the row "Failed:" with the message', async () => {
    engine.own = (seen) =>
      seen.operation === 'UploadPart' && seen.url.searchParams.get('partNumber') === '2'
        ? errorAnswer(
            400,
            'ValidationException',
            'recording part 2 would leave the bucket "alpha" holding 70000000 bytes, past the 67108864 bytes',
          )
        : undefined;
    open();
    await shownPage();
    addFiles(bigFile('big.bin', 3 * PART_SIZE));
    fireEvent.click(action('Upload'));
    await screen.findByText('Uploaded 0 of 1 files.');

    expect(statusOf('big.bin')).toBe(
      'Failed: recording part 2 would leave the bucket "alpha" holding 70000000 bytes, past the 67108864 bytes',
    );
    await waitFor(() => {
      expect(engine.writes()).toEqual(['CreateMultipartUpload', 'UploadPart', 'UploadPart', 'AbortMultipartUpload']);
    });
    expect(engine.requests('AbortMultipartUpload')[0]?.url.searchParams.get('uploadId')).toBe('upload-1');
  });

  it('a failed CompleteMultipartUpload → AbortMultipartUpload for its upload, and the row "Failed:"', async () => {
    engine.own = (seen) =>
      seen.operation === 'CompleteMultipartUpload'
        ? errorAnswer(400, 'InvalidPart', 'One or more of the specified parts could not be found.')
        : undefined;
    open();
    await shownPage();
    addFiles(bigFile('big.bin', PART_SIZE + 1));
    fireEvent.click(action('Upload'));
    await screen.findByText('Uploaded 0 of 1 files.');

    expect(statusOf('big.bin')).toBe('Failed: One or more of the specified parts could not be found.');
    await waitFor(() => {
      expect(engine.writes()).toEqual([
        'CreateMultipartUpload',
        'UploadPart',
        'UploadPart',
        'CompleteMultipartUpload',
        'AbortMultipartUpload',
      ]);
    });
    expect(engine.requests('AbortMultipartUpload')[0]?.url.searchParams.get('uploadId')).toBe('upload-1');
  });

  it('rows go "Waiting", "Uploading", "Uploaded" or "Failed:"; the result is success when all, error otherwise', async () => {
    const first = held();
    engine.own = (seen) => {
      if (seen.operation !== 'PutObject') return undefined;
      if (seen.key === 'a.txt') return first.answer;
      if (seen.key === 'c.txt') return errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
      return undefined;
    };
    open();
    await shownPage();
    addFiles(textFile('a.txt', 'a'), textFile('b.txt', 'b'), textFile('c.txt', 'c'));
    fireEvent.click(action('Upload'));
    await waitFor(() => {
      expect(statusOf('a.txt')).toBe('Uploading');
    });
    expect(statusOf('b.txt')).toBe('Waiting');
    expect(statusOf('c.txt')).toBe('Waiting');

    act(() => {
      first.give({ status: 200, headers: { etag: '"a"' } });
    });
    await screen.findByText('Uploaded 2 of 3 files.');
    expect(fileRows().map((cells) => cells[3])).toEqual([
      'Uploaded',
      'Uploaded',
      'Failed: The specified bucket does not exist',
    ]);
    expect(flashes('error')).toEqual(['Uploaded 2 of 3 files.']);
    expect(flashes('success')).toEqual([]);
  });

  it('every file put → the result as success, and "Go to {name}" leads to the tab at the folder', async () => {
    const router = open('logs/');
    await shownPage();
    addFiles(textFile('a.txt', 'a'));
    fireEvent.click(action('Upload'));
    await screen.findByText('Uploaded 1 of 1 files.');
    expect(flashes('success')).toEqual(['Uploaded 1 of 1 files.']);
    fireEvent.click(screen.getByRole('link', { name: 'Go to alpha' }));
    await waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        '/aws/s3/buckets/alpha?prefix=logs%2F',
      );
    });
  });

  it('501 on PutObject or a multipart operation → "Not implemented by the emulator" with its name, in the row', async () => {
    engine.own = (seen) =>
      seen.operation === 'PutObject' || seen.operation === 'UploadPart' ? { status: 501, body: null } : undefined;
    open();
    await shownPage();
    addFiles(textFile('small.txt', 's'), bigFile('big.bin', PART_SIZE + 1));
    fireEvent.click(action('Upload'));
    await screen.findByText('Uploaded 0 of 2 files.');
    expect(statusOf('small.txt')).toBe('Not implemented by the emulator: PutObject');
    expect(statusOf('big.bin')).toBe('Not implemented by the emulator: UploadPart');
  });
});

describe('the Upload page, "Cancel" and leaving', () => {
  it('"Cancel" with no file leaves at once; with a file, the discard dialog', async () => {
    const router = open('logs/');
    await shownPage();
    fireEvent.click(action('Cancel'));
    await waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        '/aws/s3/buckets/alpha?prefix=logs%2F',
      );
    });

    act(() => {
      void router.navigate(uploadAddress('logs/'));
    });
    await shownPage();
    addFiles(textFile('a.txt', 'a'));
    fireEvent.click(action('Cancel'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Discard what you entered?')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/aws/s3/bucket/alpha/upload');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/s3/buckets/alpha');
    });
    expect(engine.writes()).toEqual([]);
  });

  it('"Cancel" during upload ends the request in flight and puts nothing further; files put stay', async () => {
    const second = held();
    engine.own = (seen) => (seen.operation === 'PutObject' && seen.key === 'b.txt' ? second.answer : undefined);
    const router = open();
    await shownPage();
    addFiles(textFile('a.txt', 'a'), textFile('b.txt', 'b'), textFile('c.txt', 'c'));
    fireEvent.click(action('Upload'));
    await waitFor(() => {
      expect(statusOf('b.txt')).toBe('Uploading');
    });
    fireEvent.click(action('Cancel'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/s3/buckets/alpha');
    });
    const puts = engine.requests('PutObject');
    expect(puts.map((seen) => [seen.key, seen.answered, seen.aborted])).toEqual([
      ['a.txt', true, false],
      ['b.txt', false, true],
    ]);
    second.give({ status: 200 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(engine.requests('PutObject')).toHaveLength(2);
  });

  it('leaving during a multipart upload ends the part in flight and aborts the upload with a signal of its own, which completes after the page is gone', async () => {
    const part = held();
    const abort = held();
    engine.own = (seen) => {
      if (seen.operation === 'UploadPart' && seen.url.searchParams.get('partNumber') === '2') return part.answer;
      if (seen.operation === 'AbortMultipartUpload') return abort.answer;
      return undefined;
    };
    const router = open();
    await shownPage();
    addFiles(bigFile('big.bin', 2 * PART_SIZE + 1), textFile('after.txt', 'a'));
    fireEvent.click(action('Upload'));
    await waitFor(() => {
      expect(engine.requests('UploadPart')).toHaveLength(2);
    });
    expect(statusOf('big.bin')).toBe('Uploading, 1 of 3 parts');

    // Leaving by a crumb: the page is gone.
    act(() => {
      void router.navigate('/aws/s3/buckets');
    });
    await screen.findByRole('heading', { level: 1, name: /Buckets/ });
    await waitFor(() => {
      expect(engine.requests('AbortMultipartUpload')).toHaveLength(1);
    });
    expect(engine.requests('UploadPart')[1]?.aborted).toBe(true);
    const sent = engine.requests('AbortMultipartUpload')[0];
    expect(sent?.url.searchParams.get('uploadId')).toBe('upload-1');

    act(() => {
      abort.give({ status: 204 });
    });
    await waitFor(() => {
      expect(sent?.answered).toBe(true);
    });
    expect(sent?.aborted).toBe(false);
    expect(engine.writes()).toEqual(['CreateMultipartUpload', 'UploadPart', 'UploadPart', 'AbortMultipartUpload']);
  });

  it('a failed AbortMultipartUpload → the area\'s flash "The unfinished upload … could not be aborted:", after the page is gone', async () => {
    const part = held();
    const abort = held();
    engine.own = (seen) => {
      if (seen.operation === 'UploadPart') return part.answer;
      if (seen.operation === 'AbortMultipartUpload') return abort.answer;
      return undefined;
    };
    const router = open();
    await shownPage();
    addFiles(bigFile('big.bin', PART_SIZE + 1));
    fireEvent.click(action('Upload'));
    await waitFor(() => {
      expect(engine.requests('UploadPart')).toHaveLength(1);
    });
    fireEvent.click(action('Cancel'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/s3/buckets/alpha');
    });
    await screen.findByRole('heading', { level: 2, name: /Objects/ });

    act(() => {
      abort.give(errorAnswer(500, 'InternalError', 'The upload could not be removed.'));
    });
    await waitFor(() => {
      expect(flashes('error')).toEqual([
        'The unfinished upload upload-1 of big.bin could not be aborted:InternalError: The upload could not be removed.',
      ]);
    });
  });
});

describe('the Upload page, its frame', () => {
  it('a bucket the emulator does not hold → the h1 "Upload" stays, then "No bucket {name}" and no file picker', async () => {
    open('', 'gone');
    await waitFor(() => {
      expect(screen.getByText('The local emulator holds no bucket of this name.')).toBeInTheDocument();
    });
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Upload']);
    expect(screen.getByRole('link', { name: 'Go to Buckets' })).toBeInTheDocument();
    expect(createWrapper(document.body).findFileUpload()).toBeNull();
    expect(engine.writes()).toEqual([]);
  });

  it('crumbs carry the prefix trail, each part a link to the tab at it, then "Upload"; the notice names objects', async () => {
    open('logs/2026/');
    await shownPage();
    expect(crumbLinks().slice(-5)).toEqual([
      ['Buckets', '/aws/s3/buckets'],
      ['alpha', '/aws/s3/buckets/alpha'],
      ['logs', '/aws/s3/buckets/alpha?prefix=logs%2F'],
      ['2026', '/aws/s3/buckets/alpha?prefix=logs%2F2026%2F'],
      ['Upload', null],
    ]);
    expect(screen.getByText('These objects are in your local emulator')).toBeInTheDocument();
    expect(screen.getByText(/^Files are put under/).closest('div')?.textContent).toContain(
      'Files are put under s3://alpha/logs/2026/.',
    );
  });
});
