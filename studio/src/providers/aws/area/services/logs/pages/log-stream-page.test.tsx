import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageResourcesContext } from '../../../components/page-resources';
import { patternParams, screenCrumbs, screenTitle } from '../../../screen-paths';
import { getLogEvents, type EventPage } from '../event-api';
import { LOG_STREAM_PATH } from '../format';
import { SCREENS } from '../screens/log-stream';
import { LogStreamPage } from './log-stream-page';

vi.mock('../event-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../event-api')>()),
  getLogEvents: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8311';
const EMULATOR = { port: 9311, endpoint: 'https://127.0.0.1:9311' };
const CONNECTED = { kind: 'connected', checkedAt: 0, emulator: EMULATOR } as const;
const operation = 'GetLogEvents';
const read = vi.mocked(getLogEvents);
const address = '/aws/logs/log-groups/group/%2Fapp%23group/stream/a%2Fb%23c%3Fd%25e%20f';
const group = '/app#group';
const stream = 'a/b#c?d%e f';

beforeEach(() => read.mockReset());

function renderPage(result: AreaConnection['result'] = CONNECTED, path = address) {
  const resources = vi.fn();
  const params = patternParams(LOG_STREAM_PATH, path) ?? {};
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <PageResourcesContext.Provider value={resources}>
        <LogStreamPage connection={{ engineOrigin: ENGINE, result }} params={params} />
      </PageResourcesContext.Provider>
    </MemoryRouter>,
  );
  return { resources, params, container };
}

function page(messages: string[]): EventPage {
  return {
    events: messages.map((message, index) => ({ message, timestamp: Date.UTC(2026, 10, 26, 12, 0, index) })),
    nextBackwardToken: 'older-1',
    nextForwardToken: 'newer-1',
  };
}

const log = () => screen.getByRole('log', { name: 'Log events' });
const messages = () => Array.from(log().querySelectorAll('pre'), (block) => block.textContent);
const control = (direction: 'older' | 'newer') => screen.getByRole('group', { name: `Load ${direction} events` });
const button = (direction: 'older' | 'newer') =>
  within(control(direction)).getByRole('button', { name: `Load ${direction} events` });

it.each([
  { path: address, group, stream, groupHref: '/aws/logs/log-groups/group/%2Fapp%23group' },
  {
    path: '/aws/logs/log-groups/group/*./stream/*..',
    group: '.',
    stream: '..',
    groupHref: '/aws/logs/log-groups/group/*.',
  },
])('uses decoded names, a group crumb and a log events notice at $path', async ({ path, group, stream, groupHref }) => {
  read.mockResolvedValueOnce(page(['event']));
  const { resources, params } = renderPage(CONNECTED, path);
  expect(await screen.findByText('event')).toBeVisible();
  expect(screen.getByRole('heading', { level: 1, name: stream })).toBeVisible();
  expect(resources).toHaveBeenCalledWith({ word: 'log events' });
  expect(read).toHaveBeenCalledWith(ENGINE, group, stream, { kind: 'newest' }, expect.any(AbortSignal));
  const [registration] = SCREENS;
  expect(registration?.paths).toEqual([LOG_STREAM_PATH]);
  if (registration === undefined) throw new Error('Missing stream screen');
  expect(screenTitle(registration, params)).toBe(stream);
  expect(screenCrumbs(registration, params)).toEqual([
    { text: 'Log groups', href: '/aws/logs/log-groups' },
    { text: group, href: groupHref },
    { text: stream },
  ]);
});

it('shows loading and renders each timestamp and message in chronological order', async () => {
  const answer = page(['first', 'second']);
  read.mockResolvedValueOnce(answer);
  renderPage();
  expect(screen.getByText('Loading log events')).toBeVisible();
  await screen.findByText('second');
  expect(messages()).toEqual(['first', 'second']);
  for (const { message, timestamp } of answer.events) {
    const block = within(log())
      .getByText(message ?? '')
      .closest('pre');
    expect(block?.parentElement).toHaveTextContent(creationDateText(new Date(timestamp ?? 0)));
  }
});

it('shows an empty initial read', async () => {
  read.mockResolvedValueOnce(page([]));
  renderPage();
  expect(await screen.findByText('No log events')).toBeVisible();
  expect(screen.queryByRole('log')).not.toBeInTheDocument();
});

