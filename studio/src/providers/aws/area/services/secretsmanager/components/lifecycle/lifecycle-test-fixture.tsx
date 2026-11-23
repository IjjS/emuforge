import type { DescribeSecretCommandOutput } from '@aws-sdk/client-secrets-manager';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, vi } from 'vitest';

import type { AreaConnection } from '../../../../components/emulator-line';
import AwsArea from '../../../../index';
import { SECRETS_PATH, secretPath } from '../../paths';
import { useSecretDetail, useSecretListing } from '../../queries';

export const NAME = 'dev/key';
export const ORIGINAL_KEY = 'arn:aws:kms:us-east-1:000000000000:key/original';
export const NEW_KEY = 'arn:aws:kms:us-east-1:000000000000:key/replacement';
export const DELETION_DATE = 1_800_000_000;
export const ORIGINAL_DESCRIPTION = 'Original description';
export const ORIGINAL_VERSION = 'existing-version';
export const ORIGINAL_TAG = { Key: 'project', Value: 'original tag value' };
export const REFUSED = 'Local policy refused this operation.';
export const STRING_VALUE = '  synthetic value\nwith whitespace  ';
const BYTES = [0, 20, 160, 255];
export const BINARY_VALUE = btoa(String.fromCharCode(...BYTES));

type Metadata = Omit<DescribeSecretCommandOutput, '$metadata' | 'DeletedDate'> & { DeletedDate?: number };
type Input = Record<string, unknown>;
type Reply = { body: unknown; status?: number };
type Handler = (operation: string, input: Input) => Reply | Promise<Reply> | undefined;

export function secretMetadata(changes?: Partial<Metadata>): Metadata {
  return {
    Name: NAME,
    Description: ORIGINAL_DESCRIPTION,
    KmsKeyId: ORIGINAL_KEY,
    VersionIdsToStages: { [ORIGINAL_VERSION]: ['AWSCURRENT'] },
    Tags: [ORIGINAL_TAG],
    ...changes,
  };
}

export function denied() {
  return { body: { __type: 'AccessDeniedException', message: REFUSED }, status: 403 };
}

export function notFound() {
  return { body: { __type: 'ResourceNotFoundException', message: 'Missing secret' }, status: 404 };
}

let nextPort = 8750;

function useVisits(pathname: string) {
  const [visit, setVisit] = useState({ pathname, count: 0 });
  if (visit.pathname !== pathname) {
    setVisit({ pathname, count: visit.count + 1 });
  }
  return visit.count;
}

// Keep both production read hooks mounted while the real area navigates between its screens.
function ActiveReads({ connection }: { connection: AreaConnection }) {
  const list = useSecretListing(connection, false);
  const detail = useSecretDetail(connection, NAME);
  return (
    <>
      <output aria-label="List read" aria-busy={list.loading}>
        {JSON.stringify(list.items ?? [])}
      </output>
      <output aria-label="Detail read" aria-busy={detail.loading}>
        {detail.failure?.kind === 'other' ? detail.failure.code : JSON.stringify(detail.details)}
      </output>
    </>
  );
}

export function lifecycleTests() {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());
}

export function openLifecycle({
  path = secretPath(NAME),
  initial = secretMetadata(),
  handler,
  observe = false,
}: { path?: string; initial?: Metadata; handler?: Handler; observe?: boolean } = {}) {
  const connection: AreaConnection = {
    engineOrigin: `http://127.0.0.1:${String(nextPort++)}`,
    result: {
      kind: 'connected',
      checkedAt: Date.now(),
      emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' },
    },
  };
  const calls = vi.fn<(operation: string, input: Input) => void>();
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
    switch (operation) {
      case 'ListSecrets':
        return answer({ SecretList: initial.DeletedDate ? [] : [initial] });
      case 'DescribeSecret':
        return answer(initial);
      case 'GetSecretValue':
        throw new Error('The lifecycle controls must not retrieve a secret value.');
      default:
        return answer({});
    }
  });

  function Frame() {
    const { pathname } = useLocation();
    const routeChanges = useVisits(pathname);
    return (
      <>
        {observe && <ActiveReads connection={connection} />}
        <AwsArea
          headerSelector="#top-bar"
          connection={connection}
          targetGeneration={0}
          routeChanges={routeChanges}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
      </>
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
    calls,
    count: (operation: string) => calls.mock.calls.filter(([name]) => name === operation).length,
    router,
  };
}

export function enter(label: string, value: string, root: Pick<typeof screen, 'getByLabelText'> = screen) {
  fireEvent.change(root.getByLabelText(label), { target: { value } });
}

export function chooseBinary(root: HTMLElement) {
  fireEvent.click(screen.getByRole('radio', { name: 'Binary file' }));
  const upload = root.querySelector('input[type="file"]');
  if (upload === null) throw new Error('Missing file input');
  fireEvent.change(upload, { target: { files: [new File([new Uint8Array(BYTES)], 'secret.bin')] } });
}

export async function click(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

function deferredReply() {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

export const ORDERS = ['list first', 'detail first'] as const;
export type ReadOrder = (typeof ORDERS)[number];

export function delayedReads(operation: string, detailAnswer: Reply, listAnswer: Reply, before?: Handler) {
  const list = deferredReply();
  const detail = deferredReply();
  let changed = false;
  const handler: Handler = (called, input) => {
    if (called === operation) {
      changed = true;
      return { body: { Name: NAME } };
    }
    if (changed && called === 'ListSecrets') return list.promise;
    if (changed && called === 'DescribeSecret') return detail.promise;
    return before?.(called, input);
  };
  async function complete(order: ReadOrder, after: () => void) {
    const listRead = () => act(() => list.resolve(listAnswer));
    const detailRead = () => act(() => detail.resolve(detailAnswer));
    const waitForList = () =>
      waitFor(() => expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'false'));
    const waitForDetail = () =>
      waitFor(() => expect(screen.getByLabelText('Detail read')).toHaveAttribute('aria-busy', 'false'));
    await waitFor(() => {
      expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByLabelText('Detail read')).toHaveAttribute('aria-busy', 'true');
    });
    if (order === 'list first') {
      await listRead();
      await waitForList();
      after();
      await detailRead();
    } else {
      await detailRead();
      await waitForDetail();
      after();
      await listRead();
    }
    await waitForList();
    await waitForDetail();
    after();
  }
  return { handler, complete };
}

export async function expectList(router: ReturnType<typeof openLifecycle>['router']) {
  await screen.findByRole('heading', { name: 'Secrets', level: 1 });
  expect(router.state.location.pathname).toBe(SECRETS_PATH);
}
