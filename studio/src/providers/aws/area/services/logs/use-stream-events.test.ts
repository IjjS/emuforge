import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { getLogEvents, type EventPage } from './event-api';
import { useStreamEvents } from './use-stream-events';

vi.mock('./event-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./event-api')>()),
  getLogEvents: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8311';
const group = '/app#group';
const stream = 'web';
const read = vi.mocked(getLogEvents);

beforeEach(() => read.mockReset());

function page(messages: string[], nextBackwardToken: string, nextForwardToken: string): EventPage {
  return { events: messages.map((message) => ({ message })), nextBackwardToken, nextForwardToken };
}

function pendingPage() {
  let resolve!: (value: EventPage) => void;
  const promise = new Promise<EventPage>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function open() {
  read.mockResolvedValueOnce(page(['initial'], 'older-1', 'newer-1'));
  const hook = renderHook(({ name }) => useStreamEvents(endpoint, group, name), { initialProps: { name: stream } });
  await waitFor(() => expect(hook.result.current.events).toEqual([{ message: 'initial' }]));
  return hook;
}

function expectTokens(...tokens: string[]) {
  expect(read.mock.calls.map(([, , , request]) => request)).toEqual([
    { kind: 'newest' },
    ...tokens.map((token) => ({ kind: 'continue', token })),
  ]);
}

it('keeps the two ends independent while prepending and appending in turn', async () => {
  const { result } = await open();
  read
    .mockResolvedValueOnce(page(['older'], 'older-2', 'wrong-newer'))
    .mockResolvedValueOnce(page(['newer'], 'wrong-older', 'newer-2'))
    .mockResolvedValueOnce(page(['oldest'], 'older-3', 'wrong-newer'));

  await act(async () => result.current.load('older'));
  expect(result.current.events?.map(({ message }) => message)).toEqual(['older', 'initial']);

  await act(async () => result.current.load('newer'));
  expect(result.current.events?.map(({ message }) => message)).toEqual(['older', 'initial', 'newer']);

  await act(async () => result.current.load('older'));
  expectTokens('older-1', 'newer-1', 'older-2');
  expect(result.current.events?.map(({ message }) => message)).toEqual(['oldest', 'older', 'initial', 'newer']);
});

it('ends older reads on an empty page and leaves newer reads available', async () => {
  const { result } = await open();
  read.mockResolvedValueOnce(page([], 'older-1', 'wrong-newer'));
  await act(async () => result.current.load('older'));
  expect(result.current.older).toMatchObject({ token: undefined, empty: true });
  act(() => result.current.load('older'));

  read.mockResolvedValueOnce(page([], 'wrong-older', 'newer-1'));
  await act(async () => result.current.load('newer'));
  expect(result.current.newer).toMatchObject({ token: 'newer-1', empty: true });
  read.mockResolvedValueOnce(page(['new'], 'wrong-older', 'newer-2'));
  await act(async () => result.current.load('newer'));
  expectTokens('older-1', 'newer-1', 'newer-1');
  expect(result.current.newer).toMatchObject({ token: 'newer-2', empty: false });
});

it('issues a single request per direction while both ends can be in flight', async () => {
  const { result } = await open();
  const older = pendingPage();
  const newer = pendingPage();
  read.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  act(() => {
    result.current.load('older');
    result.current.load('older');
    result.current.load('newer');
    result.current.load('newer');
  });
  expectTokens('older-1', 'newer-1');
  expect(result.current.older.reading).toBe(true);
  expect(result.current.newer.reading).toBe(true);

  await act(async () => newer.resolve(page(['new'], 'wrong-older', 'newer-2')));
  await act(async () => older.resolve(page(['old'], 'older-2', 'wrong-newer')));
  expect(result.current.events?.map(({ message }) => message)).toEqual(['old', 'initial', 'new']);
});

it('aborts the previous stream read and drops its answer when the stream changes', async () => {
  const { result, rerender } = await open();
  const old = pendingPage();
  read.mockReturnValueOnce(old.promise);
  act(() => result.current.load('older'));
  const oldSignal = read.mock.lastCall?.[4];
  const fresh = pendingPage();
  read.mockReturnValueOnce(fresh.promise);
  rerender({ name: 'other' });
  expect(oldSignal?.aborted).toBe(true);
  expect(result.current.events).toBeUndefined();
  await act(async () => fresh.resolve(page(['other stream'], 'other-older', 'other-newer')));
  await act(async () => old.resolve(page(['late'], 'late-older', 'late-newer')));
  expect(read).toHaveBeenLastCalledWith(endpoint, group, 'other', { kind: 'newest' }, expect.any(AbortSignal));
  expect(result.current.events?.map(({ message }) => message)).toEqual(['other stream']);
});

it.each([
  { failed: 'older', other: 'newer', events: ['retry', 'initial', 'other'] },
  { failed: 'newer', other: 'older', events: ['other', 'initial', 'retry'] },
] as const)('retries the failed $failed token while $other can keep reading', async ({ failed, other, events }) => {
  const { result } = await open();
  const failure = { kind: 'other', code: 'InvalidParameterException', operation: 'GetLogEvents' } as const;
  read.mockRejectedValueOnce(new RequestError(failure));
  await act(async () => result.current.load(failed));
  expect(result.current.events).toEqual([{ message: 'initial' }]);
  expect(result.current[failed]).toMatchObject({ token: `${failed}-1`, reading: false, failure });
  expect(result.current[other]).toEqual({ token: `${other}-1` });

  read.mockResolvedValueOnce(page(['other'], 'backward-2', 'forward-2'));
  await act(async () => result.current.load(other));
  read.mockResolvedValueOnce(page(['retry'], 'backward-3', 'forward-3'));
  await act(async () => result.current.load(failed));
  expectTokens(`${failed}-1`, `${other}-1`, `${failed}-1`);
  expect(result.current.events?.map(({ message }) => message)).toEqual(events);
  expect(result.current[failed].failure).toBeUndefined();
  expect(result.current[other].token).toBe(other === 'older' ? 'backward-2' : 'forward-2');
});

const submittedTime = 123;
const fromTime = { kind: 'from-time', time: submittedTime };
const beforeTime = { kind: 'before-time', time: submittedTime };

function requests() {
  return read.mock.calls.map(([, , , request]) => request);
}

it('starts at the put time and pages independently on both sides without sending either opposite token', async () => {
  const { result } = await open();
  read
    .mockResolvedValueOnce(page(['put', 'ahead'], 'wrong-older', 'after-1'))
    .mockResolvedValueOnce(page(['later'], 'wrong-older', 'after-2'))
    .mockResolvedValueOnce(page(['before'], 'before-1', 'wrong-newer'))
    .mockResolvedValueOnce(page(['earliest'], 'before-2', 'wrong-newer'))
    .mockResolvedValueOnce(page(['latest'], 'wrong-older', 'after-3'));

  await act(async () => result.current.readFrom(submittedTime));
  expect(result.current.events?.map(({ message }) => message)).toEqual(['put', 'ahead']);
  for (const direction of ['newer', 'older', 'older', 'newer'] as const) {
    await act(async () => result.current.load(direction));
  }
  expect(requests()).toEqual([
    { kind: 'newest' },
    fromTime,
    { kind: 'continue', token: 'after-1' },
    beforeTime,
    { kind: 'continue', token: 'before-1' },
    { kind: 'continue', token: 'after-2' },
  ]);
  expect(result.current.events?.map(({ message }) => message)).toEqual([
    'earliest',
    'before',
    'put',
    'ahead',
    'later',
    'latest',
  ]);
});

it('aborts a read started before a put and ignores its late answer', async () => {
  const { result } = await open();
  const old = pendingPage();
  read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(['put'], 'wrong-older', 'after-1'));
  act(() => result.current.load('older'));
  const oldSignal = read.mock.lastCall?.[4];
  await act(async () => result.current.readFrom(submittedTime));
  await act(async () => old.resolve(page(['stale'], 'stale-older', 'stale-newer')));
  expect(oldSignal?.aborted).toBe(true);
  expect(result.current.events).toEqual([{ message: 'put' }]);
});