it('closes the older end on an empty page and keeps the newer control available', async () => {
  read.mockResolvedValueOnce(page(['event'])).mockResolvedValue(page([]));
  renderPage();
  await screen.findByText('event');
  fireEvent.click(button('newer'));
  expect(await within(control('newer')).findByText('No newer events.')).toBeVisible();
  expect(button('newer')).not.toBeDisabled();
  fireEvent.click(button('older'));
  expect(await within(control('older')).findByText('No older events.')).toBeVisible();
  expect(button('older')).toBeDisabled();
  expect(messages()).toEqual(['event']);
});

it.each(['group', 'stream'])('identifies a missing log %s', async (kind) => {
  read.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation,
      code: 'ResourceNotFoundException',
      message: `The specified log ${kind} does not exist.`,
    }),
  );
  renderPage();
  expect(await screen.findByText(`Log ${kind} not found`)).toBeVisible();
  expect(screen.queryByText('No log events')).not.toBeInTheDocument();
});

it('explains the Standard class restriction and shows the emulator reason', async () => {
  const reason = 'This operation is only supported on the Standard log class.';
  read.mockRejectedValueOnce(
    new RequestError({ kind: 'other', operation, code: 'ValidationException', message: reason }),
  );
  renderPage();
  expect(
    await screen.findByText('The emulator reads and searches log events only in log groups of the Standard class.'),
  ).toBeVisible();
  expect(screen.getByText(reason)).toBeVisible();
  expect(screen.queryByText('No log events')).not.toBeInTheDocument();
});

const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator: EMULATOR,
  reason,
  message: '',
});

const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, CONNECTED, '501 Not Implemented for GetLogEvents'],
  ['access denied', { kind: 'access-denied', operation, message: 'policy refusal' }, CONNECTED, 'policy refusal'],
  [
    'emulator not started',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('not_started'),
    'Not started on port 9311',
  ],
  [
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('timeout'),
    'Not answering at https://127.0.0.1:9311',
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: EMULATOR.port },
    `The EmuForge engine at ${ENGINE} is not answering`,
  ],
  [
    'another refusal',
    { kind: 'other', operation, code: 'InvalidParameterException', message: 'invalid request' },
    CONNECTED,
    'InvalidParameterException: invalid request',
  ],
];

it.each(failures)(
  'shows %s in place of events and retries the initial request',
  async (_name, failure, connection, text) => {
    read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(page(['after retry']));
    const { container } = renderPage(connection);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(container).toHaveTextContent(text);
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText('after retry')).toBeVisible();
    expect(read.mock.calls.map(([, , , request]) => request)).toEqual([{ kind: 'newest' }, { kind: 'newest' }]);
  },
);

it.each(['older', 'newer'] as const)('keeps events and retries alongside the %s control', async (direction) => {
  read
    .mockResolvedValueOnce(page(['initial']))
    .mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation, code: 'InvalidParameterException', message: 'page failed' }),
    )
    .mockResolvedValueOnce(page(['retried']));
  renderPage();
  await screen.findByText('initial');
  fireEvent.click(button(direction));
  const retry = await within(control(direction)).findByRole('button', { name: 'Retry' });
  expect(control(direction)).toHaveTextContent('GetLogEvents');
  expect(control(direction)).toHaveTextContent('InvalidParameterException: page failed');
  expect(
    within(control(direction === 'older' ? 'newer' : 'older')).queryByRole('button', { name: 'Retry' }),
  ).toBeNull();
  expect(messages()).toEqual(['initial']);
  fireEvent.click(retry);
  await waitFor(() =>
    expect(messages()).toEqual(direction === 'older' ? ['retried', 'initial'] : ['initial', 'retried']),
  );
  const request = { kind: 'continue', token: `${direction}-1` };
  expect(read.mock.calls.map(([, , , read]) => read)).toEqual([{ kind: 'newest' }, request, request]);
});

it('shows a continuation 501 beside its own control and keeps the log visible', async () => {
  read
    .mockResolvedValueOnce(page(['initial']))
    .mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }));
  renderPage();
  await screen.findByText('initial');
  fireEvent.click(button('newer'));
  expect(await within(control('newer')).findByText('Not implemented by the emulator')).toBeVisible();
  expect(control('newer')).toHaveTextContent('501 Not Implemented for GetLogEvents');
  expect(button('newer')).toBeDisabled();
  expect(messages()).toEqual(['initial']);
});
