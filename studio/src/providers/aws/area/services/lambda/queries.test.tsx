import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import {
  functionListKey,
  REREAD_DELAY_MS,
  useDeleteFunctions,
  useFunctionListing,
  useFunctionReading,
  useInvoke,
  useRoleList,
  useUpdateFunctionCode,
  useUpdateFunctionConfiguration,
  type FunctionListingOptions,
  type FunctionReadingOptions,
} from './queries';

// The test plays the engine behind the page's `fetch`. Each AWS request waits until the case answers it, so a case
// decides the order in which answers arrive and when.

interface SentRequest {
  method: string;
  url: URL;
  body: string;
  /** When it was sent, by `performance.now()`. */
  at: number;
  signal: AbortSignal;
  respond: (response: Response) => void;
}

class FakeEngine {
  readonly sent: SentRequest[] = [];
  /** Answers a request at once instead of waiting for the case, when it gives an answer. */
  auto: ((request: SentRequest) => Response | undefined) | undefined;

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-84' }), { status: 200 });
    }
    const body = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
    return new Promise((resolve, reject) => {
      const sent: SentRequest = {
        method: request.method,
        url,
        body,
        at: performance.now(),
        signal: request.signal,
        respond: resolve,
      };
      request.signal.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
      this.sent.push(sent);
      const answer = this.auto?.(sent);
      if (answer !== undefined) {
        resolve(answer);
      }
    });
  };

  /** The n-th AWS request (from 0), once it has been sent. */
  async request(n: number): Promise<SentRequest> {
    await waitFor(
      () => {
        expect(this.sent.length).toBeGreaterThan(n);
      },
      { timeout: 4000 },
    );
    return this.sent[n] as SentRequest;
  }

  ofPath(fragment: string): SentRequest[] {
    return this.sent.filter(({ url }) => url.pathname.includes(fragment));
  }
}

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function listAnswer(names: string[], nextMarker?: string, extra: Record<string, unknown> = {}): Response {
  return json(200, {
    Functions: names.map((name) => ({ FunctionName: name, Description: '', ...extra })),
    ...(nextMarker === undefined ? {} : { NextMarker: nextMarker }),
  });
}

function functionAnswer(state: string, lastUpdateStatus?: string): Response {
  return json(200, {
    Configuration: {
      FunctionName: 'orders',
      State: state,
      ...(lastUpdateStatus === undefined ? {} : { LastUpdateStatus: lastUpdateStatus }),
    },
  });
}

function notFound(): Response {
  return new Response(JSON.stringify({ Message: 'The resource you requested does not exist.' }), {
    status: 404,
    headers: { 'content-type': 'application/json', 'x-amzn-errortype': 'ResourceNotFoundException' },
  });
}

function unavailable(): Response {
  return new Response(JSON.stringify({ __type: 'EmulatorUnavailable', message: 'not reachable' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'x-amzn-errortype': 'EmulatorUnavailable' },
  });
}

/** A refusal the SDK does not retry. */
function refused(): Response {
  return new Response(JSON.stringify({ Message: 'refused for the test' }), {
    status: 400,
    headers: { 'content-type': 'application/json', 'x-amzn-errortype': 'InvalidParameterValueException' },
  });
}

function names(count: number, from = 'f'): string[] {
  return Array.from({ length: count }, (_, index) => `${from}-${String(index + 1)}`);
}

let nextPort = 8940;
let engine: FakeEngine;
let endpoint: string;
let client: QueryClient;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
  // As Studio's query client: nothing retried or refetched behind the screen's back.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderListing(options: Partial<FunctionListingOptions> = {}) {
  return renderHook((props: FunctionListingOptions) => useFunctionListing(props), {
    initialProps: { endpoint, pageSize: 25, filter: '', connected: true, ...options },
    wrapper,
  });
}

function renderReading(options: Partial<FunctionReadingOptions> = {}) {
  return renderHook((props: FunctionReadingOptions) => useFunctionReading(props), {
    initialProps: { endpoint, name: 'orders', connected: true, ...options },
    wrapper,
  });
}

/** Answers the `GetFunctionUrlConfig` beside each `GetFunction`, at once, with "no URL". */
function answerUrlsAtOnce() {
  engine.auto = (request) => (request.url.pathname.endsWith('/url') ? notFound() : undefined);
}

/** The `GetFunction` requests sent so far. */
function getFunctions(): SentRequest[] {
  return engine.sent.filter(({ url }) => /^\/2015-03-31\/functions\/[^/]+$/.test(url.pathname));
}

