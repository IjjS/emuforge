import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import AwsArea from '../../../index';

// "Create bucket" rendered inside the area's layout, as Studio's frame renders the area, against a fake engine behind
// the page's `fetch` (test-criteria.md, issue 256, "Unit — services/s3/pages/create-bucket-page.test.tsx").

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  body: string;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

type Operation =
  'ListBuckets' | 'CreateBucket' | 'PutPublicAccessBlock' | 'PutBucketVersioning' | 'PutBucketEncryption';

interface Sent {
  operation: Operation | 'other';
  url: URL;
  body: string;
}

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${xml(code)}</Code><Message>${xml(message)}</Message></Error>`,
  };
}

const OK: Answer = { status: 200, body: '' };

function listAnswer(names: string[]): Answer {
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>${names
      .map((name) => `<Bucket><Name>${xml(name)}</Name><BucketRegion>us-east-1</BucketRegion></Bucket>`)
      .join('')}</Buckets></ListAllMyBucketsResult>`,
  };
}

/** The query's keys of a request (`/alpha?versioning` → `versioning`). */
function queryKeys(url: URL): string[] {
  return (url.search.slice(1) === '' ? [] : url.search.slice(1).split('&')).map((pair) =>
    decodeURIComponent(pair.split('=')[0] ?? ''),
  );
}

function operationOf(method: string, url: URL): Operation | 'other' {
  const keys = queryKeys(url);
  if (method === 'GET' && url.pathname === '/' && url.searchParams.get('x-id') === 'ListBuckets') {
    return 'ListBuckets';
  }
  if (method !== 'PUT' || url.pathname === '/') {
    return 'other';
  }
  if (keys.includes('publicAccessBlock')) {
    return 'PutPublicAccessBlock';
  }
  if (keys.includes('versioning')) {
    return 'PutBucketVersioning';
  }
  if (keys.includes('encryption')) {
    return 'PutBucketEncryption';
  }
  return keys.every((key) => key === 'x-id') ? 'CreateBucket' : 'other';
}

class FakeEngine {
  /** The buckets the emulator holds, names ascending. */
  buckets: string[] = [];
  /** Every AWS request, in the order sent. */
  readonly sent: Sent[] = [];
  /** The answer of each operation; by default the emulator's. */
  answers: Partial<Record<Operation, () => EngineAnswer>> = {};

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'token-1' }), { status: 200 });
    }
    const operation = operationOf(request.method, url);
    this.sent.push({ operation, url, body: await request.text() });
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
    return new Response(answer.body, { status: answer.status });
  };

  private answer(operation: Operation | 'other', url: URL): EngineAnswer {
    const given = operation === 'other' ? undefined : this.answers[operation];
    if (given !== undefined) {
      return given();
    }
    switch (operation) {
      case 'ListBuckets': {
        const size = Number(url.searchParams.get('max-buckets') ?? '1000');
        const prefix = url.searchParams.get('prefix') ?? '';
        return listAnswer(this.buckets.filter((name) => name.startsWith(prefix)).slice(0, size));
      }
      case 'other':
        return errorAnswer(400, 'InvalidRequest', `not in this fake: ${url.href}`);
      default:
        return OK;
    }
  }

  /** The operations sent so far, in order. */
  get operations(): string[] {
    return this.sent.map(({ operation }) => operation);
  }

  of(operation: Operation): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

const EMULATOR_PORT = 9305;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9400;
let engine: FakeEngine;
let engineOrigin: string;

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
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
      connection={{ result: connectedResult(), engineOrigin }}
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CREATE_PATH = '/aws/s3/bucket/create';
const LIST_PATH = '/aws/s3/buckets';

async function open(path = CREATE_PATH) {
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
  await screen.findByRole('heading', { level: 1, name: 'Create bucket' }, { timeout: 10_000 });
  return router;
}

// ---------------------------------------------------------------------------------------------------------------
// Readers and actions.
// ---------------------------------------------------------------------------------------------------------------

const SSE_S3 = 'Server-side encryption with Amazon S3 managed keys (SSE-S3)';
const SSE_KMS = 'Server-side encryption with AWS Key Management Service keys (SSE-KMS)';
const DSSE_KMS = 'Dual-layer server-side encryption with AWS Key Management Service (AWS KMS) keys (DSSE-KMS)';
const BLOCKS = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'];
const SECTIONS = [
  'General configuration',
  'Object Ownership',
  'Block Public Access settings for this bucket',
  'Bucket Versioning',
  'Tags',
  'Default encryption',
  'Advanced settings',
];
const KMS_ARN = 'arn:aws:kms:us-east-1:000000000000:key/k';

