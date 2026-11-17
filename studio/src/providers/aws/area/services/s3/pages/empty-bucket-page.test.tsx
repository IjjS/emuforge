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

// "Empty bucket" and its status rendered inside the area's layout, as Studio's frame renders the area, against a fake
// engine behind the page's `fetch` (test-criteria.md, issue 256, "Unit — services/s3/pages/empty-bucket-page.test.tsx").

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  body: string;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

type Operation = 'ListBuckets' | 'ListObjectVersions' | 'DeleteObjects';

/** An object version of the fake emulator, and the error `DeleteObjects` answers for it when it is held. */
interface Item {
  key: string;
  versionId: string;
  refused?: { code: string; message: string };
}

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${xml(code)}</Code><Message>${xml(message)}</Message></Error>`,
  };
}

function listAnswer(names: string[]): Answer {
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>${names
      .map((name) => `<Bucket><Name>${xml(name)}</Name><BucketRegion>us-east-1</BucketRegion></Bucket>`)
      .join('')}</Buckets></ListAllMyBucketsResult>`,
  };
}

function versionsAnswer(items: readonly Item[]): Answer {
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?><ListVersionsResult><IsTruncated>false</IsTruncated>${items
      .map(({ key, versionId }) => `<Version><Key>${xml(key)}</Key><VersionId>${xml(versionId)}</VersionId></Version>`)
      .join('')}</ListVersionsResult>`,
  };
}

function queryKeys(url: URL): string[] {
  return (url.search.slice(1) === '' ? [] : url.search.slice(1).split('&')).map((pair) =>
    decodeURIComponent(pair.split('=')[0] ?? ''),
  );
}

function operationOf(method: string, url: URL): Operation | 'other' {
  if (method === 'GET' && url.pathname === '/' && url.searchParams.get('x-id') === 'ListBuckets') {
    return 'ListBuckets';
  }
  if (method === 'GET' && url.pathname !== '/' && queryKeys(url).includes('versions')) {
    return 'ListObjectVersions';
  }
  if (method === 'POST' && url.pathname !== '/' && queryKeys(url).includes('delete')) {
    return 'DeleteObjects';
  }
  return 'other';
}

/** The bucket a request is sent to: the path's one segment, with or without a slash after it. */
function bucketOf(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\/|\/$/g, ''));
}

/** The keys and version ids a `DeleteObjects` body names. */
function deletedItems(body: string): { key: string; versionId: string }[] {
  const document = new DOMParser().parseFromString(body, 'application/xml');
  return [...document.getElementsByTagName('Object')].map((object) => ({
    key: object.getElementsByTagName('Key')[0]?.textContent ?? '',
    versionId: object.getElementsByTagName('VersionId')[0]?.textContent ?? '',
  }));
}

class FakeEngine {
  /** The buckets the emulator holds, names ascending. */
  buckets: string[] = [];
  /** What each bucket holds; nothing by default. */
  contents: Record<string, Item[]> = {};
  /** Every AWS request, in the order sent. */
  readonly sent: { operation: Operation | 'other'; url: URL }[] = [];
  /** The answer of each operation; by default the emulator's. */
  answers: Partial<Record<Operation, (url: URL) => EngineAnswer>> = {};

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'token-1' }), { status: 200 });
    }
    const operation = operationOf(request.method, url);
    this.sent.push({ operation, url });
    const body = operation === 'DeleteObjects' ? await request.text() : '';
    const answer = await Promise.race([
      Promise.resolve(this.answer(operation, url, body)),
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

  private answer(operation: Operation | 'other', url: URL, body: string): EngineAnswer {
    const given = operation === 'other' ? undefined : this.answers[operation];
    if (given !== undefined) {
      return given(url);
    }
    const bucket = bucketOf(url);
    switch (operation) {
      case 'ListBuckets': {
        const size = Number(url.searchParams.get('max-buckets') ?? '1000');
        const prefix = url.searchParams.get('prefix') ?? '';
        return listAnswer(this.buckets.filter((name) => name.startsWith(prefix)).slice(0, size));
      }
      case 'ListObjectVersions':
        return this.buckets.includes(bucket)
          ? versionsAnswer(this.contents[bucket] ?? [])
          : errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
      case 'DeleteObjects':
        return this.deleteObjects(bucket, body);
      case 'other':
        return errorAnswer(400, 'InvalidRequest', `not in this fake: ${url.href}`);
    }
  }

  /** Deletes what the body names; a held item is answered as an error and stays. */
  private deleteObjects(bucket: string, body: string): Answer {
    if (!this.buckets.includes(bucket)) {
      return errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
    }
    const held = new Map((this.contents[bucket] ?? []).map((item) => [`${item.key}\n${item.versionId}`, item]));
    const errors: string[] = [];
    for (const { key, versionId } of deletedItems(body)) {
      const item = held.get(`${key}\n${versionId}`);
      if (item?.refused !== undefined) {
        errors.push(
          `<Error><Key>${xml(key)}</Key><VersionId>${xml(versionId)}</VersionId><Code>${xml(item.refused.code)}</Code><Message>${xml(item.refused.message)}</Message></Error>`,
        );
      } else {
        held.delete(`${key}\n${versionId}`);
      }
    }
    this.contents[bucket] = [...held.values()];
    return {
      status: 200,
      body: `<?xml version="1.0" encoding="UTF-8"?><DeleteResult>${errors.join('')}</DeleteResult>`,
    };
  }

  of(operation: Operation): URL[] {
    return this.sent.filter((sent) => sent.operation === operation).map(({ url }) => url);
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

const EMULATOR_PORT = 9306;
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
let nextPort = 9700;
let engine: FakeEngine;
let connection: Connection;
let engineOrigin: string;

/** The document title as Studio's frame writes it from the title the area reports. */
function writeTitle(title: string) {
  document.title = `${title} | EmuForge Studio`;
}

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
      onPageTitle={writeTitle}
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
  document.title = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const NAME = 'alpha';
const EMPTY_PATH = `/aws/s3/bucket/${NAME}/empty`;
const LIST_PATH = '/aws/s3/buckets';
const FIELD = 'To confirm, enter the name of the bucket.';
const SENTENCE = `Every object, object version and delete marker in bucket “${NAME}” will be deleted from your local emulator at ${EMULATOR_ENDPOINT}. This cannot be undone.`;
const SENTENCE_NOT_CONNECTED = `Every object, object version and delete marker in bucket “${NAME}” will be deleted from your local emulator. This cannot be undone.`;
const RUNS_HERE = 'Emptying runs in this page. Leaving the page stops it.';
const STATUS = 'Empty bucket: Status';
const ITEM_MEANS = 'An item is an object version or a delete marker.';

function open(path = EMPTY_PATH) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
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
// Readers and actions.
// ---------------------------------------------------------------------------------------------------------------

function main(): HTMLElement {
  return screen.getByRole('main');
}

/** Matches the element whose whole text is `text`, and none of its children alone. */
function byWholeText(text: string) {
  return (_: string, element: Element | null): boolean =>
    element !== null &&
    element.textContent === text &&
    [...element.children].every((child) => child.textContent !== text);
}

/** The page's own element whose whole text is `text`: outside the emulator line, the flash and live regions. */
function onPage(text: string): HTMLElement {
  const found = within(main())
    .getAllByText(byWholeText(text))
    .filter(
      (element) =>
        element.closest('.aws-area-emulator-line') === null &&
        element.closest('[aria-live]') === null &&
        !flashElement()?.contains(element),
    );
  expect(found).toHaveLength(1);
  return found[0] as HTMLElement;
}

function queryOnPage(text: string): HTMLElement | null {
  try {
    return onPage(text);
  } catch {
    return null;
  }
}

async function findOnPage(text: string): Promise<HTMLElement> {
  return waitFor(() => onPage(text), { timeout: 10_000 });
}

/** The type of the Cloudscape status indicator or alert around `text` on the page. */
function statusType(text: string): string | undefined {
  for (let at: Element | null = onPage(text); at !== null; at = at.parentElement) {
    const match = [...at.classList]
      .map((name) => /(?:status|type)-(error|info|stopped|loading|success|in-progress)/.exec(name))
      .find(Boolean);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function field(): HTMLInputElement {
  return within(main()).getByRole('textbox', { name: FIELD }) as HTMLInputElement;
}

function queryField(): HTMLElement | null {
  return within(main()).queryByRole('textbox', { name: FIELD });
}

function button(name: string): HTMLElement {
  return within(main()).getByRole('button', { name });
}

function emptyButton(): HTMLElement {
  return button('Empty');
}

/** Whether a Cloudscape button refuses a press. */
function isDisabled(element: HTMLElement): boolean {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
}

function type(value: string) {
  fireEvent.change(field(), { target: { value } });
}

function pressEnter() {
  fireEvent.keyDown(field(), { key: 'Enter', keyCode: 13 });
}

function flashElement(): HTMLElement | undefined {
  return createWrapper(document.body).findFlashbar()?.getElement();
}

/** Whether the flash holds one item of `type` whose text is `text`. */
function flashHolds(type: 'success' | 'error', text: string): boolean {
  const flashbar = createWrapper(document.body).findFlashbar();
  const typed = flashbar?.findItemsByType(type) ?? [];
  return typed.length === 1 && typed[0]?.getElement().textContent === text;
}

/** The area's value elements inside `scope`, in order, each as its kind and its text (issue 467, R6). */
function kindsIn(scope: Element | null | undefined): [string, string][] {
  return [...(scope?.querySelectorAll('.aws-area-value') ?? [])].map((element) => [
    [...element.classList]
      .map((name) => /^aws-area-value-(address|name|fixed|text)$/.exec(name)?.[1])
      .find((kind) => kind !== undefined) ?? '',
    element.textContent,
  ]);
}

/** An answer held until the case lets it go. */
function held(): { answer: Promise<Answer>; release: (answer: Answer) => void } {
  let release: (answer: Answer) => void = () => undefined;
  const answer = new Promise<Answer>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

/** `n` objects of an unversioned bucket, keys `object-<i>`, version `null`. */
function objects(n: number, refused?: Item['refused']): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `object-${String(i).padStart(3, '0')}`,
    versionId: 'null',
    ...(refused === undefined ? {} : { refused }),
  }));
}

/** Opens the empty page of `alpha` holding `items` and waits for its field. */
async function openBucket(items: Item[] = []) {
  engine.buckets = [NAME];
  engine.contents[NAME] = items;
  const router = open();
  await waitFor(
    () => {
      expect(queryField()).not.toBeNull();
    },
    { timeout: 10_000 },
  );
  return router;
}

/** Types the name and presses "Empty". */
function startEmptying() {
  type(NAME);
  fireEvent.click(emptyButton());
}

/** The rows of the table "Could not be deleted", each as its cells' texts. */
function failureRows(): string[][] {
  const table = createWrapper(main()).findTable();
  expect(table?.findHeaderSlot()?.getElement()).toHaveTextContent('Could not be deleted');
  return (table?.findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')].map((cell) => cell.textContent),
  );
}

function wait(ms: number) {
  return act(() => new Promise((resolve) => setTimeout(resolve, ms)));
}

// ---------------------------------------------------------------------------------------------------------------

describe('the empty page as opened', () => {
  it('connected → h1, the two sentences with the name and the endpoint, the field with its label and placeholder, "Cancel", "Empty" disabled', async () => {
    await openBucket(objects(2));

    expect(screen.getByRole('heading', { level: 1, name: 'Empty bucket' })).toBeInTheDocument();
    expect(onPage(SENTENCE)).toBeInTheDocument();
    expect(onPage(RUNS_HERE)).toBeInTheDocument();
    expect(field()).toHaveAttribute('placeholder', NAME);
    expect(field().value).toBe('');
    expect(button('Cancel')).toBeInTheDocument();
    expect(isDisabled(emptyButton())).toBe(true);
  });

  it('only the bucket was read (ListBuckets with the name as prefix and one bucket at most), nothing listed', async () => {
    await openBucket(objects(2));
    await wait(50);

    const lists = engine.of('ListBuckets');
    expect(lists).toHaveLength(1);
    expect(lists[0]?.searchParams.get('prefix')).toBe(NAME);
    expect(lists[0]?.searchParams.get('max-buckets')).toBe('1');
    expect(engine.of('ListObjectVersions')).toHaveLength(0);
    expect(engine.of('DeleteObjects')).toHaveLength(0);
  });

  it('not connected → the sentence without an endpoint', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openBucket();

    expect(onPage(SENTENCE_NOT_CONNECTED)).toBeInTheDocument();
    expect(queryOnPage(SENTENCE)).toBeNull();
  });

  it('the sentence that names the bucket shows the name as a name, the endpoint as an address, the rest as free text; no constraint text under the field (issue 467, R4, R6)', async () => {
    await openBucket();

    expect(kindsIn(onPage(SENTENCE))).toEqual([
      ['text', 'Every object, object version and delete marker in bucket “'],
      ['name', NAME],
      ['text', '” will be deleted from your local emulator'],
      ['text', ' at '],
      ['address', EMULATOR_ENDPOINT],
      ['text', '. This cannot be undone.'],
    ]);
    const confirmation = createWrapper(main())
      .findAllFormFields()
      .find((found) => found.findLabel()?.getElement().textContent === FIELD);
    expect(confirmation).toBeDefined();
    expect(confirmation?.findConstraint()).toBeNull();
    expect(document.querySelector('.aws-s3-break-anywhere')).toBeNull();
  });
});

describe('the confirmation', () => {
  it('the name typed → "Empty" enabled', async () => {
    await openBucket();

    type(NAME);

    expect(isDisabled(emptyButton())).toBe(false);
  });

  it.each([
    ['the name in upper case', NAME.toUpperCase()],
    ['the name with a space after it', `${NAME} `],
    ['the name one character short', NAME.slice(0, -1)],
    ['another text', 'beta'],
  ])('%s → "Empty" disabled, and Enter sends nothing', async (_, text) => {
    await openBucket(objects(1));

    type(text);
    pressEnter();
    fireEvent.click(emptyButton());

    expect(isDisabled(emptyButton())).toBe(true);
    await wait(50);
    expect(engine.of('ListObjectVersions')).toHaveLength(0);
    expect(queryField()).not.toBeNull();
  });

  it('Enter with the name typed starts the emptying', async () => {
    await openBucket(objects(1));

    type(NAME);
    pressEnter();

    await waitFor(() => {
      expect(engine.of('ListObjectVersions').length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('heading', { level: 1, name: STATUS })).toBeInTheDocument();
  });
});

describe('"Empty"', () => {
  it('→ the h1 and the frame’s title "Empty bucket: Status", focus on the h1, the form gone, "Emptying the bucket" with "0 items deleted", the address unchanged', async () => {
    const router = await openBucket(objects(3));
    await waitFor(() => {
      expect(document.title).toBe('Empty bucket | EmuForge Studio');
    });
    const listing = held();
    engine.answers.ListObjectVersions = () => listing.answer;

    startEmptying();

    const h1 = await screen.findByRole('heading', { level: 1, name: STATUS });
    expect(document.activeElement).toBe(h1);
    expect(document.title).toBe(`${STATUS} | EmuForge Studio`);
    expect(queryField()).toBeNull();
    expect(within(main()).queryByRole('button', { name: 'Empty' })).toBeNull();
    expect(await findOnPage('Emptying the bucket')).toBeInTheDocument();
    expect(statusType('Emptying the bucket')).toBe('in-progress');
    expect(onPage('0 items deleted')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(EMPTY_PATH);
    // The emptying sends its first listing from the bucket's start, with 1000 keys at most.
    const [first] = engine.of('ListObjectVersions');
    expect(first?.searchParams.get('max-keys')).toBe('1000');
    expect(first?.searchParams.get('key-marker')).toBeNull();

    listing.release(versionsAnswer([]));
  });

  it('leaving the status puts the document title back to what the frame wrote', async () => {
    const router = await openBucket();
    await waitFor(() => {
      expect(document.title).toBe('Empty bucket | EmuForge Studio');
    });
    startEmptying();
    await waitFor(() => {
      expect(document.title).toBe(`${STATUS} | EmuForge Studio`);
    });

    await act(() => router.navigate(LIST_PATH));

    await waitFor(() => {
      expect(document.title).toBe('Buckets | EmuForge Studio');
    });
  });
});

describe('the result', () => {
  it('finishes with 3 deleted → the status and the flash read the success, the item sentence and the two links follow', async () => {
    await openBucket(objects(3));

    startEmptying();

    const result = `Bucket “${NAME}” is empty. 3 items deleted from the local emulator.`;
    expect(await findOnPage(result)).toBeInTheDocument();
    expect(statusType(result)).toBe('success');
    await waitFor(() => {
      expect(flashHolds('success', result)).toBe(true);
    });
    expect(onPage('3 items deleted')).toBeInTheDocument();
    expect(onPage(ITEM_MEANS)).toBeInTheDocument();
    const links = within(main())
      .getAllByRole('link')
      .filter((link) => link.closest('nav') === null && link.closest('.aws-area-emulator-line') === null);
    const deleteLink = links.find((link) => link.textContent === 'Delete bucket');
    const listLink = links.find((link) => link.textContent === 'General purpose buckets');
    expect(deleteLink).toHaveAttribute('href', `/aws/s3/bucket/${NAME}/delete`);
    expect(listLink).toHaveAttribute('href', LIST_PATH);
    expect((onPage(result).compareDocumentPosition(deleteLink as Node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(
      true,
    );
    expect(engine.contents[NAME]).toEqual([]);
  });

  it('"Delete bucket" of the status leads to the delete page of this bucket', async () => {
    const router = await openBucket(objects(1));
    startEmptying();
    await findOnPage(`Bucket “${NAME}” is empty. 1 item deleted from the local emulator.`);

    const deleteLink = within(main())
      .getAllByRole('link')
      .find((link) => link.textContent === 'Delete bucket') as HTMLElement;
    fireEvent.click(deleteLink);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/aws/s3/bucket/${NAME}/delete`);
    });
  });

  it('finishes with 1 deleted → "1 item deleted"', async () => {
    await openBucket(objects(1));

    startEmptying();

    const result = `Bucket “${NAME}” is empty. 1 item deleted from the local emulator.`;
    expect(await findOnPage(result)).toBeInTheDocument();
    expect(onPage('1 item deleted')).toBeInTheDocument();
    await waitFor(() => {
      expect(flashHolds('success', result)).toBe(true);
    });
  });

  it('with nothing to delete → "Bucket “alpha” was already empty."', async () => {
    await openBucket([]);

    startEmptying();

    const result = `Bucket “${NAME}” was already empty.`;
    expect(await findOnPage(result)).toBeInTheDocument();
    await waitFor(() => {
      expect(flashHolds('success', result)).toBe(true);
    });
    expect(engine.of('DeleteObjects')).toHaveLength(0);
  });

  it('finishes with 2 failed and 5 deleted → an error in the status and the flash, and the table "Could not be deleted" with its two rows', async () => {
    const refused = { code: 'AccessDenied', message: 'Access Denied because object protected by object lock.' };
    await openBucket([
      ...objects(5),
      { key: 'held-1', versionId: 'v1', refused },
      { key: 'held-2', versionId: 'v2', refused },
    ]);

    startEmptying();

    const result = `2 items could not be deleted from bucket “${NAME}”. 5 items deleted.`;
    expect(await findOnPage(result)).toBeInTheDocument();
    expect(statusType(result)).toBe('error');
    await waitFor(() => {
      expect(flashHolds('error', result)).toBe(true);
    });
    const table = createWrapper(main()).findTable();
    expect((table?.findColumnHeaders() ?? []).map((header) => header.getElement().textContent.trim())).toEqual([
      'Key',
      'Version ID',
      'Error',
    ]);
    expect(failureRows()).toEqual([
      ['held-1', 'v1', `AccessDenied: ${refused.message}`],
      ['held-2', 'v2', `AccessDenied: ${refused.message}`],
    ]);
    // The code as code; a key, a version id and a code as names, the message as free text (issue 467, R6).
    const errorCell = table?.findBodyCell(1, 3)?.getElement() as HTMLElement;
    expect(within(errorCell).getByText('AccessDenied').closest('code, [class*="awsui_code"]')).not.toBeNull();
    expect(kindsIn(errorCell)).toEqual([
      ['name', 'AccessDenied'],
      ['text', `: ${refused.message}`],
    ]);
    expect(kindsIn(table?.findBodyCell(1, 1)?.getElement())).toEqual([['name', 'held-1']]);
    expect(kindsIn(table?.findBodyCell(1, 2)?.getElement())).toEqual([['name', 'v1']]);
    // The result's sentence quotes the name as a name, in the status and in the flash.
    expect(kindsIn(onPage(result))).toEqual([
      ['text', '2 items could not be deleted from bucket “'],
      ['name', NAME],
      ['text', '”. 5 items deleted.'],
    ]);
    // A failed item is not sent again in the same run.
    expect(engine.of('DeleteObjects')).toHaveLength(1);
  });

  it('120 failures → the first 100 rows in the order met and "Showing 100 of 120"', async () => {
    await openBucket(objects(120, { code: 'AccessDenied', message: 'held' }));

    startEmptying();

    expect(
      await findOnPage(`120 items could not be deleted from bucket “${NAME}”. 0 items deleted.`),
    ).toBeInTheDocument();
    const rows = failureRows();
    expect(rows).toHaveLength(100);
    expect(rows.map(([key]) => key)).toEqual(objects(100).map(({ key }) => key));
    expect(onPage('Showing 100 of 120')).toBeInTheDocument();
  });

  it('a key <img src=x onerror=alert(1)> among the failures → shown as text', async () => {
    const key = '<img src=x onerror=alert(1)>';
    await openBucket([{ key, versionId: 'null', refused: { code: 'AccessDenied', message: '<b>no</b>' } }]);

    startEmptying();

    await findOnPage(`1 item could not be deleted from bucket “${NAME}”. 0 items deleted.`);
    expect(failureRows()).toEqual([[key, 'null', 'AccessDenied: <b>no</b>']]);
    expect(main().querySelector('img')).toBeNull();
    expect(main().querySelector('b')).toBeNull();
  });
});