async function nthGetFunction(n: number): Promise<SentRequest> {
  await waitFor(
    () => {
      expect(getFunctions().length).toBeGreaterThan(n);
    },
    { timeout: 4000 },
  );
  return getFunctions()[n] as SentRequest;
}

describe('the list’s query key', () => {
  it('holds the engine’s origin, the page size, the filter and the marker, and differs when any of them does', () => {
    const base = { endpoint, pageSize: 25, filter: 'ab', marker: 'abc' };
    const key = functionListKey(base);

    expect(key).toEqual(expect.arrayContaining([endpoint, 25, 'ab', 'abc']));
    const variants = [
      functionListKey({ ...base, endpoint: engineEndpoint(nextPort + 100) }),
      functionListKey({ ...base, pageSize: 50 }),
      functionListKey({ ...base, filter: 'abc' }),
      functionListKey({ ...base, marker: 'abd' }),
      functionListKey({ ...base, marker: undefined }),
    ];
    for (const variant of variants) {
      expect(JSON.stringify(variant)).not.toBe(JSON.stringify(key));
    }
  });
});

describe('a listing', () => {
  it('asks again after the list is left and opened again, and shows nothing of the first answer before the second', async () => {
    const first = renderListing();
    (await engine.request(0)).respond(listAnswer(['earlier']));
    await waitFor(() => {
      expect(first.result.current.functions?.map(({ name }) => name)).toEqual(['earlier']);
    });
    first.unmount();

    const second = renderListing();
    const again = await engine.request(1);
    expect(again.url.pathname).toBe('/2015-03-31/functions');
    expect(second.result.current.functions).toBeUndefined();
    expect(second.result.current.count).toBeUndefined();
    expect(second.result.current.loading).toBe(true);

    act(() => {
      again.respond(listAnswer(['later']));
    });
    await waitFor(() => {
      expect(second.result.current.functions?.map(({ name }) => name)).toEqual(['later']);
    });
  });

  it('shows the newer listing’s page when the older answers last', async () => {
    const { result } = renderListing();
    const older = await engine.request(0);
    act(() => {
      result.current.refresh();
    });
    const newer = await engine.request(1);

    act(() => {
      newer.respond(listAnswer(['newer']));
    });
    await waitFor(() => {
      expect(result.current.functions?.map(({ name }) => name)).toEqual(['newer']);
    });
    expect(older.signal.aborted).toBe(true);
    act(() => {
      older.respond(listAnswer(['older']));
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.functions?.map(({ name }) => name)).toEqual(['newer']);
  });

  it('asks the next page with the marker of the page shown and counts the pages read, "+" while more remain', async () => {
    const { result } = renderListing({ pageSize: 2 });
    (await engine.request(0)).respond(listAnswer(names(2), 'f-2'));
    await waitFor(() => {
      expect(result.current.count).toEqual({ total: 2, more: true });
    });

    act(() => {
      result.current.goToPage(2);
    });
    const second = await engine.request(1);
    expect(second.url.searchParams.get('Marker')).toBe('f-2');
    act(() => {
      second.respond(listAnswer(['g-1']));
    });
    await waitFor(() => {
      expect(result.current.count).toEqual({ total: 3, more: false });
    });
    expect(result.current.currentPage).toBe(2);
    expect(result.current.openEnd).toBe(false);
  });

  it('keeps the page shown, ends the pages and counts one "no more" when a later page comes back empty', async () => {
    const { result } = renderListing({ pageSize: 2 });
    (await engine.request(0)).respond(listAnswer(names(2), 'f-2'));
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });

    act(() => {
      result.current.goToPage(2);
    });
    act(() => {
      void engine.request(1).then((request) => {
        request.respond(listAnswer([]));
      });
    });
    await waitFor(() => {
      expect(result.current.noMoreCount).toBe(1);
    });
    expect(result.current.currentPage).toBe(1);
    expect(result.current.functions?.map(({ name }) => name)).toEqual(['f-1', 'f-2']);
    expect(result.current.openEnd).toBe(false);
    expect(result.current.count).toEqual({ total: 2, more: false });
    expect(result.current.pagesCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(engine.sent).toHaveLength(2);
  });

  it('sends a filtered first page with the marker below the text', async () => {
    renderListing({ filter: 'abc' });

    expect((await engine.request(0)).url.searchParams.get('Marker')).toBe('abb~');
  });

  it('reads nothing again by itself while connected, with a Pending function listed and time passing', async () => {
    const { result } = renderListing();
    (await engine.request(0)).respond(listAnswer(['pending-fn'], undefined, { State: 'Pending' }));
    await waitFor(() => {
      expect(result.current.functions).toHaveLength(1);
    });

    await new Promise((resolve) => setTimeout(resolve, REREAD_DELAY_MS + 300));

    expect(engine.sent).toHaveLength(1);
  });

  it('reads again by itself when a read failed while not connected and the connection becomes connected', async () => {
    // The SDK retries the engine's 503 itself; each attempt is answered at once while the emulator is down.
    let down = true;
    engine.auto = () => (down ? unavailable() : undefined);
    const listing = renderListing({ connected: false });
    await waitFor(() => {
      expect(listing.result.current.failure?.kind).toBe('emulator-did-not-answer');
    });
    const attempts = engine.sent.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(engine.sent).toHaveLength(attempts);
    down = false;

    listing.rerender({ endpoint, pageSize: 25, filter: '', connected: true });

    const again = await engine.request(attempts);
    act(() => {
      again.respond(listAnswer(['back']));
    });
    await waitFor(() => {
      expect(listing.result.current.functions?.map(({ name }) => name)).toEqual(['back']);
    });
    expect(listing.result.current.failure).toBeUndefined();
  });
});

