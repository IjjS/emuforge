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

// "Delete bucket" rendered inside the area's layout, as Studio's frame renders the area, against a fake engine behind
// the page's `fetch` (test-criteria.md, issue 256, "Unit — services/s3/pages/delete-bucket-page.test.tsx").

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  body: string;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

type Operation = 'ListBuckets' | 'ListObjectVersions' | 'DeleteBucket';

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

function versionsAnswer(items: string): Answer {
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?><ListVersionsResult><IsTruncated>false</IsTruncated>${items}</ListVersionsResult>`,
  };
}

const VERSION = '<Version><Key>a.txt</Key><VersionId>v1</VersionId></Version>';
const DELETE_MARKER = '<DeleteMarker><Key>gone.txt</Key><VersionId>m1</VersionId></DeleteMarker>';

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
  if (method === 'DELETE' && url.pathname !== '/' && queryKeys(url).every((key) => key === 'x-id')) {
    return 'DeleteBucket';
  }
  return 'other';
}

/** The bucket a request is sent to: the path's one segment, with or without a slash after it. */
function bucketOf(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\/|\/$/g, ''));
}

class FakeEngine {
  /** The buckets the emulator holds, names ascending. */
  buckets: string[] = [];
  /** What each bucket holds, as the items of a `ListVersionsResult`; none by default. */
  contents: Record<string, string> = {};
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
    const answer = await Promise.race([
      Promise.resolve(this.answer(operation, url)),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    // A 204 carries no body: the Fetch standard refuses one.
    return new Response(answer.status === 204 ? null : answer.body, { status: answer.status });
  };

  private answer(operation: Operation | 'other', url: URL): EngineAnswer {
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
          ? versionsAnswer(this.contents[bucket] ?? '')
          : errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
      case 'DeleteBucket':
        if (!this.buckets.includes(bucket)) {
          return errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
        }
        if ((this.contents[bucket] ?? '') !== '') {
          return errorAnswer(409, 'BucketNotEmpty', 'The bucket you tried to delete is not empty');
        }
        this.buckets = this.buckets.filter((name) => name !== bucket);
        return { status: 204, body: '' };
      case 'other':
        return errorAnswer(400, 'InvalidRequest', `not in this fake: ${url.href}`);
    }
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
let nextPort = 9600;
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

const NAME = 'alpha';
const DELETE_PATH = `/aws/s3/bucket/${NAME}/delete`;
const LIST_PATH = '/aws/s3/buckets';
const FIELD = 'To confirm deletion, enter the name of the bucket.';
const NOT_EMPTY = 'This bucket is not empty';
const NOT_EMPTY_TEXT =
  'A bucket can be deleted only when it holds no object, object version or delete marker. Empty it, then come back to this page.';
const SENTENCE = `Bucket “${NAME}” will be deleted from your local emulator at ${EMULATOR_ENDPOINT}. This cannot be undone.`;
const SENTENCE_NOT_CONNECTED = `Bucket “${NAME}” will be deleted from your local emulator. This cannot be undone.`;

function open(path = DELETE_PATH) {
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

/** The page's own element whose whole text is `text`: outside the emulator line, the notice and live regions. */
function onPage(text: string): HTMLElement {
  const found = within(main())
    .getAllByText(byWholeText(text))
    .filter(
      (element) => element.closest('.aws-area-emulator-line') === null && element.closest('[aria-live]') === null,
    );
  expect(found).toHaveLength(1);
  return found[0] as HTMLElement;
}

async function findOnPage(text: string): Promise<HTMLElement> {
  return waitFor(() => onPage(text), { timeout: 10_000 });
}

/** The type of the Cloudscape status indicator around `text` on the page. */
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

function field(): HTMLInputElement {
  return within(main()).getByRole('textbox', { name: FIELD }) as HTMLInputElement;
}

function queryField(): HTMLElement | null {
  return within(main()).queryByRole('textbox', { name: FIELD });
}

function button(name: string): HTMLElement {
  return within(main()).getByRole('button', { name });
}

function deleteButton(): HTMLElement {
  return button('Delete bucket');
}

/** Whether a Cloudscape button refuses a press: disabled, or `aria-disabled` while it shows progress. */
function isDisabled(element: HTMLElement): boolean {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
}

function type(value: string) {
  fireEvent.change(field(), { target: { value } });
}

function pressEnter() {
  fireEvent.keyDown(field(), { key: 'Enter', keyCode: 13 });
}

/** The alert "This bucket is not empty", or `null`. */
function notEmptyAlert(): HTMLElement | null {
  const alerts = createWrapper(main()).findAllAlerts();
  return alerts.map((alert) => alert.getElement()).find((alert) => alert.textContent.includes(NOT_EMPTY)) ?? null;
}

/** The failure shown above the buttons, once there is one: an alert of the form other than "This bucket is not empty". */
async function findFailure(): Promise<HTMLElement> {
  return waitFor(() => {
    const form = createWrapper(main()).findForm();
    expect(form).not.toBeNull();
    const alerts = (form?.findContent()?.findAllAlerts() ?? [])
      .map((alert) => alert.getElement())
      .filter((alert) => !alert.textContent.includes(NOT_EMPTY));
    expect(alerts).toHaveLength(1);
    return alerts[0] as HTMLElement;
  });
}

/** The items of the area's flash, each as its text. */
function flashItems(): string[] {
  const flashbar = createWrapper(document.body).findFlashbar();
  return (flashbar?.findItems() ?? []).map((item) => item.getElement().textContent);
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

/** Opens the delete page of an empty bucket `alpha` and waits for its field. */
async function openEmpty() {
  engine.buckets = [NAME];
  const router = open();
  await waitFor(
    () => {
      expect(queryField()).not.toBeNull();
    },
    { timeout: 10_000 },
  );
  return router;
}

/** Opens the delete page of `alpha` holding `items` and waits for the alert. */
async function openNotEmpty(items = VERSION) {
  engine.buckets = [NAME];
  engine.contents[NAME] = items;
  const router = open();
  await waitFor(
    () => {
      expect(notEmptyAlert()).not.toBeNull();
    },
    { timeout: 10_000 },
  );
  return router;
}

// ---------------------------------------------------------------------------------------------------------------

describe('the delete page of an empty bucket', () => {
  it('connected → h1, the sentence with the name and the endpoint, the field with its label and placeholder, "Cancel", "Delete bucket" disabled, no alert', async () => {
    await openEmpty();

    expect(screen.getByRole('heading', { level: 1, name: 'Delete bucket' })).toBeInTheDocument();
    expect(onPage(SENTENCE)).toBeInTheDocument();
    expect(field()).toHaveAttribute('placeholder', NAME);
    expect(field().value).toBe('');
    expect(button('Cancel')).toBeInTheDocument();
    expect(isDisabled(deleteButton())).toBe(true);
    expect(notEmptyAlert()).toBeNull();
  });

  it('not connected → the sentence without an endpoint', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    await openEmpty();

    expect(onPage(SENTENCE_NOT_CONNECTED)).toBeInTheDocument();
    expect(within(main()).queryByText(byWholeText(SENTENCE))).toBeNull();
  });

  it('reads ListBuckets with the name as prefix and one bucket at most, then ListObjectVersions with one key at most; nothing is deleted', async () => {
    await openEmpty();

    const [list] = engine.of('ListBuckets');
    expect(list?.searchParams.get('prefix')).toBe(NAME);
    expect(list?.searchParams.get('max-buckets')).toBe('1');
    const [versions] = engine.of('ListObjectVersions');
    expect(versions && bucketOf(versions)).toBe(NAME);
    expect(versions?.searchParams.get('max-keys')).toBe('1');
    expect(engine.of('DeleteBucket')).toHaveLength(0);
  });

  it('the sentence that names the bucket shows the name as a name, the endpoint as an address, the rest as free text; no constraint text under the field (issue 467, R4, R6)', async () => {
    await openEmpty();

    expect(kindsIn(onPage(SENTENCE))).toEqual([
      ['text', 'Bucket “'],
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
  it('the name typed → "Delete bucket" enabled', async () => {
    await openEmpty();

    type(NAME);

    expect(isDisabled(deleteButton())).toBe(false);
  });

  it.each([
    ['the name in upper case', NAME.toUpperCase()],
    ['the name with a space after it', `${NAME} `],
    ['the name with a space before it', ` ${NAME}`],
    ['the name one character short', NAME.slice(0, -1)],
  ])('%s → "Delete bucket" disabled', async (_, text) => {
    await openEmpty();

    type(text);

    expect(isDisabled(deleteButton())).toBe(true);
  });

  it('Enter in the field with the name typed → DeleteBucket is sent', async () => {
    await openEmpty();

    type(NAME);
    pressEnter();

    await waitFor(() => {
      expect(engine.of('DeleteBucket')).toHaveLength(1);
    });
    expect(bucketOf(engine.of('DeleteBucket')[0] as URL)).toBe(NAME);
  });

  it('Enter with another text → nothing is sent', async () => {
    await openEmpty();
    const sent = engine.sent.length;

    type(`${NAME}x`);
    pressEnter();
    fireEvent.click(deleteButton());

    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(engine.of('DeleteBucket')).toHaveLength(0);
    expect(engine.sent.length).toBe(sent);
  });
});

describe('the delete page of a bucket that is not empty', () => {
  it.each([
    ['a version', VERSION],
    ['only a delete marker', DELETE_MARKER],
  ])(
    'a bucket that holds %s → the alert with its sentence and "Empty bucket"; the field and "Delete bucket" disabled',
    async (_, items) => {
      await openNotEmpty(items);

      const alert = notEmptyAlert() as HTMLElement;
      expect(alert).toHaveTextContent(NOT_EMPTY);
      expect(alert).toHaveTextContent(NOT_EMPTY_TEXT);
      expect(within(alert).getByText('Empty bucket')).toBeInTheDocument();
      expect(field()).toBeDisabled();
      expect(isDisabled(deleteButton())).toBe(true);
    },
  );

  it('the alert sits before the field', async () => {
    await openNotEmpty();

    const alert = notEmptyAlert() as HTMLElement;
    expect(alert.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('"Empty bucket" leads to the empty page of this bucket; nothing is listed or deleted', async () => {
    const router = await openNotEmpty();
    const sent = engine.sent.length;
    const lists = engine.of('ListBuckets').length;
    const empty = within(notEmptyAlert() as HTMLElement)
      .getByText('Empty bucket')
      .closest('a, button') as HTMLElement;
    expect(empty).toHaveAttribute('href', `/aws/s3/bucket/${NAME}/empty`);

    fireEvent.click(empty);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/aws/s3/bucket/${NAME}/empty`);
    });
    // The empty page reads its bucket on opening (R8.1); once it has, nothing after the route change listed or
    // deleted anything (decisions.md, 2026-11-17 23:40).
    await waitFor(() => {
      expect(engine.of('ListBuckets').length).toBeGreaterThan(lists);
    });
    const after = engine.sent.slice(sent);
    expect(after.filter(({ operation }) => operation === 'DeleteBucket' || operation === 'ListObjectVersions')).toEqual(
      [],
    );
    expect(after.filter(({ url }) => queryKeys(url).includes('delete'))).toEqual([]);
  });

  it('Enter in the disabled field sends nothing', async () => {
    await openNotEmpty();

    fireEvent.keyDown(field(), { key: 'Enter', keyCode: 13 });

    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(engine.of('DeleteBucket')).toHaveLength(0);
  });
});

