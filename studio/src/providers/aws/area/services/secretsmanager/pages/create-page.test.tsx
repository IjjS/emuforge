import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryClient, QueryClientProvider, useIsFetching } from '@tanstack/react-query';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';

import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import { SECRET_CREATE_PATH, SECRETS_PATH, secretPath } from '../paths';
import { useSecretDetail, useSecretListing } from '../queries';

const NAME = 'dev/key';
const STRING_VALUE = '  synthetic value\nwith whitespace  ';
const NEW_KEY = 'arn:aws:kms:us-east-1:000000000000:key/replacement';
const REFUSED = 'Local policy refused this operation.';
const STORED = `Secret ${NAME} was stored.`;
const PAGE = createWrapper(document.body);
let nextPort = 8750;

type Reply = { body: unknown; status?: number };
type Handler = (operation: string) => Reply | Promise<Reply> | undefined;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => vi.unstubAllGlobals());

function ReadObservers({ connection }: { connection: AreaConnection }) {
  const list = useSecretListing(connection, false);
  const detail = useSecretDetail(connection, NAME);
  const fetchingList = useIsFetching({ queryKey: ['aws', 'secretsmanager', 'ListSecrets'] }) > 0;
  return (
    <>
      <output aria-label="List read" aria-busy={fetchingList}>
        {JSON.stringify(list.items)}
      </output>
      <output aria-label="Detail read" aria-busy={detail.loading}>
        {detail.failure?.kind === 'other' ? detail.failure.code : detail.details?.Description}
      </output>
    </>
  );
}

function openCreate({ handler, observe = false }: { handler?: Handler; observe?: boolean } = {}) {
  const connection: AreaConnection = {
    engineOrigin: `http://127.0.0.1:${String(nextPort++)}`,
    result: {
      kind: 'connected',
      checkedAt: Date.now(),
      emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' },
    },
  };
  const calls = vi.fn<(operation: string, body: unknown) => void>();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
    if (new URL(request.url).pathname === '/__emuforge/session') return reply({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1) ?? '';
    calls(operation, await request.json());
    const answer = await handler?.(operation);
    if (answer) return reply(answer.body, answer.status);
    return reply(operation === 'ListSecrets' ? { SecretList: [] } : { Name: NAME });
  });
  function Frame() {
    const { pathname } = useLocation();
    const [visit, setVisit] = useState({ pathname, count: 0 });
    const latest = pathname === visit.pathname ? visit : { pathname, count: visit.count + 1 };
    if (latest !== visit) setVisit(latest);
    return (
      <>
        {observe && <ReadObservers connection={connection} />}
        <AwsArea
          headerSelector="#top-bar"
          connection={connection}
          targetGeneration={0}
          routeChanges={latest.count}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
      </>
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [SECRET_CREATE_PATH] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    calls,
    count: (operation: string) => calls.mock.calls.filter(([name]) => name === operation).length,
    router,
  };
}

function field(label: string) {
  const found = PAGE.findAllFormFields().find((item) => item.findLabel()?.getElement().textContent === label);
  if (!found) throw new Error(`Missing field ${label}`);
  return found;
}

function input(label: string) {
  const found = field(label);
  const control =
    found.findControl()?.findInput()?.findNativeInput() ?? found.findControl()?.findTextarea()?.findNativeTextarea();
  if (!control) throw new Error(`Missing input for ${label}`);
  return control.getElement();
}

function enter(label: string, value: string) {
  fireEvent.change(input(label), { target: { value } });
}

function chooseValueType(value: 'string' | 'binary') {
  const option = field('Value type').findControl()?.findRadioGroup()?.findInputByValue(value);
  if (!option) throw new Error(`Missing value type ${value}`);
  fireEvent.click(option.getElement());
}

function upload(file: File) {
  const control = field('Secret file').findControl()?.findFileUpload()?.findNativeInput();
  if (!control) throw new Error('Missing secret file selector');
  fireEvent.change(control.getElement(), { target: { files: [file] } });
}

function button(name: string, root = PAGE) {
  return root
    .findAllButtons()
    .find((item) => {
      const element = item.getElement();
      return (element.getAttribute('aria-label') ?? item.findTextRegion()?.getElement().textContent) === name;
    })
    ?.getElement();
}

async function click(name: string) {
  const control = await waitFor(() => {
    const root = PAGE.findModal()?.findFooter() ?? PAGE;
    const found = button(name, root);
    if (!found) throw new Error(`Missing button ${name}`);
    return found;
  });
  fireEvent.click(control);
}

