import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function enter(label: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
}

async function click(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

async function expectList(router: ReturnType<typeof openCreate>['router']) {
  await screen.findByRole('heading', { name: 'Secrets', level: 1 });
  expect(router.state.location.pathname).toBe(SECRETS_PATH);
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
  expect(screen.queryByText(`Secret ${NAME} was stored.`)).not.toBeInTheDocument();
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
    expect(screen.getByRole('textbox', { name: 'Secret value' })).toHaveValue(STRING_VALUE);
    expect(screen.getByRole('textbox', { name: 'Secret name' })).toHaveValue(NAME);
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
    await click('Add tag');
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
  });

  it('stores the original file bytes through the binary field only', async () => {
    const { calls } = openCreate();
    enter('Secret name', NAME);
    fireEvent.click(screen.getByRole('radio', { name: 'Binary file' }));
    const input = screen.getByLabelText('Secret file', { selector: 'input' });
    const bytes = [0, 20, 160, 255];
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(bytes)], 'secret.bin')] } });
    await click('Store a secret');
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('CreateSecret', {
        Name: NAME,
        SecretBinary: btoa(String.fromCharCode(...bytes)),
        ClientRequestToken: expect.any(String),
      }),
    );
  });

  it('keeps both drafts when switching value types and submits only the selected draft', async () => {
    const { calls } = openCreate();
    fill();
    const stringOption = screen.getByRole('radio', { name: 'String' });
    const fileOption = screen.getByRole('radio', { name: 'Binary file' });
    fireEvent.click(fileOption);
    const input = screen.getByLabelText('Secret file', { selector: 'input' });
    const file = new File(['synthetic bytes'], 'draft.bin');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(stringOption);
    expect(screen.getByRole('textbox', { name: 'Secret value' })).toHaveValue(STRING_VALUE);
    fireEvent.click(fileOption);
    expect(screen.getByText('draft.bin')).toBeVisible();
    fireEvent.click(stringOption);
    await click('Store a secret');
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('CreateSecret', {
        Name: NAME,
        SecretString: STRING_VALUE,
        ClientRequestToken: expect.any(String),
      }),
    );
  });

  it('generates a password only on request and fills the string field', async () => {
    const generated = 'synthetic-generated-value';
    const { count } = openCreate({
      handler: (operation) => (operation === 'GetRandomPassword' ? { body: { RandomPassword: generated } } : undefined),
    });
    fill();
    expect(screen.getByText('Generating a password replaces the value entered here.')).toBeVisible();
    expect(count('GetRandomPassword')).toBe(0);
    await click('Generate password');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Secret value' })).toHaveValue(generated));
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
    expect(await screen.findByText('A secret with this name already exists.', { exact: false })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Secret name' })).toHaveValue(NAME);
    expect(screen.getByRole('textbox', { name: 'Secret value' })).toHaveValue(STRING_VALUE);
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
    expect(await screen.findByText(REFUSED, { exact: false })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Secret value' })).toHaveValue(STRING_VALUE);
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
    await screen.findByRole('heading', { name: NAME, level: 1 });
    const assertResult = () => {
      expect(within(screen.getByRole('main')).getByText(`Secret ${NAME} was stored.`)).toBeVisible();
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
    expect(await within(screen.getByRole('main')).findByText('Stored by Studio')).toBeVisible();
    expect(router.state.location.pathname + router.state.location.search).toBe(secretPath(NAME));
    expect(screen.getByLabelText('List read')).toHaveTextContent(NAME);
    expect(count('GetSecretValue')).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(count('DescribeSecret')).toBeGreaterThan(2));
    assertResult();
  });
});