describe('"Delete bucket"', () => {
  it('succeeds → the list is opened with "Bucket “alpha” was deleted from the local emulator."', async () => {
    const router = await openEmpty();

    type(NAME);
    fireEvent.click(deleteButton());

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
    await waitFor(() => {
      expect(flashItems()).toEqual([`Bucket “${NAME}” was deleted from the local emulator.`]);
    });
    // The name as a name, the rest as free text (issue 467, R6).
    expect(kindsIn(createWrapper(document.body).findFlashbar()?.findItems()[0]?.getElement())).toEqual([
      ['text', 'Bucket “'],
      ['name', NAME],
      ['text', '” was deleted from the local emulator.'],
    ]);
    expect(engine.of('DeleteBucket')).toHaveLength(1);
    expect(engine.buckets).toEqual([]);
  });

  it('answers "bucket not empty" → the alert is shown, the field and the button disabled, focus on "Empty bucket"', async () => {
    const router = await openEmpty();
    type(NAME);

    engine.contents[NAME] = VERSION;
    fireEvent.click(deleteButton());

    await waitFor(() => {
      expect(notEmptyAlert()).not.toBeNull();
    });
    expect(field()).toBeDisabled();
    expect(isDisabled(deleteButton())).toBe(true);
    const empty = within(notEmptyAlert() as HTMLElement)
      .getByText('Empty bucket')
      .closest('a, button') as HTMLElement;
    await waitFor(() => {
      expect(document.activeElement).toBe(empty);
    });
    expect(router.state.location.pathname).toBe(DELETE_PATH);
    expect(engine.buckets).toEqual([NAME]);
  });

  it('answers "no such bucket" → "Bucket not found" in place of the form', async () => {
    await openEmpty();
    type(NAME);

    engine.buckets = [];
    fireEvent.click(deleteButton());

    expect(await findOnPage('Bucket not found')).toBeInTheDocument();
    expect(queryField()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Delete bucket' })).toBeInTheDocument();
  });

  it.each([
    [
      '501',
      () => errorAnswer(501, 'NotImplemented', 'not implemented'),
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for DeleteBucket.',
    ],
    [
      'AccessDenied',
      () => errorAnswer(403, 'AccessDenied', 'not for you'),
      'Access denied',
      'DeleteBucket was refused: not for you',
    ],
    [
      'the engine’s EmulatorUnavailable',
      () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator at 127.0.0.1:9306 did not answer'),
      'The emulator did not answer',
      'the emulator at 127.0.0.1:9306 did not answer',
    ],
    [
      'another code',
      () => errorAnswer(500, 'InternalError', 'something broke'),
      'Deleting the bucket failed',
      'InternalError: something broke',
    ],
  ] as const)(
    'fails with %s → the failure above the buttons in the words of R11.4; the page stays with what was typed',
    async (_, answer, header, detail) => {
      const router = await openEmpty();
      type(NAME);

      engine.answers.DeleteBucket = answer;
      fireEvent.click(deleteButton());

      const failure = await findFailure();
      expect(failure).toHaveTextContent(header);
      expect(failure).toHaveTextContent(detail);
      expect(failure.compareDocumentPosition(deleteButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(field().value).toBe(NAME);
      expect(isDisabled(deleteButton())).toBe(false);
      expect(router.state.location.pathname).toBe(DELETE_PATH);
    },
  );

  it('fails at the network level → "The EmuForge engine at <origin> did not answer"; the page stays', async () => {
    await openEmpty();
    type(NAME);

    engine.answers.DeleteBucket = () => 'network-error';
    fireEvent.click(deleteButton());

    const failure = await findFailure();
    expect(failure).toHaveTextContent(`The EmuForge engine at ${engineOrigin} did not answer`);
    expect(field().value).toBe(NAME);
  });

  it('while DeleteBucket is in flight → the button is disabled and shows progress; a second press and Enter send nothing', async () => {
    const router = await openEmpty();
    type(NAME);
    const answer = held();
    engine.answers.DeleteBucket = () => answer.answer;

    fireEvent.click(deleteButton());
    fireEvent.click(deleteButton());
    pressEnter();

    await waitFor(() => {
      expect(isDisabled(deleteButton())).toBe(true);
    });
    expect(within(main()).getByText('Deleting the bucket')).toBeInTheDocument();
    pressEnter();
    fireEvent.click(deleteButton());
    expect(engine.of('DeleteBucket')).toHaveLength(1);

    answer.release({ status: 204, body: '' });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
    expect(engine.of('DeleteBucket')).toHaveLength(1);
  });
});

describe('the delete page, its read', () => {
  it('no bucket of that name → "Bucket not found" in place of the form', async () => {
    open();

    expect(await findOnPage('Bucket not found')).toBeInTheDocument();
    expect(
      kindsIn(
        onPage(`The emulator holds no bucket named “${NAME}”. It may have been deleted, or the emulator restarted.`),
      ),
    ).toEqual([
      ['text', 'The emulator holds no bucket named “'],
      ['name', NAME],
      ['text', '”. It may have been deleted, or the emulator restarted.'],
    ]);
    expect(queryField()).toBeNull();
    expect(engine.of('ListObjectVersions')).toHaveLength(0);
  });

  it('while the read is in flight → "Loading bucket", no form; then the form', async () => {
    engine.buckets = [NAME];
    const answer = held();
    engine.answers.ListObjectVersions = () => answer.answer;
    open();

    expect(await findOnPage('Loading bucket')).toBeInTheDocument();
    expect(queryField()).toBeNull();

    answer.release(versionsAnswer(''));
    await waitFor(() => {
      expect(queryField()).not.toBeNull();
    });
  });

  it.each([
    [
      '501 of ListBuckets',
      'ListBuckets' as const,
      () => errorAnswer(501, 'NotImplemented', 'not implemented'),
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for ListBuckets, so Studio cannot show the bucket.',
      'info',
    ],
    [
      '501 of ListObjectVersions',
      'ListObjectVersions' as const,
      () => errorAnswer(501, 'NotImplemented', 'not implemented'),
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for ListObjectVersions, so Studio cannot show the bucket.',
      'info',
    ],
    [
      'AccessDenied',
      'ListBuckets' as const,
      () => errorAnswer(403, 'AccessDenied', 'not for you'),
      'Access denied',
      'ListBuckets was refused: not for you',
      'error',
    ],
    [
      'the engine’s EmulatorUnavailable while connected',
      'ListObjectVersions' as const,
      () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator did not answer in time'),
      'The emulator did not answer',
      'the emulator did not answer in time',
      'error',
    ],
    [
      'another code',
      'ListBuckets' as const,
      () => errorAnswer(500, 'InternalError', 'something broke'),
      'The bucket could not be read',
      'InternalError: something broke',
      'error',
    ],
  ])('%s → its state with "Retry", no form', async (_, operation, answer, first, second, status) => {
    engine.buckets = [NAME];
    engine.answers[operation] = answer;
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
    const recovery = within(main())
      .getAllByRole('link', { name: 'Connection status' })
      .find((link) => link.closest('.aws-area-emulator-line') === null);
    expect(recovery).toHaveAttribute('href', '/');
    expect(button('Retry')).toBeInTheDocument();
  });

  it('"Retry" reads again', async () => {
    engine.buckets = [NAME];
    engine.answers.ListBuckets = () => errorAnswer(500, 'InternalError', 'something broke');
    open();
    await findOnPage('The bucket could not be read');
    const reads = engine.of('ListBuckets').length;

    delete engine.answers.ListBuckets;
    fireEvent.click(button('Retry'));

    await waitFor(() => {
      expect(queryField()).not.toBeNull();
    });
    expect(engine.of('ListBuckets').length).toBe(reads + 1);
  });

  it('the connection becomes connected after a failed read → the page reads again without any action', async () => {
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
    await openEmpty();

    connection.set(notStartedResult());
    engine.buckets = [];
    connection.set(connectedResult());

    expect(await findOnPage('Bucket not found')).toBeInTheDocument();
  });
});

describe('"Cancel"', () => {
  it('the name typed, "Cancel": the list as before, no dialog; no DeleteBucket was sent (issue 467, R7)', async () => {
    const router = await openEmpty();
    type(NAME);

    fireEvent.click(button('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(engine.of('DeleteBucket')).toHaveLength(0);
    expect(engine.buckets).toEqual([NAME]);
  });
});
