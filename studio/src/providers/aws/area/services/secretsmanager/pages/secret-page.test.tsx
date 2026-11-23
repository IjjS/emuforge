import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import { SECRETS_MANAGER_PATH, SECRETS_PATH, secretPath } from '../paths';

const NAME = 'app/credentials';
const VALUE = '  synthetic  credential\nline two  ';
const DESCRIPTION = 'An existing secret description';
const HIDDEN = 'Secret value is hidden.';
const EMULATOR = { port: 9308, endpoint: 'https://127.0.0.1:9308' };

interface SecretInput {
  SecretId?: string;
  VersionId?: string;
}

let nextPort = 8750;
let engineOrigin: string;
const list = vi.fn<() => Response>();
const describeSecret = vi.fn<(input: SecretInput) => Response>();
const retrieve = vi.fn<(input: SecretInput, signal: AbortSignal) => Response | Promise<Response>>();

function connected(): Extract<CheckResult, { kind: 'connected' }> {
  return { kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR };
}

function disconnected(): CheckResult {
  return {
    kind: 'emulator-unreachable',
    checkedAt: Date.now(),
    emulator: EMULATOR,
    reason: 'not_started',
    message: '',
  };
}

function answer(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function notFound() {
  return answer({ __type: 'ResourceNotFoundException', message: 'The secret does not exist.' }, 404);
}

beforeEach(() => {
  engineOrigin = `http://127.0.0.1:${String(nextPort++)}`;
  list.mockReset().mockImplementation(() => answer({ SecretList: [{ Name: NAME, Description: DESCRIPTION }] }));
  describeSecret.mockReset().mockImplementation(({ SecretId }) =>
    answer({
      Name: SecretId,
      ARN: `arn:aws:secretsmanager:us-east-1:000000000000:secret:${SecretId ?? ''}`,
      Description: DESCRIPTION,
    }),
  );
  retrieve.mockReset().mockImplementation(() => answer({ SecretString: VALUE }));
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const body = (await request.json()) as SecretInput;
    switch (request.headers.get('x-amz-target')?.split('.').at(-1)) {
      case 'ListSecrets':
        return list();
      case 'DescribeSecret':
        return describeSecret(body);
      case 'GetSecretValue':
        return retrieve(body, request.signal);
      default:
        throw new Error('Unexpected AWS request');
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

function open(path = secretPath(NAME)) {
  const initial: AreaConnection = { engineOrigin, result: connected() };
  const controls: { update?: (value: { connection: AreaConnection; generation: number }) => void } = {};
  function Frame() {
    const [{ connection, generation }, update] = useState({ connection: initial, generation: 0 });
    controls.update = update;
    return (
      <AwsArea
        headerSelector="#top-bar"
        connection={connection}
        targetGeneration={generation}
        routeChanges={0}
        onPageTitle={() => undefined}
        onContentTarget={() => undefined}
      />
    );
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    router,
    connect(result: CheckResult, generation = 0) {
      act(() => controls.update?.({ connection: { ...initial, result }, generation }));
    },
  };
}

async function requestValue() {
  fireEvent.click(await screen.findByRole('button', { name: 'Retrieve secret value' }));
  await waitFor(() => expect(retrieve).toHaveBeenCalledTimes(1));
  const call = retrieve.mock.calls[0];
  expect(call?.[0].SecretId).toBe(NAME);
  return call?.[1];
}

function hideValue() {
  fireEvent.click(screen.getByRole('button', { name: 'Hide secret value' }));
}

async function shownValue() {
  return screen.findByText(VALUE, { normalizer: (text) => text });
}

describe('Secret details and value', () => {
  it('uses the original slash-containing name in the heading, last crumb, and DescribeSecret', async () => {
    open('/aws/secretsmanager/secrets/detail?name=app%2Fcredentials');
    expect(await screen.findByRole('heading', { name: NAME, level: 1 })).toBeVisible();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    expect(within(crumbs).getByRole('link', { name: NAME, current: 'page' })).toBeVisible();
    await screen.findByText(DESCRIPTION);
    expect(describeSecret).toHaveBeenCalledExactlyOnceWith({ SecretId: NAME });
  });

  it('shows the not-found message and link for a missing name', async () => {
    describeSecret.mockImplementation(notFound);
    open();
    expect(await screen.findByText('Secret not found')).toBeVisible();
    expect(screen.getByText(`Your local emulator could not find ${NAME}.`)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to secrets' })).toHaveAttribute('href', SECRETS_PATH);
  });

  it('does not read the value on either page or on a metadata refresh', async () => {
    open(SECRETS_MANAGER_PATH);
    fireEvent.click(await screen.findByRole('link', { name: NAME }));
    expect(await screen.findByText(HIDDEN)).toBeVisible();
    describeSecret.mockImplementation(() => answer({ Name: NAME, Description: 'Refreshed description' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Refreshed description')).toBeVisible();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('shows the retrieved string with its original whitespace', async () => {
    open();
    await requestValue();
    expect((await shownValue()).textContent).toBe(VALUE);
  });

  it('shows the exact Base64 encoding and label for binary bytes', async () => {
    retrieve.mockImplementation(() => answer({ SecretBinary: 'AAD/f4A=' }));
    open();
    await requestValue();
    expect(await screen.findByText('Base64')).toBeVisible();
    expect(screen.getByText('AAD/f4A=')).toBeVisible();
  });

  it('clears the shown value when hidden', async () => {
    open();
    await requestValue();
    const value = await shownValue();
    hideValue();
    expect(screen.getByText(HIDDEN)).toBeVisible();
    expect(value).not.toBeInTheDocument();
  });

  it('discards an in-flight value reply after hiding', async () => {
    const late = deferredResponse();
    retrieve.mockImplementation(() => late.promise);
    open();
    const signal = await requestValue();
    hideValue();
    expect(signal?.aborted).toBe(true);
    await act(async () => late.resolve(answer({ SecretString: 'late value' })));
    expect(screen.getByText(HIDDEN)).toBeVisible();
    expect(screen.queryByText('late value')).not.toBeInTheDocument();
  });

  it('discards an in-flight value reply after changing the name in the query', async () => {
    const late = deferredResponse();
    retrieve.mockImplementation(() => late.promise);
    const { router } = open();
    const signal = await requestValue();
    await act(async () => router.navigate(secretPath('another/secret')));
    expect(await screen.findByRole('heading', { level: 1, name: 'another/secret' })).toBeVisible();
    expect(signal?.aborted).toBe(true);
    await act(async () => late.resolve(answer({ SecretString: 'previous name value' })));
    expect(await screen.findByText(HIDDEN)).toBeVisible();
    expect(screen.queryByText('previous name value')).not.toBeInTheDocument();
  });

  it('discards an in-flight value reply after switching target on the same engine', async () => {
    const late = deferredResponse();
    retrieve.mockImplementation(() => late.promise);
    const { connect } = open();
    const signal = await requestValue();
    connect({ ...connected(), target: 'another-target' }, 1);
    expect(await screen.findByText(HIDDEN)).toBeVisible();
    expect(signal?.aborted).toBe(true);
    await act(async () => late.resolve(answer({ SecretString: 'previous target value' })));
    expect(screen.queryByText('previous target value')).not.toBeInTheDocument();
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it('shows the reason for a refused value request while keeping the value hidden', async () => {
    retrieve.mockImplementation(() =>
      answer({ __type: 'AccessDeniedException', message: 'Reading denied by the local policy' }, 403),
    );
    open();
    await requestValue();
    expect(await screen.findByText('GetSecretValue was refused: Reading denied by the local policy')).toBeVisible();
    expect(screen.getByText(HIDDEN)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retrieve secret value' })).toBeEnabled();
  });

  it('immediately hides a revealed value when the connection is lost', async () => {
    const { connect } = open();
    await requestValue();
    const value = await shownValue();
    connect(disconnected());
    expect(value).not.toBeInTheDocument();
  });

  it('cancels a pending value request on disconnect and discards the late value', async () => {
    const late = deferredResponse();
    retrieve.mockImplementation(() => late.promise);
    const { connect } = open();
    const signal = await requestValue();
    connect(disconnected());
    expect(signal?.aborted).toBe(true);
    await act(async () => late.resolve(answer({ SecretString: 'value after disconnect' })));
    expect(screen.queryByText('value after disconnect')).not.toBeInTheDocument();
  });

  it('automatically reads details after reconnect and only shows the missing result if the secret is gone', async () => {
    const { connect } = open();
    const description = await screen.findByText(DESCRIPTION);
    await requestValue();
    const value = await shownValue();
    connect(disconnected());
    describeSecret.mockImplementation(notFound);
    connect(connected());
    expect(await screen.findByText('Secret not found')).toBeVisible();
    expect(screen.getByText(`Your local emulator could not find ${NAME}.`)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to secrets' })).toBeVisible();
    expect(description).not.toBeInTheDocument();
    expect(value).not.toBeInTheDocument();
    expect(describeSecret).toHaveBeenCalledTimes(2);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
});