describe('a request of the emptying that fails', () => {
  it('another code → "Emptying the bucket failed" with code and message, the count so far, "Retry"; "Retry" goes on and keeps the count', async () => {
    await openBucket(objects(3));
    // The first listing answers; the second fails, after the first delete.
    let listings = 0;
    engine.answers.ListObjectVersions = (url) => {
      listings += 1;
      // A code the SDK does not retry, so the page sees it.
      if (listings === 2) {
        return errorAnswer(400, 'InvalidRequest', 'something broke');
      }
      return versionsAnswer(engine.contents[bucketOf(url)]?.slice(0, listings === 1 ? 2 : undefined) ?? []);
    };

    startEmptying();

    expect(await findOnPage('Emptying the bucket failed')).toBeInTheDocument();
    expect(statusType('Emptying the bucket failed')).toBe('error');
    expect(main()).toHaveTextContent('InvalidRequest: something broke');
    expect(onPage('2 items deleted')).toBeInTheDocument();
    expect(button('Retry')).toBeInTheDocument();

    fireEvent.click(button('Retry'));

    const result = `Bucket “${NAME}” is empty. 3 items deleted from the local emulator.`;
    expect(await findOnPage(result)).toBeInTheDocument();
    expect(within(main()).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(engine.contents[NAME]).toEqual([]);
  });

  it.each([
    [
      '501',
      () => errorAnswer(501, 'NotImplemented', 'not implemented'),
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for ListObjectVersions.',
    ],
    [
      'AccessDenied',
      () => errorAnswer(403, 'AccessDenied', 'not for you'),
      'Access denied',
      'ListObjectVersions was refused: not for you',
    ],
    [
      'the engine’s EmulatorUnavailable',
      () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator at 127.0.0.1:9306 did not answer'),
      'The emulator did not answer',
      'the emulator at 127.0.0.1:9306 did not answer',
    ],
  ] as const)('%s → the words of R11.4, "0 items deleted" and "Retry"', async (_, answer, header, detail) => {
    await openBucket(objects(2));
    engine.answers.ListObjectVersions = answer;

    startEmptying();

    expect(await findOnPage(header)).toBeInTheDocument();
    expect(main()).toHaveTextContent(detail);
    expect(onPage('0 items deleted')).toBeInTheDocument();
    expect(button('Retry')).toBeInTheDocument();
  });

  it('DeleteObjects fails at the network level → "The EmuForge engine at <origin> did not answer" and "Retry"', async () => {
    await openBucket(objects(2));
    engine.answers.DeleteObjects = () => 'network-error';

    startEmptying();

    await waitFor(() => {
      expect(main()).toHaveTextContent(`The EmuForge engine at ${engineOrigin} did not answer`);
    });
    expect(onPage('0 items deleted')).toBeInTheDocument();
    expect(button('Retry')).toBeInTheDocument();
  });

  it('the listing answers "no such bucket" during the emptying → "Bucket not found"', async () => {
    await openBucket(objects(2));
    engine.buckets = [];

    startEmptying();

    expect(await findOnPage('Bucket not found')).toBeInTheDocument();
    expect(
      onPage(`The emulator holds no bucket named “${NAME}”. It may have been deleted, or the emulator restarted.`),
    ).toBeInTheDocument();
  });
});

describe('leaving the page', () => {
  it('while the emptying runs → no request is sent after the one in flight', async () => {
    const router = await openBucket(objects(3));
    const listing = held();
    engine.answers.ListObjectVersions = () => listing.answer;
    startEmptying();
    await waitFor(() => {
      expect(engine.of('ListObjectVersions')).toHaveLength(1);
    });

    await act(() => router.navigate(LIST_PATH));
    const sent = engine.sent.length;
    listing.release(versionsAnswer(engine.contents[NAME] ?? []));
    await wait(100);

    expect(engine.sent.slice(sent).filter(({ operation }) => operation !== 'ListBuckets')).toEqual([]);
    expect(engine.of('DeleteObjects')).toHaveLength(0);
    expect(engine.contents[NAME]).toHaveLength(3);
  });
});

describe('the empty page, its read', () => {
  it('no bucket of that name → "Bucket not found" in place of the form', async () => {
    open();

    expect(await findOnPage('Bucket not found')).toBeInTheDocument();
    expect(
      onPage(`The emulator holds no bucket named “${NAME}”. It may have been deleted, or the emulator restarted.`),
    ).toBeInTheDocument();
    expect(queryField()).toBeNull();
  });

  it('while the read is in flight → "Loading bucket", no form; then the form', async () => {
    engine.buckets = [NAME];
    const answer = held();
    engine.answers.ListBuckets = () => answer.answer;
    open();

    expect(await findOnPage('Loading bucket')).toBeInTheDocument();
    expect(queryField()).toBeNull();

    answer.release(listAnswer([NAME]));
    await waitFor(() => {
      expect(queryField()).not.toBeNull();
    });
  });

  it.each([
    [
      '501',
      () => errorAnswer(501, 'NotImplemented', 'not implemented'),
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for ListBuckets, so Studio cannot show the bucket.',
      'info',
    ],
    [
      'AccessDenied',
      () => errorAnswer(403, 'AccessDenied', 'not for you'),
      'Access denied',
      'ListBuckets was refused: not for you',
      'error',
    ],
    [
      'the engine’s EmulatorUnavailable while connected',
      () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator did not answer in time'),
      'The emulator did not answer',
      'the emulator did not answer in time',
      'error',
    ],
    [
      'another code',
      () => errorAnswer(500, 'InternalError', 'something broke'),
      'The bucket could not be read',
      'InternalError: something broke',
      'error',
    ],
  ] as const)('%s → its state with "Retry", no form', async (_, answer, first, second, status) => {
    engine.buckets = [NAME];
    engine.answers.ListBuckets = answer;
    open();

    expect(await findOnPage(first)).toBeInTheDocument();
    expect(onPage(second)).toBeInTheDocument();
    expect(statusType(first)).toBe(status);
    expect(button('Retry')).toBeInTheDocument();
    expect(queryField()).toBeNull();
  });

  it('at the network level → the engine sentence with its origin and "Retry"', async () => {
    engine.answers.ListBuckets = () => 'network-error';
    open();

    expect(await findOnPage(`The EmuForge engine at ${engineOrigin} did not answer`)).toBeInTheDocument();
    expect(button('Retry')).toBeInTheDocument();
  });

  it('while the connection is not started → the line’s words, "The bucket could not be read.", "Connection status", "Retry"', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    engine.answers.ListBuckets = () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator is not running');
    open();

    expect(await findOnPage('The bucket could not be read.')).toBeInTheDocument();
    expect(statusType(`Not started on port ${String(EMULATOR_PORT)}`)).toBe('stopped');
    expect(button('Retry')).toBeInTheDocument();
  });

  it('the connection becomes connected after a failed read, before "Empty" → the page reads again without any action', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    engine.buckets = [NAME];
    engine.answers.ListBuckets = () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator is not running');
    open();
    await findOnPage('The bucket could not be read.');
    const reads = engine.of('ListBuckets').length;

    delete engine.answers.ListBuckets;
    connection.set(connectedResult());

    await waitFor(() => {
      expect(queryField()).not.toBeNull();
    });
    expect(engine.of('ListBuckets').length).toBe(reads + 1);
  });

  it('after the connection was down while the form was shown, it reads again once connected: a restarted emulator’s "Bucket not found"', async () => {
    await openBucket();

    connection.set(notStartedResult());
    engine.buckets = [];
    connection.set(connectedResult());

    expect(await findOnPage('Bucket not found')).toBeInTheDocument();
  });

  it('a connection change after "Empty" reads nothing again: the status stays', async () => {
    await openBucket([]);
    startEmptying();
    await findOnPage(`Bucket “${NAME}” was already empty.`);
    const reads = engine.of('ListBuckets').length;

    connection.set(notStartedResult());
    connection.set(connectedResult());
    await wait(50);

    expect(engine.of('ListBuckets').length).toBe(reads);
    expect(screen.getByRole('heading', { level: 1, name: STATUS })).toBeInTheDocument();
  });
});

describe('"Cancel"', () => {
  it('the name typed, "Cancel": the list as before, no dialog; no request of the emptying was sent (issue 467, R7)', async () => {
    const router = await openBucket(objects(2));
    type(NAME);

    fireEvent.click(button('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(engine.of('ListObjectVersions')).toHaveLength(0);
    expect(engine.of('DeleteObjects')).toHaveLength(0);
    expect(engine.contents[NAME]).toHaveLength(2);
  });
});
