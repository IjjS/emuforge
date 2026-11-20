import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import {
  createKeyPair,
  deleteKeyPair,
  importKeyPair,
  KEY_PAIR_OPERATIONS,
  listKeyPairs,
  type CreatedKeyPair,
  type KeyPair,
  type NewKeyPair,
} from './key-pair-api';
import { EC2_KEYS } from './queries';

// The TanStack Query hooks of EC2's key pair screens (issue 553, design task 5). The list is one `DescribeKeyPairs`
// (the operation has no pages), read with the area's listing as a single page, so it is a request of its own on every
// mount and "Refresh", and a late answer changes nothing shown. A create, an import or a delete that succeeds reads
// again the key list and the key choices of the launch form; one that fails reads nothing.
//
// The private key of a create: the create is a plain call, not a query and not a mutation of the client, so no
// cache, key or retained result of the app ever holds its answer; it goes to the page that asked, and only there.

/** S8's list: every key pair, as one page. */
export function useKeyPairListing(endpoint: string | undefined): TokenListing<KeyPair> {
  return useTokenListing({
    key: EC2_KEYS.keyPairs(),
    endpoint,
    operation: KEY_PAIR_OPERATIONS.describeKeyPairs,
    read: async (at, _token, signal) => ({ items: await listKeyPairs(at, signal) }),
  });
}

/** Reads again what shows key pairs: the list and the launch form's key choices. */
function useReadKeyPairsAgain(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: EC2_KEYS.keyPairs() });
    void client.invalidateQueries({ queryKey: EC2_KEYS.choices('key-pairs') });
  }, [client]);
}

/** "Create key pair": the answer, with its private key, to the caller alone. */
export function useCreateKeyPair(
  endpoint: string | undefined,
): (keyPair: NewKeyPair, signal: AbortSignal) => Promise<CreatedKeyPair> {
  const readAgain = useReadKeyPairsAgain();
  return useCallback(
    async (keyPair: NewKeyPair, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const created = await createKeyPair(endpoint, keyPair, signal);
      readAgain();
      return created;
    },
    [endpoint, readAgain],
  );
}

/** "Import key pair". */
export function useImportKeyPair(
  endpoint: string | undefined,
): (name: string, publicKey: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadKeyPairsAgain();
  return useCallback(
    async (name: string, publicKey: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await importKeyPair(endpoint, name, publicKey, signal);
      readAgain();
    },
    [endpoint, readAgain],
  );
}

/** "Delete" of one key pair, by its name. */
export function useDeleteKeyPair(endpoint: string | undefined): (name: string, signal: AbortSignal) => Promise<void> {
  const readAgain = useReadKeyPairsAgain();
  return useCallback(
    async (name: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteKeyPair(endpoint, name, signal);
      readAgain();
    },
    [endpoint, readAgain],
  );
}
