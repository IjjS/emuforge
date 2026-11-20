import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { DEFINITION_CHOICE_KEYS } from './definition-choices';
import { ECS_KEYS } from './queries';
import * as api from './register-api';
import { useRegisterTaskDefinition } from './register-queries';

// Test criteria, "Unit s7 — services/ecs/register-queries.test.tsx" (issue 575). The register over `register-api.ts`,
// whose call the case answers (`register-api.test.ts` proves the call).

vi.mock('./register-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./register-api')>();
  return { ...real, registerTaskDefinition: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9996';
const INPUT = { family: 'web', containerDefinitions: [{ name: 'app', image: 'busybox' }] };

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

const signal = () => new AbortController().signal;

describe('register a task definition', () => {
  it("a successful register invalidates the families, the family's revisions and the choices by their roots, and cancels and removes the registered revision's read", async () => {
    vi.mocked(api.registerTaskDefinition).mockResolvedValue({ family: 'web', revision: 4 });
    // Held from before: a not-found of the new revision's page, and a read of it still out; and another revision.
    client.setQueryData([...ECS_KEYS.revision('web', 4), ENDPOINT, 1, 0], { found: false });
    let outSignal: AbortSignal | undefined;
    const out = client
      .fetchQuery({
        queryKey: [...ECS_KEYS.revision('web', 4), ENDPOINT, 2, 0],
        queryFn: ({ signal: querySignal }) => {
          outSignal = querySignal;
          return new Promise(() => undefined);
        },
      })
      .catch(() => undefined);
    const other = [...ECS_KEYS.revision('web', 3), ENDPOINT, 3, 0];
    client.setQueryData(other, { found: false });
    let otherSignal: AbortSignal | undefined;
    const otherOut = [...ECS_KEYS.revision('web', 3), ENDPOINT, 4, 0];
    void client
      .fetchQuery({
        queryKey: otherOut,
        queryFn: ({ signal: querySignal }) => {
          otherSignal = querySignal;
          return new Promise(() => undefined);
        },
      })
      .catch(() => undefined);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useRegisterTaskDefinition(ENDPOINT), { wrapper });
    expect(await result.current(INPUT, signal())).toEqual({ family: 'web', revision: 4 });
    expect(vi.mocked(api.registerTaskDefinition).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, INPUT]);
    await out;
    expect(outSignal?.aborted).toBe(true);
    expect(client.getQueryCache().findAll({ queryKey: ECS_KEYS.revision('web', 4) })).toEqual([]);
    // Another revision's read is untouched: held, and still out.
    expect(client.getQueryData(other)).toEqual({ found: false });
    expect(otherSignal?.aborted).toBe(false);
    expect(client.getQueryState(otherOut)?.fetchStatus).toBe('fetching');
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ECS_KEYS.families(),
      ECS_KEYS.familyRevisions('web'),
      DEFINITION_CHOICE_KEYS.families,
      DEFINITION_CHOICE_KEYS.revisions,
    ]);
  });

  it('a refused register changes nothing held', async () => {
    vi.mocked(api.registerTaskDefinition).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'RegisterTaskDefinition', code: 'ClientException' }),
    );
    const held = [...ECS_KEYS.revision('web', 4), ENDPOINT, 1, 0];
    client.setQueryData(held, { found: false });
    const families = [...ECS_KEYS.families(''), ENDPOINT, 1];
    client.setQueryData(families, { items: ['web'] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const cancel = vi.spyOn(client, 'cancelQueries');
    const remove = vi.spyOn(client, 'removeQueries');
    const { result } = renderHook(() => useRegisterTaskDefinition(ENDPOINT), { wrapper });
    await expect(result.current(INPUT, signal())).rejects.toBeInstanceOf(RequestError);
    expect(client.getQueryData(held)).toEqual({ found: false });
    expect(client.getQueryData(families)).toEqual({ items: ['web'] });
    expect(client.getQueryState(families)?.isInvalidated).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