function heading(name: string) {
  return PAGE.findAllHeaders().find((header) => header.findHeadingText().getElement().textContent === name);
}

async function expectList(router: ReturnType<typeof openCreate>['router']) {
  await waitFor(() => expect(heading('Secrets')?.findHeadingText().getElement()).toBeVisible());
  expect(router.state.location.pathname).toBe(SECRETS_PATH);
}

function area() {
  return PAGE.findAppLayout()?.findContentRegion();
}

function successFlash() {
  return area()
    ?.findFlashbar()
    ?.findItemsByType('success')
    .find((item) => item.findContent()?.getElement().textContent === STORED)
    ?.findContent()
    ?.getElement();
}

function errorContent(title: string) {
  return area()
    ?.findAllAlerts()
    .find((item) => item.findHeader()?.getElement().textContent === title)
    ?.findContent()
    .getElement();
}

function deferredReply() {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

const ORDERS = ['list first', 'detail first'] as const;

function fill() {
  enter('Secret name', NAME);
  enter('Secret value', STRING_VALUE);
}

function expectNoSuccess() {
  expect(successFlash()).toBeUndefined();
}

describe('Store a secret', () => {
  it('returns to secrets when an untouched form is canceled', async () => {
    const { router, count } = openCreate();
    await click('Cancel');
    await expectList(router);
    expect(count('CreateSecret')).toBe(0);
  });

  it('keeps the edited form when the user chooses Keep editing', async () => {
    const { router } = openCreate();
    fill();
    await click('Cancel');
    await click('Keep editing');
    expect(input('Secret value')).toHaveValue(STRING_VALUE);
    expect(input('Secret name')).toHaveValue(NAME);
    expect(router.state.location.pathname).toBe(SECRET_CREATE_PATH);
  });

  it('discards the form and returns to secrets without creating anything', async () => {
    const { router, count } = openCreate();
    fill();
    await click('Cancel');
    await click('Discard');
    await expectList(router);
    expect(count('CreateSecret')).toBe(0);
  });

  it('sends the exact string, name and optional metadata in one create request', async () => {
    const { calls, count } = openCreate();
    fill();
    enter('Description', 'Development credentials');
    enter('KMS key ARN', NEW_KEY);
    const tagEditor = PAGE.findAttributeEditor();
    if (!tagEditor) throw new Error('Missing tags editor');
    fireEvent.click(tagEditor.findAddButton().getElement());
    enter('Key', 'project');
    enter('Value', 'local');
    await click('Store a secret');
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('CreateSecret', {
        Name: NAME,
        Description: 'Development credentials',
        KmsKeyId: NEW_KEY,
        Tags: [{ Key: 'project', Value: 'local' }],
        SecretString: STRING_VALUE,
        ClientRequestToken: expect.any(String),
      }),
    );
    expect(count('CreateSecret')).toBe(1);
    await waitFor(() => expect(successFlash()).toBeVisible());
  });

  it('stores the original file bytes through the binary field only', async () => {
    const { calls } = openCreate();
    enter('Secret name', NAME);
    chooseValueType('binary');
    const bytes = [0, 20, 160, 255];
    upload(new File([new Uint8Array(bytes)], 'secret.bin'));
    await click('Store a secret');
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('CreateSecret', {
        Name: NAME,
        SecretBinary: btoa(String.fromCharCode(...bytes)),
        ClientRequestToken: expect.any(String),
      }),
    );
    await waitFor(() => expect(successFlash()).toBeVisible());
  });

  it('keeps both drafts when switching value types and submits only the selected draft', async () => {
    const { calls } = openCreate();
    fill();
    chooseValueType('binary');
    upload(new File(['synthetic bytes'], 'draft.bin'));
    chooseValueType('string');
    expect(input('Secret value')).toHaveValue(STRING_VALUE);
    chooseValueType('binary');
    expect(
      field('Secret file').findControl()?.findFileUpload()?.findFileToken(1)?.findFileName().getElement(),
    ).toHaveTextContent('draft.bin');
    chooseValueType('string');
    await click('Store a secret');
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('CreateSecret', {
        Name: NAME,
        SecretString: STRING_VALUE,
        ClientRequestToken: expect.any(String),
      }),
    );
    await waitFor(() => expect(successFlash()).toBeVisible());
  });

  it('generates a password only on request and fills the string field', async () => {
    const generated = 'synthetic-generated-value';
    const { count } = openCreate({
      handler: (operation) => (operation === 'GetRandomPassword' ? { body: { RandomPassword: generated } } : undefined),
    });
    fill();
    const notice = field('Secret value').findDescription()?.getElement();
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent('Generating a password replaces the value entered here.');
    expect(count('GetRandomPassword')).toBe(0);
    await click('Generate password');
    await waitFor(() => expect(input('Secret value')).toHaveValue(generated));
    expect(count('GetRandomPassword')).toBe(1);
    expect(count('CreateSecret')).toBe(0);
  });

  it('preserves form inputs and shows the refusal when create fails', async () => {
    const { router } = openCreate({
      handler: (operation) =>
        operation === 'CreateSecret'
          ? {
              body: { __type: 'ResourceExistsException', message: 'A secret with this name already exists.' },
              status: 400,
            }
          : undefined,
    });
    fill();
    await click('Store a secret');
    await waitFor(() => expect(errorContent('Secret operation failed')).toBeVisible());
    expect(errorContent('Secret operation failed')).toHaveTextContent('A secret with this name already exists.');
    expect(input('Secret name')).toHaveValue(NAME);
    expect(input('Secret value')).toHaveValue(STRING_VALUE);
    expect(router.state.location.pathname).toBe(SECRET_CREATE_PATH);
    expectNoSuccess();
  });

  it('preserves the existing string and shows the refusal when generation fails', async () => {
    openCreate({
      handler: (operation) =>
        operation === 'GetRandomPassword'
          ? { body: { __type: 'AccessDeniedException', message: REFUSED }, status: 403 }
          : undefined,
    });
    fill();
    await click('Generate password');
    await waitFor(() => expect(errorContent('Access denied')).toBeVisible());
    expect(errorContent('Access denied')).toHaveTextContent(REFUSED);
    expect(input('Secret value')).toHaveValue(STRING_VALUE);
    expectNoSuccess();
  });

  it.each(ORDERS)('opens the stored secret and keeps the area result when %s', async (order) => {
    const list = deferredReply();
    const detail = deferredReply();
    let created = false;
    const { router, count } = openCreate({
      observe: true,
      handler: (operation) => {
        if (operation === 'CreateSecret') {
          created = true;
          return { body: { Name: NAME } };
        }
        if (operation === 'ListSecrets') return created ? list.promise : { body: { SecretList: [] } };
        if (operation === 'DescribeSecret') {
          return created
            ? detail.promise
            : { body: { __type: 'ResourceNotFoundException', message: 'Missing secret' }, status: 404 };
        }
      },
    });
    await waitFor(() => expect(screen.getByLabelText('Detail read')).toHaveTextContent('ResourceNotFoundException'));
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'false'));
    fill();
    await click('Store a secret');
    await waitFor(() => expect(heading(NAME)?.findHeadingText().getElement()).toBeVisible());
    const assertResult = () => {
      expect(successFlash()).toBeVisible();
    };
    const reads = [
      { source: list, label: 'List read', reply: { body: { SecretList: [{ Name: NAME }] } } },
      { source: detail, label: 'Detail read', reply: { body: { Name: NAME, Description: 'Stored by Studio' } } },
    ];
    await waitFor(() => {
      expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByLabelText('Detail read')).toHaveAttribute('aria-busy', 'true');
    });
    for (const { source, label, reply } of order === 'list first' ? reads : [...reads].reverse()) {
      await act(async () => {
        source.resolve(reply);
      });
      await waitFor(() => expect(screen.getByLabelText(label)).toHaveAttribute('aria-busy', 'false'));
      assertResult();
    }
    const metadata = area()
      ?.findKeyValuePairs()
      ?.findItems()
      .flatMap((item) => item.findGroupPairs() ?? []);
    const description = metadata?.find((item) => item.findLabel()?.getElement().textContent === 'Description');
    expect(description?.findValue()?.getElement()).toHaveTextContent('Stored by Studio');
    expect(router.state.location.pathname + router.state.location.search).toBe(secretPath(NAME));
    expect(screen.getByLabelText('List read')).toHaveTextContent(NAME);
    expect(count('GetSecretValue')).toBe(0);
    await click('Refresh');
    await waitFor(() => expect(count('DescribeSecret')).toBeGreaterThan(2));
    assertResult();
  });
});