function main(): HTMLElement {
  return screen.getByRole('main');
}

/** The form, which holds every section, field and button of the page below its \`h1\`. */
function theForm(): HTMLElement {
  const form = main().querySelector('form');
  expect(form).not.toBeNull();
  return form as HTMLElement;
}

/** The failure shown above the buttons, once there is one. */
async function findFailure(): Promise<HTMLElement> {
  return waitFor(() => {
    const alert = createWrapper(theForm()).findAlert();
    expect(alert).not.toBeNull();
    return alert?.getElement() as HTMLElement;
  });
}

function field(name: string): HTMLInputElement {
  return within(main()).getByRole('textbox', { name }) as HTMLInputElement;
}

function group(name: string): HTMLElement {
  return within(main()).getByRole('radiogroup', { name });
}

function radio(groupName: string, choice: string): HTMLInputElement {
  return within(group(groupName)).getByRole('radio', { name: choice }) as HTMLInputElement;
}

/** The label of the chosen item of the radio group `groupName`. */
function chosenLabel(groupName: string): string | undefined {
  const item = within(group(groupName))
    .getAllByRole('radio')
    .find((element) => (element as HTMLInputElement).checked);
  if (item === undefined) {
    return undefined;
  }
  const labelledBy = item.getAttribute('aria-labelledby') ?? '';
  return labelledBy
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

function checkbox(name: string): HTMLInputElement {
  return within(main()).getByRole('checkbox', { name }) as HTMLInputElement;
}

function button(name: string): HTMLElement {
  return within(main()).getByRole('button', { name });
}

function type(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

function keys(): HTMLInputElement[] {
  return within(main()).queryAllByRole('textbox', { name: 'Key' }) as HTMLInputElement[];
}

function values(): HTMLInputElement[] {
  return within(main()).queryAllByRole('textbox', { name: 'Value' }) as HTMLInputElement[];
}

function create() {
  fireEvent.click(button('Create bucket'));
}

/** The accessible description of `element`: its field's description and message. */
function description(element: HTMLElement): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

/** The items of the area's flash, each as its text. */
function flashItems(): string[] {
  const flashbar = createWrapper(document.body).findFlashbar();
  return (flashbar?.findItems() ?? []).map((item) => item.getElement().textContent ?? '');
}

/** Opens the form, types `name`, and leaves every other value as at start. */
async function openWithName(name = 'my-bucket') {
  const router = await open();
  type(field('Bucket name'), name);
  return router;
}

/** Waits until the list is shown at its route. */
async function expectList(router: Awaited<ReturnType<typeof open>>) {
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(LIST_PATH);
  });
  await screen.findByRole('heading', { level: 1, name: /Buckets/ });
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

describe('the create form, as opened', () => {
  it('h1, description, the seven sections in order, every start value, the buttons; no request', async () => {
    await open();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create bucket');
    expect(
      within(main()).getByText('The bucket is created in your local emulator, not in an AWS account.'),
    ).toBeInTheDocument();
    const headings = within(theForm())
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent.trim());
    expect(headings).toEqual(SECTIONS);

    const region = field('Region');
    expect(region.value).toBe('US East (N. Virginia) us-east-1');
    expect(region).toHaveAttribute('readonly');
    expect(description(region)).toContain('Studio creates buckets in this Region of the emulator.');
    expect(field('Bucket name').value).toBe('');
    expect(chosenLabel('Object Ownership')).toBe('Bucket owner enforced');
    for (const block of BLOCKS) {
      expect(checkbox(block).checked).toBe(true);
    }
    expect(chosenLabel('Bucket Versioning')).toBe('Disable');
    expect(keys()).toHaveLength(0);
    expect(chosenLabel('Encryption type')).toBe(SSE_S3);
    expect(within(main()).queryByRole('textbox', { name: 'AWS KMS key' })).toBeNull();
    expect(within(main()).queryByRole('radiogroup', { name: 'Bucket Key' })).toBeNull();
    const advanced = within(main()).getByRole('button', { name: 'Advanced settings' });
    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    expect(chosenLabel('Object Lock')).toBe('Disable');
    expect(button('Cancel')).toBeInTheDocument();
    expect(button('Create bucket')).toBeInTheDocument();
    expect(engine.sent).toEqual([]);
  });

  it('?encryption=sse-kms → SSE-KMS, "AWS KMS key" empty, "Bucket Key" at "Enable"; ?encryption=other → as opened', async () => {
    await open(`${CREATE_PATH}?encryption=sse-kms`);
    expect(chosenLabel('Encryption type')).toBe(SSE_KMS);
    expect(field('AWS KMS key').value).toBe('');
    expect(chosenLabel('Bucket Key')).toBe('Enable');
  });

  it('?encryption=other → SSE-S3, neither "AWS KMS key" nor "Bucket Key"', async () => {
    await open(`${CREATE_PATH}?encryption=other`);
    expect(chosenLabel('Encryption type')).toBe(SSE_S3);
    expect(within(main()).queryByRole('textbox', { name: 'AWS KMS key' })).toBeNull();
    expect(within(main()).queryByRole('radiogroup', { name: 'Bucket Key' })).toBeNull();
  });
});

