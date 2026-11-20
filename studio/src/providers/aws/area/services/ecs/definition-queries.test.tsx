import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from './definition-api';
import { useFamilyListing, useRevision, useRevisionListing } from './definition-queries';
import { ECS_KEYS } from './queries';

// The hooks over `definition-api.ts`, whose calls the case answers (`definition-api.test.ts` proves the calls).

vi.mock('./definition-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./definition-api')>();
  return { ...real, listFamilies: vi.fn(), listRevisions: vi.fn(), getRevision: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9997';

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Whether `key` starts with `root`. */
function under(key: readonly unknown[], root: readonly unknown[]): boolean {
  return root.length <= key.length && root.every((part, index) => key[index] === part);
}

const keys = () =>
  client
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);

describe('the keys of the task definition reads', () => {
  it("families: under s1's root, with the prefix and the token; revisions: under the family's root, with the status and the token; a revision: s1's root of it", async () => {
    vi.mocked(api.listFamilies).mockImplementation((_at, _prefix, token) =>
      Promise.resolve(token === undefined ? { items: ['web'], nextToken: 'fam-tok' } : { items: [] }),
    );
    const families = renderHook(() => useFamilyListing(ENDPOINT, 'we'), { wrapper });
    await waitFor(() => {
      expect(families.result.current.openEnd).toBe(true);
    });
    act(() => {
      families.result.current.goToPage(2);
    });
    await waitFor(() => {
      expect(api.listFamilies).toHaveBeenCalledTimes(2);
    });
    const familyKey = keys().find((key) => under(key, ECS_KEYS.families()) && key.includes('fam-tok'));
    expect(familyKey).toBeDefined();
    expect(under(familyKey ?? [], ECS_KEYS.families('we'))).toBe(true);
    families.unmount();

    vi.mocked(api.listRevisions).mockImplementation((_at, _family, _status, token) =>
      Promise.resolve(
        token === undefined
          ? { items: [{ value: 'web:2', family: 'web', revision: 2 }], nextToken: 'rev-tok' }
          : { items: [] },
      ),
    );
    const revisions = renderHook(() => useRevisionListing(ENDPOINT, 'web', 'INACTIVE'), { wrapper });
    await waitFor(() => {
      expect(revisions.result.current.openEnd).toBe(true);
    });
    act(() => {
      revisions.result.current.goToPage(2);
    });
    await waitFor(() => {
      expect(api.listRevisions).toHaveBeenCalledTimes(2);
    });
    const revisionsKey = keys().find((key) => under(key, ECS_KEYS.familyRevisions('web')) && key.includes('rev-tok'));
    expect(revisionsKey).toBeDefined();
    expect(under(revisionsKey ?? [], ECS_KEYS.familyRevisions('web', 'INACTIVE'))).toBe(true);
    revisions.unmount();

    vi.mocked(api.getRevision).mockResolvedValue({ found: false });
    const revision = renderHook(() => useRevision(ENDPOINT, 'web', 2), { wrapper });
    await waitFor(() => {
      expect(revision.result.current.value).toEqual({ found: false });
    });
    expect(keys().some((key) => under(key, ECS_KEYS.revision('web', 2)))).toBe(true);
    expect(api.getRevision).toHaveBeenCalledWith(ENDPOINT, 'web', 2, expect.any(AbortSignal));
  });
});
