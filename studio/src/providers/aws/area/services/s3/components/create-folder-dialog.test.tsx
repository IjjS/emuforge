import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// "Create folder" on a bucket's tab "Objects", rendered inside the area's layout against a fake engine behind the
// page's `fetch` (test-criteria.md, issue 480, "Unit s3 — services/s3/components/create-folder-dialog.test.tsx").

interface Answer {
  status: number;
  body?: string | null;
  headers?: Record<string, string>;
}

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ok = (body: string): Answer => ({ status: 200, body: `<?xml version="1.0" encoding="UTF-8"?>${body}` });

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${xml(code)}</Code><Message>${xml(message)}</Message></Error>`,
  };
}

interface Seen {
  method: string;
  url: URL;
  key: string;
  bytes: number;
}

class FakeEngine {
  /** The keys the bucket `alpha` holds. */
  keys: string[] = [];
  readonly seen: Seen[] = [];
  /** A case's own answer to `PutObject`. */
  put: Answer | undefined;

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'token-1' }), { status: 200 });
    }
    const bytes = request.method === 'PUT' ? (await request.arrayBuffer()).byteLength : 0;
    const [, , ...rest] = url.pathname.split('/');
    const key = rest.map((part) => decodeURIComponent(part)).join('/');
    this.seen.push({ method: request.method, url, key, bytes });
    const answer = this.answer(request.method, url, key);
    return new Response(answer.body ?? null, { status: answer.status, headers: answer.headers ?? {} });
  };

  private answer(method: string, url: URL, key: string): Answer {
    if (url.pathname === '/') {
      return ok(
        '<ListAllMyBucketsResult><Buckets><Bucket><Name>alpha</Name><BucketRegion>us-east-1</BucketRegion></Bucket></Buckets></ListAllMyBucketsResult>',
      );
    }
    if (method === 'GET' && url.searchParams.has('list-type')) {
      const prefix = url.searchParams.get('prefix') ?? '';
      const delimiter = url.searchParams.get('delimiter');
      const max = Number(url.searchParams.get('max-keys') ?? '1000');
      const under = this.keys.filter((found) => found.startsWith(prefix));
      const folders = new Set<string>();
      const objects: string[] = [];
      for (const found of under) {
        const slash = delimiter === null ? -1 : found.indexOf(delimiter, prefix.length);
        if (slash === -1) objects.push(found);
        else folders.add(found.slice(0, slash + 1));
      }
      const contents = objects
        .slice(0, max)
        .map(
          (found) =>
            `<Contents><Key>${xml(found)}</Key><Size>1</Size><LastModified>2026-11-18T10:00:00.000Z</LastModified><StorageClass>STANDARD</StorageClass></Contents>`,
        )
        .join('');
      const prefixes = [...folders].map((folder) => `<CommonPrefixes><Prefix>${xml(folder)}</Prefix></CommonPrefixes>`);
      return ok(
        `<ListBucketResult><Name>alpha</Name><Prefix>${xml(prefix)}</Prefix><MaxKeys>${String(max)}</MaxKeys><IsTruncated>false</IsTruncated>${contents}${prefixes.join('')}</ListBucketResult>`,
      );
    }
    if (method === 'PUT') {
      if (this.put !== undefined) return this.put;
      this.keys.push(key);
      return { status: 200, headers: { etag: '"d41d8cd98f00b204e9800998ecf8427e"' } };
    }
    return errorAnswer(400, 'InvalidRequest', `not in this fake: ${method} ${url.href}`);
  }

  puts(): Seen[] {
    return this.seen.filter((seen) => seen.method === 'PUT');
  }

  /** The checks "Create folder" made: `ListObjectsV2` with max-keys 1. */
  checks(): Seen[] {
    return this.seen.filter((seen) => seen.method === 'GET' && seen.url.searchParams.get('max-keys') === '1');
  }
}

class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  readonly subscribe = () => () => undefined;
  readonly get = () => this.value;
}

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: 9305, endpoint: 'https://127.0.0.1:9305' } };
}

let nextPort = 9700;
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

/** Opens bucket `alpha`'s tab "Objects" at `prefix` and then "Create folder". */
async function openDialog(prefix = '', focusOpener = false): Promise<HTMLElement> {
  const address = `/aws/s3/buckets/alpha${prefix === '' ? '' : `?${new URLSearchParams({ prefix }).toString()}`}`;
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [address] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Create folder' })).toBeInTheDocument();
  });
  if (focusOpener) {
    screen.getByRole('button', { name: 'Create folder' }).focus();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
  return screen.findByRole('dialog');
}

function field(dialog: HTMLElement) {
  const found = createWrapper(dialog).findFormField();
  if (found === null) throw new Error('No field');
  return found;
}

function typeName(dialog: HTMLElement, name: string) {
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: name } });
}

function create(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
}

function flashes(type: 'success' | 'error' | 'info'): string[] {
  return (createWrapper(document.body).findFlashbar()?.findItemsByType(type) ?? []).map((item) =>
    (item.getElement().textContent ?? '').trim(),
  );
}

describe('"Create folder", the name', () => {
  it('shows the rule before any submit; an empty name or one with "/" shows the rule failed, and nothing is sent', async () => {
    const dialog = await openDialog('logs/');
    expect(field(dialog).findLabel()?.getElement().textContent).toBe('Folder name');
    expect(field(dialog).findConstraint()?.getElement().textContent).toBe('Can\'t contain "/".');
    expect(field(dialog).findError()).toBeNull();

    create(dialog);
    expect(field(dialog).findError()?.getElement().textContent).toBe('Enter a folder name.');

    typeName(dialog, 'a/b');
    create(dialog);
    expect(field(dialog).findError()?.getElement().textContent).toBe('Can\'t contain "/".');
    expect(field(dialog).findConstraint()?.getElement().textContent).toBe('Can\'t contain "/".');

    expect(engine.checks()).toEqual([]);
    expect(engine.puts()).toEqual([]);
  });
});

describe('"Create folder", the focus', () => {
  it('the name field has focus once the dialog shows; Escape and Cancel give it back to the tab\'s "Create folder"', async () => {
    const opener = async () => {
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Create folder' })).toBeInTheDocument();
      });
      return screen.getByRole('button', { name: 'Create folder' });
    };
    const dialog = await openDialog('logs/', true);
    await waitFor(() => {
      expect(document.activeElement).toBe(within(dialog).getByRole('textbox'));
    });

    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(async () => {
      expect(document.activeElement).toBe(await opener());
    });

    const button = await opener();
    button.focus();
    fireEvent.click(button);
    const again = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(document.activeElement).toBe(within(again).getByRole('textbox'));
    });
    fireEvent.click(within(again).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(async () => {
      expect(document.activeElement).toBe(await opener());
    });
  });
});

describe('"Create folder", the calls', () => {
  it('a name not found → PutObject of prefix+name+/ with an empty body, "Folder {name} created.", and the folder listed', async () => {
    engine.keys = ['logs/a.txt'];
    const dialog = await openDialog('logs/');
    typeName(dialog, 'reports');
    create(dialog);

    await waitFor(() => {
      expect(flashes('success')).toEqual(['Folder reports created.']);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(engine.checks().map((seen) => seen.url.searchParams.get('prefix'))).toEqual(['logs/reports/']);
    expect(engine.puts().map((seen) => [seen.key, seen.bytes])).toEqual([['logs/reports/', 0]]);
    await screen.findByRole('link', { name: 'reports/' });
  });

  it('a key found under the name → "A folder {name} already exists here." in the open dialog, and nothing put', async () => {
    engine.keys = ['logs/a.txt'];
    const dialog = await openDialog();
    typeName(dialog, 'logs');
    create(dialog);
    await waitFor(() => {
      expect(createWrapper(dialog).findAlert()?.getElement().textContent).toBe('A folder logs already exists here.');
    });
    expect(engine.checks().map((seen) => seen.url.searchParams.get('prefix'))).toEqual(['logs/']);
    expect(engine.puts()).toEqual([]);
  });

  it('a common prefix found under the name → "A folder {name} already exists here." and nothing put', async () => {
    engine.keys = ['logs/2026/a.txt'];
    const original = engine.fetch;
    // The check answers a common prefix only, as an answer with a delimiter would.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.searchParams.get('max-keys') === '1') {
        engine.seen.push({ method: 'GET', url, key: '', bytes: 0 });
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>alpha</Name><Prefix>logs/</Prefix><MaxKeys>1</MaxKeys><IsTruncated>true</IsTruncated><CommonPrefixes><Prefix>logs/2026/</Prefix></CommonPrefixes></ListBucketResult>',
          { status: 200 },
        );
      }
      return original(request);
    });
    const dialog = await openDialog();
    typeName(dialog, 'logs');
    create(dialog);
    await waitFor(() => {
      expect(createWrapper(dialog).findAlert()?.getElement().textContent).toBe('A folder logs already exists here.');
    });
    expect(engine.puts()).toEqual([]);
  });

  it('a 501 → "Not implemented by the emulator" naming PutObject, in the open dialog', async () => {
    engine.put = { status: 501 };
    const dialog = await openDialog();
    typeName(dialog, 'reports');
    create(dialog);
    await within(dialog).findByText('Not implemented by the emulator');
    expect(within(dialog).getByText('The emulator answered 501 Not Implemented for PutObject.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(flashes('success')).toEqual([]);
  });

  it("another failure → the emulator's message, in the open dialog", async () => {
    engine.put = errorAnswer(
      400,
      'ValidationException',
      'the bucket "alpha" already holds the maximum of 1000 objects',
    );
    const dialog = await openDialog();
    typeName(dialog, 'reports');
    create(dialog);
    await within(dialog).findByText('Creating the folder failed');
    expect(dialog.textContent).toContain(
      'ValidationException: the bucket "alpha" already holds the maximum of 1000 objects',
    );
    expect(screen.getByRole('dialog')).toBe(dialog);
  });
});