describe('a delete', () => {
  it('starts the list again at page 1', async () => {
    const { result } = renderHook(
      () => ({
        listing: useFunctionListing({ endpoint, pageSize: 2, filter: '', connected: true }),
        remove: useDeleteFunctions(endpoint),
      }),
      { wrapper },
    );
    (await engine.request(0)).respond(listAnswer(names(2), 'f-2'));
    await waitFor(() => {
      expect(result.current.listing.openEnd).toBe(true);
    });
    act(() => {
      result.current.listing.goToPage(2);
    });
    (await engine.request(1)).respond(listAnswer(['g-1', 'g-2'], 'g-2'));
    await waitFor(() => {
      expect(result.current.listing.currentPage).toBe(2);
      expect(result.current.listing.functions).toHaveLength(2);
    });

    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = result.current.remove.remove(['g-1']);
    });
    const deleted = await engine.request(2);
    expect(deleted.method).toBe('DELETE');
    act(() => {
      deleted.respond(json(204, undefined));
    });
    await act(async () => {
      await done;
    });

    const relisted = await engine.request(3);
    expect(relisted.url.pathname).toBe('/2015-03-31/functions');
    expect(relisted.url.searchParams.has('Marker')).toBe(false);
    expect(result.current.listing.currentPage).toBe(1);
    act(() => {
      relisted.respond(listAnswer(['f-1', 'f-2'], 'f-2'));
    });
    await waitFor(() => {
      expect(result.current.listing.functions?.map(({ name }) => name)).toEqual(['f-1', 'f-2']);
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(engine.sent).toHaveLength(4);
  });
});

