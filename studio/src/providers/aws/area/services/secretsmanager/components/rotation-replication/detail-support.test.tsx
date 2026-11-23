import { QueryClient, QueryClientProvider, useIsFetching } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, vi } from 'vitest';

import type { AreaConnection } from '../../../../components/emulator-line';
import AwsArea from '../../../../index';
import { secretPath } from '../../paths';
import { useSecretListing } from '../../queries';

export const NAME = 'dev/key';
export const REFUSAL = 'The emulator refused this change.';
const LIST = 'ListSecrets';
const DETAIL = 'DescribeSecret';

type Input = Record<string, unknown>;
type Reply = { body: unknown; status?: number };
type Handler = (operation: string, input: Input) => Reply | Promise<Reply> | undefined;
type Metadata = Record<string, unknown>;

let port = 8950;

export function denied(message = REFUSAL): Reply {
  return { body: { __type: 'AccessDeniedException', message }, status: 403 };
}

export async function click(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

function ActiveReads({ connection }: { connection: AreaConnection }) {
  useSecretListing(connection, false);
  const list = useIsFetching({ queryKey: ['aws', 'secretsmanager', LIST] });
  const detail = useIsFetching({ queryKey: ['aws', 'secretsmanager', DETAIL] });
  return (
    <>
      <output aria-label={LIST} aria-busy={list > 0} />
      <output aria-label={DETAIL} aria-busy={detail > 0} />
    </>
  );
}

export function openSecret({
  metadata = {},
  handler,
  observe = false,
}: { metadata?: Metadata; handler?: Handler; observe?: boolean } = {}) {
  const connection: AreaConnection = {
    engineOrigin: `http://127.0.0.1:${String(port++)}`,
    result: { kind: 'connected', checkedAt: Date.now(), emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' } },
  };
  const calls = vi.fn<(operation: string, input: Input) => void>();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const answer = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1) ?? '';
    const body = (await request.json()) as Input;
    calls(operation, body);
    const reply = await handler?.(operation, body);
    if (reply !== undefined) return answer(reply.body, reply.status);
    if (operation === DETAIL) return answer({ Name: NAME, ...metadata });
    if (operation === LIST) return answer({ SecretList: [{ Name: NAME }] });
    throw new Error(`Unexpected operation ${operation}`);
  });

  function Frame() {
    return (
      <>
        {observe && <ActiveReads connection={connection} />}
        <AwsArea
          headerSelector="#top-bar"
          connection={connection}
          targetGeneration={0}
          routeChanges={0}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
      </>
    );
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [secretPath(NAME)] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls };
}

function deferredReply() {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export const ORDERS = ['list first', 'detail first'] as const;

export function delayedRefresh(operation: string, metadata: Metadata) {
  const reads = {
    [LIST]: { ...deferredReply(), body: { SecretList: [{ Name: NAME }] } },
    [DETAIL]: { ...deferredReply(), body: { Name: NAME, ...metadata } },
  };
  let written = false;
  const handler: Handler = (called) => {
    if (called === operation) {
      written = true;
      return { body: { Name: NAME } };
    }
    if (written && (called === LIST || called === DETAIL)) return reads[called].promise;
  };

  async function complete(order: (typeof ORDERS)[number], success: string, assertDetail: () => void) {
    await waitFor(() => {
      for (const read of [LIST, DETAIL]) expect(screen.getByLabelText(read)).toHaveAttribute('aria-busy', 'true');
    });
    expect(screen.getByText(success)).toBeVisible();
    const ordered = order === 'list first' ? ([LIST, DETAIL] as const) : ([DETAIL, LIST] as const);
    for (const read of ordered) {
      reads[read].resolve({ body: reads[read].body });
      await waitFor(() => expect(screen.getByLabelText(read)).toHaveAttribute('aria-busy', 'false'));
      expect(screen.getByText(success)).toBeVisible();
      if (read === DETAIL) await waitFor(assertDetail);
    }
    assertDetail();
  }

  return { handler, complete };
}