describe('the create form, its fields', () => {
  it('DSSE-KMS → "AWS KMS key" shown, "Bucket Key" not; SSE-S3 → neither', async () => {
    await open();
    fireEvent.click(radio('Encryption type', DSSE_KMS));
    expect(field('AWS KMS key')).toBeInTheDocument();
    expect(description(field('AWS KMS key'))).toContain('The ARN of a KMS key in the emulator.');
    expect(within(main()).queryByRole('radiogroup', { name: 'Bucket Key' })).toBeNull();
    fireEvent.click(radio('Encryption type', SSE_S3));
    expect(within(main()).queryByRole('textbox', { name: 'AWS KMS key' })).toBeNull();
    expect(within(main()).queryByRole('radiogroup', { name: 'Bucket Key' })).toBeNull();
  });

  it('"Add tag" → "Key", "Value" and "Remove"; "Remove" → gone; with 50 tags "Add tag" is disabled with the reason', async () => {
    await open();
    fireEvent.click(button('Add tag'));
    expect(keys()).toHaveLength(1);
    expect(values()).toHaveLength(1);
    fireEvent.click(button('Remove'));
    expect(keys()).toHaveLength(0);
    expect(within(main()).queryByRole('button', { name: 'Remove' })).toBeNull();

    for (let i = 0; i < 50; i++) {
      fireEvent.click(button('Add tag'));
    }
    expect(keys()).toHaveLength(50);
    expect(button('Add tag')).toHaveAttribute('aria-disabled', 'true');
    expect(within(main()).getByText('A bucket can have up to 50 tags.')).toBeInTheDocument();
  });

  it('Object Lock "Enable" → versioning "Enable", not changeable, the sentence; "Disable" → changeable, still "Enable"', async () => {
    await open();
    fireEvent.click(radio('Object Lock', 'Enable'));
    expect(chosenLabel('Bucket Versioning')).toBe('Enable');
    expect(description(group('Bucket Versioning'))).toContain('Object Lock enables Bucket Versioning.');
    fireEvent.click(radio('Bucket Versioning', 'Disable'));
    expect(chosenLabel('Bucket Versioning')).toBe('Enable');

    fireEvent.click(radio('Object Lock', 'Disable'));
    expect(chosenLabel('Bucket Versioning')).toBe('Enable');
    expect(within(main()).queryByText('Object Lock enables Bucket Versioning.')).toBeNull();
    fireEvent.click(radio('Bucket Versioning', 'Disable'));
    expect(chosenLabel('Bucket Versioning')).toBe('Disable');
  });
});

describe('the create form, its messages', () => {
  it('an empty name → "Enter a bucket name." under the field, focus on it, no request; three spaces → the characters', async () => {
    await open();
    create();
    const name = field('Bucket name');
    await waitFor(() => {
      expect(description(name)).toContain('Enter a bucket name.');
    });
    expect(name).toHaveFocus();
    expect(engine.sent).toEqual([]);

    type(name, '   ');
    create();
    await waitFor(() => {
      expect(description(name)).toContain('Use only lowercase letters, digits, periods (.) and hyphens (-).');
    });
    expect(engine.sent).toEqual([]);
  });

  it('an invalid name and a tag with an empty key → both messages, focus on the name; name corrected → focus on the key', async () => {
    await open();
    type(field('Bucket name'), 'AB');
    fireEvent.click(button('Add tag'));
    create();
    await waitFor(() => {
      expect(description(field('Bucket name'))).toContain('The name must have 3 to 63 characters.');
    });
    expect(description(keys()[0] as HTMLElement)).toContain('Enter a key.');
    expect(field('Bucket name')).toHaveFocus();

    type(field('Bucket name'), 'my-bucket');
    create();
    await waitFor(() => {
      expect(keys()[0]).toHaveFocus();
    });
    expect(description(field('Bucket name'))).not.toContain('The name');
    expect(engine.sent).toEqual([]);
  });
});