it('retries the first older read with its time bound and leaves the newer end alone', async () => {
  const { result } = await open();
  const failure = { kind: 'other', code: 'InvalidParameterException', operation: 'GetLogEvents' } as const;
  read.mockResolvedValueOnce(page(['put'], 'wrong-older', 'after-1')).mockRejectedValueOnce(new RequestError(failure));
  await act(async () => result.current.readFrom(submittedTime));
  await act(async () => result.current.load('older'));
  expect(result.current.events).toEqual([{ message: 'put' }]);
  expect(result.current.newer).toEqual({ token: 'after-1' });
  expect(result.current.older).toMatchObject({ beforeTime: submittedTime, failure });

  read
    .mockResolvedValueOnce(page(['before'], 'before-1', 'wrong-newer'))
    .mockResolvedValueOnce(page(['earliest'], 'before-2', 'wrong-newer'));
  await act(async () => result.current.load('older'));
  await act(async () => result.current.load('older'));
  expect(requests()).toEqual([
    { kind: 'newest' },
    fromTime,
    beforeTime,
    beforeTime,
    { kind: 'continue', token: 'before-1' },
  ]);
  expect(result.current.events?.map(({ message }) => message)).toEqual(['earliest', 'before', 'put']);
  expect(result.current.newer).toEqual({ token: 'after-1' });
});
