import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './key-pair-api';
import { useCreateKeyPair, useDeleteKeyPair, useImportKeyPair, useKeyPairListing } from './key-pair-queries';
import { EC2_KEYS } from './queries';

// The hooks over `key-pair-api.ts`, whose calls the case answers. `key-pair-api.test.ts` proves the calls themselves
// against a fake engine.

vi.mock('./key-pair-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./key-pair-api')>();
  return {
    ...real,
    listKeyPairs: vi.fn(),
    createKeyPair: vi.fn(),
    importKeyPair: vi.fn(),
    deleteKeyPair: vi.fn(),
  };
});

const ENDPOINT = 'http://127.0.0.1:9999';
const PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMIIEsecretsecret\n-----END RSA PRIVATE KEY-----';

let client: QueryClient;
let choiceReads: number;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  choiceReads = 0;
  vi.mocked(api.listKeyPairs).mockResolvedValue([{ name: 'a' }]);
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The key list, the launch form's key choices (as a read under their key), and the three changes. */
function useAll() {
  const listing = useKeyPairListing(ENDPOINT);
  useQuery({
    queryKey: EC2_KEYS.choices('key-pairs', ENDPOINT),
    queryFn: () => {
      choiceReads += 1;
      return Promise.resolve(['a']);
    },
  });
  return {
    listing,
    create: useCreateKeyPair(ENDPOINT),
    importKey: useImportKeyPair(ENDPOINT),
    remove: useDeleteKeyPair(ENDPOINT),
  };
}

async function settled() {
  const hook = renderHook(useAll, { wrapper });
  await waitFor(() => {
    expect(hook.result.current.listing.items).toEqual([{ name: 'a' }]);
    expect(choiceReads).toBe(1);
  });
  return hook;
}

const signal = () => new AbortController().signal;

describe('the key list', () => {
  it('is one read of every key pair, as one page', async () => {
    const hook = await settled();
    expect(vi.mocked(api.listKeyPairs)).toHaveBeenCalledTimes(1);
    expect(hook.result.current.listing.pagesCount).toBe(1);
    expect(hook.result.current.listing.openEnd).toBe(false);
  });
});

describe('after a change', () => {
  const changes: [string, (all: ReturnType<typeof useAll>) => Promise<unknown>, () => void, () => void][] = [
    [
      'create',
      (all) => all.create({ name: 'n', type: 'rsa', format: 'pem' }, signal()),
      () => vi.mocked(api.createKeyPair).mockResolvedValue({ name: 'n', privateKey: PRIVATE_KEY }),
      () =>
        vi
          .mocked(api.createKeyPair)
          .mockRejectedValue(
            new RequestError({ kind: 'other', operation: 'CreateKeyPair', code: 'InvalidKeyPair.Duplicate' }),
          ),
    ],
    [
      'import',
      (all) => all.importKey('n', 'ssh-ed25519 AAAA', signal()),
      () => vi.mocked(api.importKeyPair).mockResolvedValue(undefined),
      () =>
        vi
          .mocked(api.importKeyPair)
          .mockRejectedValue(
            new RequestError({ kind: 'other', operation: 'ImportKeyPair', code: 'InvalidKeyPair.Format' }),
          ),
    ],
    [
      'delete',
      (all) => all.remove('n', signal()),
      () => vi.mocked(api.deleteKeyPair).mockResolvedValue(undefined),
      () =>
        vi
          .mocked(api.deleteKeyPair)
          .mockRejectedValue(new RequestError({ kind: 'not-implemented', operation: 'DeleteKeyPair' })),
    ],
  ];
  for (const [name, change, succeed, fail] of changes) {
    it(`${name} succeeds → the key list and the key choices are read again`, async () => {
      succeed();
      const hook = await settled();
      await act(async () => {
        await change(hook.result.current);
      });
      await waitFor(() => {
        expect(vi.mocked(api.listKeyPairs)).toHaveBeenCalledTimes(2);
        expect(choiceReads).toBe(2);
      });
    });

    it(`${name} fails → none is read again`, async () => {
      fail();
      const hook = await settled();
      await act(async () => {
        await change(hook.result.current).catch(() => undefined);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(vi.mocked(api.listKeyPairs)).toHaveBeenCalledTimes(1);
      expect(choiceReads).toBe(1);
    });
  }

  it('a create hands its private key to the caller; no cached read and no retained result of the app holds it', async () => {
    vi.mocked(api.createKeyPair).mockResolvedValue({ name: 'n', privateKey: PRIVATE_KEY, fingerprint: 'f' });
    const hook = await settled();
    let answer: api.CreatedKeyPair | undefined;
    await act(async () => {
      answer = await hook.result.current.create({ name: 'n', type: 'rsa', format: 'pem' }, signal());
    });
    expect(answer?.privateKey).toBe(PRIVATE_KEY);
    await waitFor(() => {
      expect(vi.mocked(api.listKeyPairs)).toHaveBeenCalledTimes(2);
    });
    const held = JSON.stringify([
      client
        .getQueryCache()
        .getAll()
        .map((query) => [query.queryKey, query.state.data]),
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state),
    ]);
    expect(held).not.toContain('MIIEsecretsecret');
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
});
