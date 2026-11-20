import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RequestError } from '../../../../lib/aws/request';
import { usePagedChoices, type ChoiceSource } from './use-paged-choices';
import type { TokenPage } from './use-token-listing';

// The hook with a stand-in reader whose calls the case settles, so the case decides when and in what order the
// answers arrive. The reader and its words name no service.

const ENDPOINT = 'http://127.0.0.1:9998';

interface Call {
  text: string;
  token: string | undefined;
  signal: AbortSignal;
  resolve: (page: TokenPage<string>) => void;
  reject: (error: unknown) => void;
}

let calls: Call[];
let client: QueryClient;

function source(filtering: ChoiceSource<string>['filtering'] = 'sent'): ChoiceSource<string> {
  return {
    key: ['test', 'things'],
    endpoint: ENDPOINT,
    operation: 'ListThings',
    filtering,
    read: (_endpoint, text, token, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ text, token, signal, resolve, reject });
      }),
    optionOf: (thing) => ({ value: thing, label: thing }),
  };
}

async function nth(n: number): Promise<Call> {
  await waitFor(() => {
    expect(calls.length).toBeGreaterThan(n);
  });
  return calls[n] as Call;
}

beforeEach(() => {
  calls = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mount(initial: { opened: boolean; text: string }, filtering?: ChoiceSource<string>['filtering']) {
  const given = source(filtering);
  return renderHook(({ opened, text }) => usePagedChoices(given, opened, text), {
    wrapper,
    initialProps: initial,
  });
}

describe('usePagedChoices', () => {
  it('nothing is asked before the field is opened; opened → the first page', async () => {
    const { result, rerender } = mount({ opened: false, text: '' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);
    expect(result.current.choices).toBeUndefined();
    expect(result.current.loading).toBe(false);

    rerender({ opened: true, text: '' });
    const first = await nth(0);
    expect(first.token).toBeUndefined();
    expect(first.text).toBe('');
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });
    act(() => {
      first.resolve({ items: ['a', 'b'] });
    });
    await waitFor(() => {
      expect(result.current.choices).toEqual(['a', 'b']);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.more).toBe(false);
  });

  it('"more" asks with the token and adds to the choices; no token → no more', async () => {
    const { result } = mount({ opened: true, text: '' });
    (await nth(0)).resolve({ items: ['a'], next: 't-1' });
    await waitFor(() => {
      expect(result.current.more).toBe(true);
    });
    act(() => {
      result.current.loadMore();
    });
    const second = await nth(1);
    expect(second.token).toBe('t-1');
    act(() => {
      second.resolve({ items: ['b'] });
    });
    await waitFor(() => {
      expect(result.current.choices).toEqual(['a', 'b']);
    });
    expect(result.current.more).toBe(false);
    act(() => {
      result.current.loadMore();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(2);
  });

  it('a further page that comes back empty adds nothing and ends the list', async () => {
    const { result } = mount({ opened: true, text: '' });
    (await nth(0)).resolve({ items: ['a'], next: 't-1' });
    await waitFor(() => {
      expect(result.current.more).toBe(true);
    });
    act(() => {
      result.current.loadMore();
    });
    (await nth(1)).resolve({ items: [], next: 't-2' });
    await waitFor(() => {
      expect(result.current.more).toBe(false);
    });
    expect(result.current.choices).toEqual(['a']);
  });

  it('a changed text starts again from the first page with the new filter; a late answer for an earlier text is not shown', async () => {
    const { result, rerender } = mount({ opened: true, text: '' });
    (await nth(0)).resolve({ items: ['a', 'b'], next: 't-1' });
    await waitFor(() => {
      expect(result.current.choices).toEqual(['a', 'b']);
    });

    rerender({ opened: true, text: 'or' });
    const early = await nth(1);
    expect(early.text).toBe('or');
    expect(early.token).toBeUndefined();
    expect(result.current.text).toBe('or');
    expect(result.current.choices).toBeUndefined();

    rerender({ opened: true, text: 'ord' });
    const late = await nth(2);
    expect(late.text).toBe('ord');
    act(() => {
      late.resolve({ items: ['orders'] });
    });
    await waitFor(() => {
      expect(result.current.choices).toEqual(['orders']);
    });
    act(() => {
      early.resolve({ items: ['ore'] });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.choices).toEqual(['orders']);
    expect(result.current.text).toBe('ord');
  });

  it('a source that sends no text reads without it, whatever is typed', async () => {
    const { result, rerender } = mount({ opened: true, text: '' }, 'none');
    (await nth(0)).resolve({ items: ['a'] });
    await waitFor(() => {
      expect(result.current.choices).toEqual(['a']);
    });
    rerender({ opened: true, text: 'zz' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls).toHaveLength(1);
    expect(result.current.text).toBe('');
  });

  it('a failed further page keeps the choices read and says it failed; "retry" asks that page again', async () => {
    const { result } = mount({ opened: true, text: '' });
    (await nth(0)).resolve({ items: ['a'], next: 't-1' });
    await waitFor(() => {
      expect(result.current.more).toBe(true);
    });
    act(() => {
      result.current.loadMore();
    });
    const failing = await nth(1);
    act(() => {
      failing.reject(new RequestError({ kind: 'other', operation: 'ListThings', code: 'Throttling', message: 'slow' }));
    });
    await waitFor(() => {
      expect(result.current.failure).toEqual({
        kind: 'other',
        operation: 'ListThings',
        code: 'Throttling',
        message: 'slow',
      });
    });
    expect(result.current.choices).toEqual(['a']);

    act(() => {
      result.current.retry();
    });
    const again = await nth(2);
    expect(again.token).toBe('t-1');
    act(() => {
      again.resolve({ items: ['b'] });
    });
    await waitFor(() => {
      expect(result.current.choices).toEqual(['a', 'b']);
    });
    expect(result.current.failure).toBeUndefined();
  });

  it('a failed first page says it failed; "retry" asks the first page again', async () => {
    const { result } = mount({ opened: true, text: '' });
    (await nth(0)).reject(new RequestError({ kind: 'not-implemented', operation: 'ListThings' }));
    await waitFor(() => {
      expect(result.current.failure?.kind).toBe('not-implemented');
    });
    act(() => {
      result.current.retry();
    });
    const again = await nth(1);
    expect(again.token).toBeUndefined();
    act(() => {
      again.resolve({ items: ['a'] });
    });
    await waitFor(() => {
      expect(result.current.choices).toEqual(['a']);
    });
  });
});