describe('the create form, its requests', () => {
  it('a valid form, no such bucket → the name check, CreateBucket, the settings in order, then the list with the item', async () => {
    const router = await openWithName();
    fireEvent.click(checkbox('BlockPublicPolicy'));
    fireEvent.click(radio('Bucket Versioning', 'Enable'));
    fireEvent.click(radio('Encryption type', SSE_KMS));
    type(field('AWS KMS key'), KMS_ARN);
    create();

    await expectList(router);
    expect(engine.operations.slice(0, 5)).toEqual([
      'ListBuckets',
      'CreateBucket',
      'PutPublicAccessBlock',
      'PutBucketVersioning',
      'PutBucketEncryption',
    ]);
    const check = engine.of('ListBuckets')[0]?.url;
    expect(check?.searchParams.get('prefix')).toBe('my-bucket');
    expect(check?.searchParams.get('max-buckets')).toBe('1');
    expect(engine.of('CreateBucket')[0]?.url.pathname).toMatch(/^\/my-bucket\/?$/);
    await waitFor(() => {
      expect(flashItems()).toEqual(['Bucket “my-bucket” was created in the local emulator.']);
    });
  });

  it('the emulator already holds the name → the message under the field with focus, no CreateBucket', async () => {
    engine.buckets = ['my-bucket'];
    await openWithName();
    create();
    await waitFor(() => {
      expect(description(field('Bucket name'))).toContain('The emulator already holds a bucket named “my-bucket”.');
    });
    expect(field('Bucket name')).toHaveFocus();
    expect(engine.of('CreateBucket')).toEqual([]);
  });

  it('a name the user gives sits in the area’s breaking element: the field’s message and the flash item', async () => {
    const long = 'a'.repeat(63);
    engine.buckets = [long];
    const router = await openWithName(long);
    create();
    const message = await within(theForm()).findByText(`The emulator already holds a bucket named “${long}”.`);
    expect(message.closest('.aws-s3-break-anywhere')).not.toBeNull();

    engine.buckets = [];
    create();
    await expectList(router);
    const item = await screen.findByText(`Bucket “${long}” was created in the local emulator.`);
    expect(item.closest('.aws-s3-break-anywhere')).not.toBeNull();
  });

  it('the name check fails with another code → the form keeps its values, "Checking the bucket name failed"; no CreateBucket', async () => {
    engine.answers.ListBuckets = () => errorAnswer(500, 'InternalError', 'the emulator broke');
    await openWithName();
    fireEvent.click(radio('Object Ownership', 'Object writer'));
    create();
    const alert = await findFailure();
    expect(alert).toHaveTextContent('Checking the bucket name failed');
    expect(alert).toHaveTextContent('InternalError: the emulator broke');
    expect(field('Bucket name').value).toBe('my-bucket');
    expect(chosenLabel('Object Ownership')).toBe('Object writer');
    expect(engine.of('CreateBucket')).toEqual([]);
    // Above the buttons.
    expect(alert.compareDocumentPosition(button('Cancel')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each<[string, () => EngineAnswer, string, string | undefined]>([
    [
      '501',
      () => errorAnswer(501, 'NotImplemented', 'not here'),
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for CreateBucket.',
    ],
    [
      'AccessDenied',
      () => errorAnswer(403, 'AccessDenied', 'no way'),
      'Access denied',
      'CreateBucket was refused: no way',
    ],
    [
      'EmulatorUnavailable',
      () => errorAnswer(503, 'EmulatorUnavailable', 'the emulator is not running'),
      'The emulator did not answer',
      'the emulator is not running',
    ],
    ['the network', () => 'network-error', 'The EmuForge engine at ', undefined],
    [
      'another code',
      () => errorAnswer(400, 'InvalidBucketName', 'bad name'),
      'Creating the bucket failed',
      'InvalidBucketName: bad name',
    ],
  ])('CreateBucket fails with %s → its failure, the values kept, no setting sent', async (_, answer, first, second) => {
    engine.answers.CreateBucket = answer;
    await openWithName();
    fireEvent.click(radio('Bucket Versioning', 'Enable'));
    create();

    const shown = await findFailure();
    const text = shown.textContent;
    expect(text).toContain(first);
    if (second !== undefined) {
      expect(text).toContain(second);
    } else {
      expect(text).toContain(`The EmuForge engine at ${engineOrigin} did not answer`);
    }
    const kind = first.startsWith('Not implemented') ? 'info' : 'error';
    expect(shown.outerHTML).toMatch(new RegExp(`type-${kind}`));
    expect(field('Bucket name').value).toBe('my-bucket');
    expect(chosenLabel('Bucket Versioning')).toBe('Enable');
    // The client may send a request again that the engine could not pass on; no setting is ever sent.
    expect(new Set(engine.operations)).toEqual(new Set(['ListBuckets', 'CreateBucket']));
  });

  it('CreateBucket succeeds and versioning fails → the list with the success item and one error item; encryption still sent', async () => {
    engine.answers.PutBucketVersioning = () => errorAnswer(400, 'MalformedXML', 'bad versioning');
    const router = await openWithName();
    fireEvent.click(radio('Bucket Versioning', 'Enable'));
    fireEvent.click(radio('Encryption type', DSSE_KMS));
    type(field('AWS KMS key'), KMS_ARN);
    create();

    await expectList(router);
    expect(engine.of('PutBucketEncryption')).toHaveLength(1);
    await waitFor(() => {
      expect(flashItems()).toHaveLength(2);
    });
    const [success, failure] = flashItems();
    expect(success).toBe('Bucket “my-bucket” was created in the local emulator.');
    expect(failure).toContain('Enabling Bucket Versioning failed');
    expect(failure).toContain('MalformedXML: bad versioning');
    expect(failure?.endsWith('The bucket was created without it.')).toBe(true);
  });

  it('all three settings fail → the success item and three error items, in the order sent', async () => {
    engine.answers.PutPublicAccessBlock = () => errorAnswer(400, 'A', 'a');
    engine.answers.PutBucketVersioning = () => errorAnswer(400, 'B', 'b');
    engine.answers.PutBucketEncryption = () => errorAnswer(400, 'C', 'c');
    const router = await openWithName();
    fireEvent.click(checkbox('RestrictPublicBuckets'));
    fireEvent.click(radio('Bucket Versioning', 'Enable'));
    fireEvent.click(radio('Encryption type', SSE_KMS));
    type(field('AWS KMS key'), KMS_ARN);
    create();

    await expectList(router);
    await waitFor(() => {
      expect(flashItems()).toHaveLength(4);
    });
    const items = flashItems();
    expect(items[0]).toBe('Bucket “my-bucket” was created in the local emulator.');
    expect(items[1]).toContain('Applying the Block Public Access settings failed');
    expect(items[2]).toContain('Enabling Bucket Versioning failed');
    expect(items[3]).toContain('Applying the default encryption failed');
    for (const item of items.slice(1)) {
      expect(item.endsWith('The bucket was created without it.')).toBe(true);
    }
  });

  it('while the requests are in flight → "Create bucket" disabled with progress, focus stays, a second press sends nothing', async () => {
    const check = held();
    engine.answers.ListBuckets = () => check.answer;
    const router = await openWithName();
    const submit = button('Create bucket');
    submit.focus();
    create();
    create();
    await waitFor(() => {
      expect(engine.of('ListBuckets')).toHaveLength(1);
    });
    const progress = button('Create bucket');
    expect(progress).toHaveAttribute('aria-disabled', 'true');
    expect(within(progress.parentElement as HTMLElement).getByText('Creating the bucket')).toBeInTheDocument();
    expect(progress).toHaveFocus();
    fireEvent.click(progress);
    expect(engine.of('ListBuckets')).toHaveLength(1);

    await act(async () => {
      check.release(listAnswer([]));
      await Promise.resolve();
    });
    await expectList(router);
    expect(engine.of('CreateBucket')).toHaveLength(1);
  });

  it('"Cancel" → the list, and no request of the form was sent', async () => {
    const router = await openWithName();
    fireEvent.click(button('Cancel'));
    await expectList(router);
    expect(engine.of('CreateBucket')).toEqual([]);
    expect(engine.of('ListBuckets').some((sent) => sent.url.searchParams.get('prefix') === 'my-bucket')).toBe(false);
  });
});