describe('a function’s page', () => {
  // Bound: real timers: re-readings REREAD_DELAY_MS (1 s) apart and a wait after the last (issue 84 s1, b15ce0d).
  it('reads a Pending function again 1 second after the answer, until it is Active and not InProgress, then no more', async () => {
    answerUrlsAtOnce();
    const { result } = renderReading();
    const answers = [
      functionAnswer('Pending'),
      functionAnswer('Active', 'InProgress'),
      functionAnswer('Active', 'Successful'),
    ];

    for (const [index, answer] of answers.entries()) {
      const request = await nthGetFunction(index);
      if (index > 0) {
        const previous = getFunctions()[index - 1] as SentRequest & { answeredAt?: number };
        expect(request.at - (previous.answeredAt ?? 0)).toBeGreaterThanOrEqual(REREAD_DELAY_MS - 50);
      }
      act(() => {
        (request as SentRequest & { answeredAt?: number }).answeredAt = performance.now();
        request.respond(answer);
      });
    }
    await waitFor(() => {
      expect(result.current.read?.found === true && result.current.read.function.lastUpdateStatus).toBe('Successful');
    });

    await new Promise((resolve) => setTimeout(resolve, REREAD_DELAY_MS + 300));
    expect(getFunctions()).toHaveLength(3);
  }, 10000);

  // Bound: real timers: re-readings REREAD_DELAY_MS (1 s) apart and a wait after the last (issue 84 s1, b15ce0d).
  it.each([
    ['Active with InProgress', functionAnswer('Active', 'InProgress'), 2],
    ['Failed', functionAnswer('Failed'), 1],
    ['Inactive', functionAnswer('Inactive'), 1],
  ])(
    'reads a function %s again only while it changes',
    async (_, answer, reads) => {
      answerUrlsAtOnce();
      renderReading();
      (await nthGetFunction(0)).respond(answer);
      if (reads === 2) {
        (await nthGetFunction(1)).respond(functionAnswer('Active', 'Successful'));
      }

      await new Promise((resolve) => setTimeout(resolve, REREAD_DELAY_MS + 300));
      expect(getFunctions()).toHaveLength(reads);
    },
    10000,
  );

  // Bound: real timers: re-readings REREAD_DELAY_MS (1 s) apart and a wait after the last (issue 84 s1, b15ce0d).
  it('shows nothing of a re-reading that fails and reads no more until the next reading', async () => {
    answerUrlsAtOnce();
    const { result } = renderReading();
    (await nthGetFunction(0)).respond(functionAnswer('Pending'));
    await waitFor(() => {
      expect(result.current.read?.found).toBe(true);
    });
    (await nthGetFunction(1)).respond(refused());

    await new Promise((resolve) => setTimeout(resolve, REREAD_DELAY_MS + 300));
    expect(getFunctions()).toHaveLength(2);
    expect(result.current.failure).toBeUndefined();
    expect(result.current.read?.found === true && result.current.read.function.state).toBe('Pending');

    act(() => {
      result.current.refresh();
    });
    (await nthGetFunction(2)).respond(functionAnswer('Pending'));
    (await nthGetFunction(3)).respond(functionAnswer('Active', 'Successful'));
    await waitFor(() => {
      expect(result.current.read?.found === true && result.current.read.function.state).toBe('Active');
    });
  }, 10000);

  it('reads again by itself when a read failed while not connected and the connection becomes connected', async () => {
    let down = true;
    engine.auto = (request) => (request.url.pathname.endsWith('/url') ? notFound() : down ? unavailable() : undefined);
    const reading = renderReading({ connected: false });
    await waitFor(() => {
      expect(reading.result.current.failure?.kind).toBe('emulator-did-not-answer');
    });
    const attempts = getFunctions().length;
    down = false;

    reading.rerender({ endpoint, name: 'orders', connected: true });

    (await nthGetFunction(attempts)).respond(functionAnswer('Active', 'Successful'));
    await waitFor(() => {
      expect(reading.result.current.read?.found).toBe(true);
    });
    expect(reading.result.current.failure).toBeUndefined();
  });

  it('gives "not found" for a function the emulator does not hold', async () => {
    answerUrlsAtOnce();
    const { result } = renderReading();
    (await nthGetFunction(0)).respond(notFound());

    await waitFor(() => {
      expect(result.current.read).toEqual({ found: false });
    });
    expect(result.current.failure).toBeUndefined();
  });
});

describe('the roles of "Existing role"', () => {
  function rolesAnswer(roleNames: string[], marker?: string): Response {
    const members = roleNames
      .map(
        (name) =>
          `<member><Path>/</Path><RoleName>${name}</RoleName><Arn>arn:aws:iam::000000000000:role/${name}</Arn></member>`,
      )
      .join('');
    return new Response(
      `<ListRolesResponse><ListRolesResult><IsTruncated>${String(marker !== undefined)}</IsTruncated>${
        marker === undefined ? '' : `<Marker>${marker}</Marker>`
      }<Roles>${members}</Roles></ListRolesResult></ListRolesResponse>`,
      { status: 200, headers: { 'content-type': 'text/xml' } },
    );
  }

  it('reads nothing until the select is opened, then one page at a time as the end of the options is reached', async () => {
    const { result } = renderHook(() => useRoleList(endpoint), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(engine.sent).toHaveLength(0);
    expect(result.current.status).toBe('pending');

    act(() => {
      result.current.load(true);
    });
    const first = await engine.request(0);
    expect(new URLSearchParams(first.body).has('Marker')).toBe(false);
    expect(result.current.status).toBe('loading');
    act(() => {
      first.respond(rolesAnswer(['a', 'b'], 'm-1'));
    });
    await waitFor(() => {
      expect(result.current.roles.map(({ name }) => name)).toEqual(['a', 'b']);
    });
    expect(result.current.status).toBe('pending');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(engine.sent).toHaveLength(1);

    act(() => {
      result.current.load(false);
    });
    const second = await engine.request(1);
    expect(new URLSearchParams(second.body).get('Marker')).toBe('m-1');
    act(() => {
      second.respond(rolesAnswer(['c']));
    });
    await waitFor(() => {
      expect(result.current.status).toBe('finished');
    });
    expect(result.current.roles.map(({ name }) => name)).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Invoke, upload, save (issue 516, test criteria "Unit s1 — queries.test.tsx").

function invokeAnswer(payload: string, functionError?: string): Response {
  return new Response(payload, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(functionError === undefined ? {} : { 'x-amz-function-error': functionError }),
    },
  });
}

/** The page's reading of `orders` with the three actions of its tabs, as the function's page holds them. */
function renderPage() {
  return renderHook(
    () => ({
      reading: useFunctionReading({ endpoint, name: 'orders', connected: true }),
      invocation: useInvoke(endpoint, 'orders'),
      upload: useUpdateFunctionCode(endpoint, 'orders'),
      save: useUpdateFunctionConfiguration(endpoint, 'orders'),
    }),
    { wrapper },
  );
}

/** The page opened on an Active function, its first reading answered. */
async function openedPage() {
  answerUrlsAtOnce();
  const page = renderPage();
  (await nthGetFunction(0)).respond(functionAnswer('Active', 'Successful'));
  await waitFor(() => {
    expect(page.result.current.reading.read?.found).toBe(true);
  });
  return page;
}

function sentOf(fragment: string): SentRequest[] {
  return engine.sent.filter(({ url }) => url.pathname.endsWith(fragment));
}

async function nthOf(fragment: string, n: number): Promise<SentRequest> {
  await waitFor(() => {
    expect(sentOf(fragment).length).toBeGreaterThan(n);
  });
  return sentOf(fragment)[n] as SentRequest;
}

describe('the actions of a function’s page', () => {
  it('a finished invoke reads the function again, keeping the function shown meanwhile', async () => {
    const page = await openedPage();

    act(() => {
      page.result.current.invocation.mutate('{}');
    });
    (await nthOf('/invocations', 0)).respond(invokeAnswer('"ok"'));

    const reread = await nthGetFunction(1);
    expect(page.result.current.reading.read?.found).toBe(true);
    reread.respond(functionAnswer('Active', 'Successful'));
    await waitFor(() => {
      expect(page.result.current.invocation.data).toEqual({ payload: '"ok"', log: '' });
    });
  });

  it('an invoke that fails with ResourceNotFoundException reads the function again, which is then not found', async () => {
    const page = await openedPage();

    act(() => {
      page.result.current.invocation.mutate('{}');
    });
    (await nthOf('/invocations', 0)).respond(notFound());

    (await nthGetFunction(1)).respond(notFound());
    await waitFor(() => {
      expect(page.result.current.reading.read).toEqual({ found: false });
    });
    expect(page.result.current.invocation.error).toMatchObject({
      kind: 'other',
      operation: 'Invoke',
      code: 'ResourceNotFoundException',
    });
  });

  it('a finished upload reads the function again', async () => {
    const page = await openedPage();
    const onSuccess = vi.fn();

    act(() => {
      page.result.current.upload.mutate(new Uint8Array([80, 75, 5, 6]), { onSuccess });
    });
    (await nthOf('/code', 0)).respond(json(200, { FunctionName: 'orders', LastUpdateStatus: 'InProgress' }));

    (await nthGetFunction(1)).respond(functionAnswer('Active', 'InProgress'));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('a finished save reads the function again; a refused one does not, and gives its failure', async () => {
    const page = await openedPage();
    const onError = vi.fn();

    act(() => {
      page.result.current.save.mutate({ timeout: 1 }, { onError });
    });
    (await nthOf('/configuration', 0)).respond(refused());
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith({
        kind: 'other',
        operation: 'UpdateFunctionConfiguration',
        code: 'InvalidParameterValueException',
        message: 'refused for the test',
      });
    });
    expect(page.result.current.save.error).toMatchObject({ code: 'InvalidParameterValueException' });
    expect(getFunctions()).toHaveLength(1);

    act(() => {
      page.result.current.save.mutate({ timeout: 2 });
    });
    (await nthOf('/configuration', 1)).respond(json(200, { FunctionName: 'orders' }));
    await nthGetFunction(1);
  });

  it('an upload or save refused with ResourceNotFoundException reads the function again', async () => {
    const page = await openedPage();

    act(() => {
      page.result.current.save.mutate({ description: 'x' });
    });
    (await nthOf('/configuration', 0)).respond(notFound());

    (await nthGetFunction(1)).respond(notFound());
    await waitFor(() => {
      expect(page.result.current.reading.read).toEqual({ found: false });
    });
  });

  it('a second invoke while one is in flight sends nothing', async () => {
    const page = await openedPage();

    act(() => {
      page.result.current.invocation.mutate('{}');
    });
    await nthOf('/invocations', 0);
    await waitFor(() => {
      expect(page.result.current.invocation.isPending).toBe(true);
    });
    act(() => {
      page.result.current.invocation.mutate('{"again": true}');
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentOf('/invocations')).toHaveLength(1);
  });

  it('keeps qualified Invoke unavailable after a 501 and still permits the default target', async () => {
    const page = await openedPage();
    engine.auto = (request) =>
      request.url.pathname.endsWith('/url')
        ? notFound()
        : /^\/2015-03-31\/functions\/[^/]+$/.test(request.url.pathname)
          ? functionAnswer('Active', 'Successful')
          : undefined;

    act(() => page.result.current.invocation.mutate('{}', 'live'));
    const qualified = await nthOf('/invocations', 0);
    expect(qualified.url.searchParams.get('Qualifier')).toBe('live');
    qualified.respond(new Response('', { status: 501 }));

    await waitFor(() => expect(page.result.current.invocation.isUnsupported('live')).toBe(true));
    expect(page.result.current.invocation.qualifier).toBe('live');
    expect(page.result.current.invocation.error).toEqual({ kind: 'not-implemented', operation: 'Invoke' });
    act(() => page.result.current.invocation.mutate('{}', 'live'));
    act(() => page.result.current.invocation.mutate('{}'));
    const unqualified = await nthOf('/invocations', 1);
    expect(unqualified.url.searchParams.has('Qualifier')).toBe(false);
    unqualified.respond(invokeAnswer('"ok"'));
    await waitFor(() => expect(page.result.current.invocation.data?.payload).toBe('"ok"'));
    expect(sentOf('/invocations')).toHaveLength(2);
  });

  it('an invoke in flight when the page unmounts is aborted', async () => {
    const page = await openedPage();

    act(() => {
      page.result.current.invocation.mutate('{}');
    });
    const request = await nthOf('/invocations', 0);
    expect(request.signal.aborted).toBe(false);

    page.unmount();

    expect(request.signal.aborted).toBe(true);
  });

  it('an upload in flight when the page unmounts is aborted', async () => {
    const page = await openedPage();

    act(() => {
      page.result.current.upload.mutate(new Uint8Array([1]));
    });
    const request = await nthOf('/code', 0);

    page.unmount();

    expect(request.signal.aborted).toBe(true);
  });

  it('the last result of an invoke stays readable until the next answer replaces it', async () => {
    const page = await openedPage();
    engine.auto = (request) =>
      request.url.pathname.endsWith('/url')
        ? notFound()
        : /^\/2015-03-31\/functions\/[^/]+$/.test(request.url.pathname)
          ? functionAnswer('Active', 'Successful')
          : undefined;

    act(() => {
      page.result.current.invocation.mutate('{}');
    });
    (await nthOf('/invocations', 0)).respond(invokeAnswer('{"first":1}'));
    await waitFor(() => {
      expect(page.result.current.invocation.data?.payload).toBe('{"first":1}');
    });
    expect(page.result.current.invocation.answers).toBe(1);

    act(() => {
      page.result.current.invocation.mutate('{}');
    });
    const second = await nthOf('/invocations', 1);
    await waitFor(() => {
      expect(page.result.current.invocation.isPending).toBe(true);
    });
    // In flight: the earlier answer is still there.
    expect(page.result.current.invocation.data?.payload).toBe('{"first":1}');
    expect(page.result.current.invocation.answers).toBe(1);

    second.respond(invokeAnswer('{"errorMessage":"boom"}', 'Unhandled'));
    await waitFor(() => {
      expect(page.result.current.invocation.data).toEqual({
        payload: '{"errorMessage":"boom"}',
        log: '',
        functionError: 'Unhandled',
      });
    });
    expect(page.result.current.invocation.answers).toBe(2);

    act(() => {
      page.result.current.invocation.mutate('{}');
    });
    (await nthOf('/invocations', 2)).respond(refused());
    await waitFor(() => {
      expect(page.result.current.invocation.error).toMatchObject({ code: 'InvalidParameterValueException' });
    });
    expect(page.result.current.invocation.data).toBeUndefined();
    expect(page.result.current.invocation.answers).toBe(3);
  });
});
