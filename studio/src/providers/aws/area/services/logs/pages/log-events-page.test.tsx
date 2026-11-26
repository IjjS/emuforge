import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { listLogGroups, OPERATIONS } from '../api';
import { logStreamPath, LOG_EVENTS_PATH } from '../format';
import { filterLogEvents, FILTER_LOG_EVENTS } from '../search-api';
import { DESCRIBE_LOG_STREAMS, listLogStreams } from '../stream-api';
import { LogEventsPage } from './log-events-page';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listLogGroups: vi.fn(),
}));
vi.mock('../stream-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));
vi.mock('../search-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../search-api')>()),
  filterLogEvents: vi.fn(),
}));

const engineOrigin = 'http://127.0.0.1:8315';
const emulator = { port: 9315, endpoint: 'https://127.0.0.1:9315' };
const connected = { kind: 'connected', checkedAt: 0, emulator } as const;
const group = '/app%2F#group';
const stream = 'web/a+b';
const chosenPath = `${LOG_EVENTS_PATH}?${new URLSearchParams({ group, stream }).toString()}`;
const search = vi.mocked(filterLogEvents);
const groups = vi.mocked(listLogGroups);
const streams = vi.mocked(listLogStreams);

beforeEach(() => {
  search.mockReset();
  groups.mockReset();
  streams.mockReset();
});

function open(path = chosenPath, result: AreaConnection['result'] = connected) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LogEventsPage connection={{ engineOrigin, result }} params={{}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function choice(index: number) {
  const select = createWrapper(document.body).findAllSelects()[index];
  if (select === undefined) throw new Error('Missing choice field');
  return select;
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Search' }));
const field = (name: string) => screen.getByRole('textbox', { name });

function enter(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } });
}

const timestamp = new Date(2026, 10, 26, 12, 34, 56).getTime();

function page(message: string, next?: string) {
  const items = [{ eventId: message, logStreamName: stream, timestamp, message }];
  return next === undefined ? { items } : { items, next };
}

it('asks for a group on the bare route and opens a linked group and stream already selected', () => {
  const bare = open(LOG_EVENTS_PATH);
  expect(screen.getByText('Choose a log group.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  expect(search).not.toHaveBeenCalled();
  bare.unmount();

  open();
  expect(choice(0).findTrigger().getElement()).toHaveTextContent(group);
  expect(choice(1).findTrigger().getElement()).toHaveTextContent(stream);
  expect(groups).not.toHaveBeenCalled();
  expect(streams).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();
});

it('shows the submitted events with local time, a stream link and the message until the next submission', async () => {
  search.mockResolvedValueOnce(page('error one')).mockResolvedValueOnce(page('ok two'));
  open();
  enter('Filter pattern', 'error');
  submit();

  const row = (await screen.findByText('error one')).closest('tr');
  expect(row).toHaveTextContent(creationDateText(new Date(timestamp)));
  if (row === null) throw new Error('Missing event row');
  expect(within(row).getByRole('link', { name: stream })).toHaveAttribute('href', logStreamPath(group, stream));

  enter('Filter pattern', 'ok');
  expect(screen.getByText('error one')).toBeVisible();
  expect(search).toHaveBeenCalledTimes(1);
  submit();
  expect(await screen.findByText('ok two')).toBeVisible();
  expect(search.mock.calls.map(([, request]) => request.filterPattern)).toEqual(['error', 'ok']);
});

it('clears the stream when the group is changed and opens only the new group’s streams', async () => {
  groups.mockResolvedValueOnce({ items: [{ logGroupName: '/different' }] });
  streams.mockResolvedValueOnce({ items: [{ logStreamName: 'new-stream' }] });
  open();
  choice(0).openDropdown();
  await screen.findByText('/different');
  choice(0).selectOptionByValue('/different');
  expect(choice(1).findTrigger().getElement()).toHaveTextContent('All log streams');
  choice(1).openDropdown();
  expect(await screen.findByText('new-stream')).toBeVisible();
  expect(streams).toHaveBeenCalledWith(engineOrigin, '/different', '', undefined, expect.any(AbortSignal));
});

function enterRange() {
  enter('Time range Start date', '2026-11-26');
  enter('Time range Start time', '12:34:56');
  enter('Time range End date', '2026-11-26');
  enter('Time range End time', '12:35:57');
}

it('keeps the submitted group and filters beside the results while the draft changes', async () => {
  groups.mockResolvedValueOnce({ items: [{ logGroupName: '/different' }] });
  search.mockResolvedValueOnce(page('first result')).mockResolvedValueOnce(page('next result'));
  open();
  enter('Filter pattern', 'submitted pattern');
  enterRange();
  submit();

  const results = () => screen.getByRole('region', { name: 'Search results' });
  await within(results()).findByText('first result');
  expect(results()).toHaveTextContent(`Log group: ${group}`);
  expect(results()).toHaveTextContent(`Log stream: ${stream}`);
  expect(results()).toHaveTextContent('Filter pattern: submitted pattern');
  expect(results()).toHaveTextContent(`Start: ${creationDateText(new Date(timestamp))}`);
  expect(results()).toHaveTextContent(`End: ${creationDateText(new Date(2026, 10, 26, 12, 35, 57))}`);

  choice(0).openDropdown();
  await screen.findByText('/different');
  choice(0).selectOptionByValue('/different');
  enter('Filter pattern', 'edited pattern');
  expect(results()).toHaveTextContent(`Log group: ${group}`);
  expect(results()).toHaveTextContent('Filter pattern: submitted pattern');
  expect(results()).not.toHaveTextContent('/different');
  expect(within(results()).getByText('first result')).toBeVisible();

  submit();
  await within(results()).findByText('next result');
  expect(results()).toHaveTextContent('Log group: /different');
  expect(results()).toHaveTextContent('Filter pattern: edited pattern');
  expect(results()).not.toHaveTextContent(`Log stream: ${stream}`);
});

it('focuses and reveals the results on each submission, then announces the outcome', async () => {
  search.mockResolvedValueOnce(page('a match')).mockResolvedValueOnce({ items: [] });
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const reveal = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: reveal });
  try {
    open();
    const results = () => screen.getByRole('region', { name: 'Search results' });
    const announcement = () => results().querySelector('[aria-live="polite"][aria-atomic="true"]');

    submit();
    expect(results()).toHaveFocus();
    expect(reveal).toHaveBeenLastCalledWith({ block: 'start' });
    expect(reveal.mock.contexts.at(-1)).toBe(results());
    await waitFor(() => expect(announcement()).toHaveTextContent('Search complete. 1 log event on this page.'));
    expect(reveal.mock.contexts.filter((target) => target === results())).toHaveLength(2);

    field('Filter pattern').focus();
    enter('Filter pattern', 'no match');
    expect(field('Filter pattern')).toHaveFocus();
    submit();
    expect(results()).toHaveFocus();
    const secondResults = results();
    expect(reveal.mock.contexts.filter((target) => target === secondResults)).toHaveLength(1);
    field('Filter pattern').focus();
    await waitFor(() => expect(announcement()).toHaveTextContent('Search complete. No log events match.'));
    expect(field('Filter pattern')).toHaveFocus();
    expect(reveal.mock.contexts.filter((target) => target === secondResults)).toHaveLength(1);
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    else Object.defineProperty(Element.prototype, 'scrollIntoView', descriptor);
  }
});

it('explains browser-local optional pairs and announces an incomplete pair before searching', () => {
  open();
  expect(screen.getByText(/Times are read in your browser’s time zone/)).toHaveTextContent(
    'Each date and time pair is optional. Enter both fields for any pair you use.',
  );
  enter('Time range Start date', '2026-11-26');
  submit();

  const time = field('Time range Start time');
  expect(time).toHaveAccessibleDescription(/Enter a valid start date and time/);
  const announcement = time.closest('form')?.querySelector('[aria-live="polite"][aria-atomic="true"]');
  expect(announcement).toHaveTextContent('Enter a valid start date and time.');
  expect(search).not.toHaveBeenCalled();
  enter('Time range Start time', '12:34:56');
  expect(announcement).toBeEmptyDOMElement();
});

it('bounds long messages while preserving their text, whitespace, timestamp and stream link', async () => {
  const message = `  first line\n\t${'x'.repeat(700)}  `;
  search.mockResolvedValueOnce(page(message));
  open();
  submit();

  const link = await screen.findByRole('link', { name: stream });
  const row = link.closest('tr');
  expect(row).toHaveTextContent(creationDateText(new Date(timestamp)));
  expect(link).toHaveAttribute('href', logStreamPath(group, stream));
  const pre = row?.querySelector('pre');
  expect(pre?.textContent).toBe(message);
  expect(pre).toHaveStyle({ whiteSpace: 'pre-wrap' });
  const width = document.createElement('div').style;
  width.maxInlineSize = 'clamp(5ch, calc(100vw - 17.5rem), 72ch)';
  expect(pre?.parentElement?.style.maxInlineSize).toBe(width.maxInlineSize);
  expect(pre?.firstElementChild).toHaveClass('aws-area-value-text');
});

it('pages with the submitted pattern, times and stream even while the form holds edits', async () => {
  search.mockResolvedValueOnce(page('first page', 'page-token')).mockResolvedValueOnce(page('second page'));
  open();
  enter('Filter pattern', 'submitted');
  enterRange();
  submit();
  expect(await screen.findByText('first page')).toBeVisible();

  enter('Filter pattern', 'edited');
  enter('Time range End time', '12:36:00');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByText('second page')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'true');
  const request = {
    logGroupName: group,
    logStreamNames: [stream],
    filterPattern: 'submitted',
    startTime: timestamp,
    endTime: new Date(2026, 10, 26, 12, 35, 57).getTime(),
  };
  expect(search.mock.calls.map(([, values, token]) => [values, token])).toEqual([
    [request, undefined],
    [request, 'page-token'],
  ]);
});

it('submits the unchanged form from page 2 as a new first-page request', async () => {
  search
    .mockResolvedValueOnce(page('original', 'page-token'))
    .mockResolvedValueOnce(page('second'))
    .mockResolvedValueOnce(page('fresh first'));
  open();
  submit();
  await screen.findByText('original');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('second');
  submit();
  expect(await screen.findByText('fresh first')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'true');
  expect(search.mock.calls.map(([, request, token]) => [request, token])).toEqual([
    [{ logGroupName: group, logStreamNames: [stream] }, undefined],
    [{ logGroupName: group, logStreamNames: [stream] }, 'page-token'],
    [{ logGroupName: group, logStreamNames: [stream] }, undefined],
  ]);
});

it('shows the end field error without searching a reversed range', () => {
  open();
  enterRange();
  enter('Time range End time', '12:00:00');
  submit();
  expect(field('Time range End time')).toHaveAccessibleDescription(/End time must be at or after start time/);
  expect(search).not.toHaveBeenCalled();
});

it('shows loading then the empty search state', async () => {
  search.mockResolvedValueOnce({ items: [] });
  open();
  submit();
  expect(screen.getByText('Loading log events')).toBeVisible();
  expect(await screen.findByText('No log events match')).toBeVisible();
});

const badPattern = '{ $.a = }';

it('shows a refused pattern in the results with the form kept as entered', async () => {
  search.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: FILTER_LOG_EVENTS,
      code: 'InvalidParameterException',
      message: 'Invalid filter pattern',
    }),
  );
  open();
  enter('Filter pattern', badPattern);
  submit();
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  expect(screen.getByRole('table')).toHaveTextContent('InvalidParameterException: Invalid filter pattern');
  expect(field('Filter pattern')).toHaveValue(badPattern);
  expect(choice(0).findTrigger().getElement()).toHaveTextContent(group);
});

const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator,
  reason,
  message: '',
});

type FailureCase = {
  name: string;
  failure: RequestFailure;
  connection: AreaConnection['result'];
  choiceMessage: (operation: string) => string;
  resultMessage: (operation: string) => string;
};

function failureCase(
  name: string,
  failure: RequestFailure,
  connection: AreaConnection['result'],
  choiceMessage: (operation: string) => string,
  resultMessage = choiceMessage,
): FailureCase {
  return { name, failure, connection, choiceMessage, resultMessage };
}

const failures = [
  failureCase(
    '501',
    { kind: 'not-implemented', operation: FILTER_LOG_EVENTS },
    connected,
    (op) => `Not implemented by the emulator. The emulator answered 501 Not Implemented for ${op}.`,
    (op) => `501 Not Implemented for ${op}`,
  ),
  failureCase(
    'access denied',
    { kind: 'access-denied', operation: FILTER_LOG_EVENTS, message: 'policy refusal' },
    connected,
    (op) => `Access denied. ${op} was refused: policy refusal`,
    (op) => `${op} was refused: policy refusal`,
  ),
  failureCase(
    'emulator not started',
    { kind: 'emulator-did-not-answer', operation: FILTER_LOG_EVENTS, message: '' },
    unreachable('not_started'),
    () => 'Not started on port 9315',
  ),
  failureCase(
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation: FILTER_LOG_EVENTS, message: '' },
    unreachable('timeout'),
    () => 'Not answering at https://127.0.0.1:9315',
  ),
  failureCase(
    'engine not answering',
    { kind: 'engine-did-not-answer', operation: FILTER_LOG_EVENTS },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: emulator.port },
    () => `The EmuForge engine at ${engineOrigin} is not answering`,
  ),
  failureCase(
    'another refusal',
    { kind: 'other', operation: FILTER_LOG_EVENTS, code: 'RequestFailed', message: 'unexpected failure' },
    connected,
    () => 'RequestFailed: unexpected failure',
  ),
];

const choiceFields = [
  {
    index: 0,
    word: 'log groups',
    operation: OPERATIONS.describeLogGroups,
    mock: groups,
    answer: (name: string, next?: string) => ({ items: [{ logGroupName: name }], ...(next ? { next } : {}) }),
    args: (token: string | undefined) => [engineOrigin, '', token, expect.any(AbortSignal)],
  },
  {
    index: 1,
    word: 'log streams',
    operation: DESCRIBE_LOG_STREAMS,
    mock: streams,
    answer: (name: string, next?: string) => ({ items: [{ logStreamName: name }], ...(next ? { next } : {}) }),
    args: (token: string | undefined) => [engineOrigin, group, '', token, expect.any(AbortSignal)],
  },
];

for (const { index, word, operation, mock, answer, args } of choiceFields) {
  it.each(failures)(`reports $name while reading ${word} and retries the first page`, async (example) => {
    mock
      .mockRejectedValueOnce(new RequestError({ ...example.failure, operation }))
      .mockResolvedValueOnce(answer('after-retry'));
    open(chosenPath, example.connection);
    choice(index).openDropdown();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const dropdown = choice(index).findDropdown().getElement();
    expect(dropdown).toHaveTextContent(`The ${word} could not be loaded: ${example.choiceMessage(operation)}`);
    fireEvent.click(retry);
    expect(await within(dropdown).findByText('after-retry')).toBeVisible();
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock).toHaveBeenLastCalledWith(...args(undefined));
  });

  it(`keeps the first page of ${word} while retrying the failed second page`, async () => {
    mock
      .mockResolvedValueOnce(answer('first-option', 'next-choice'))
      .mockRejectedValueOnce(new RequestError({ kind: 'other', operation, code: 'RequestFailed' }))
      .mockResolvedValueOnce(answer('second-option'));
    open();
    choice(index).openDropdown();
    await screen.findByText('first-option');
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const dropdown = choice(index).findDropdown().getElement();
    const first = within(dropdown).getByText('first-option');
    expect(first).toBeVisible();
    expect(first.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(retry);
    expect(await within(dropdown).findByText('second-option')).toBeVisible();
    expect(within(dropdown).getByText('first-option')).toBeVisible();
    expect(mock).toHaveBeenCalledTimes(3);
    expect(mock).toHaveBeenNthCalledWith(2, ...args('next-choice'));
    expect(mock).toHaveBeenNthCalledWith(3, ...args('next-choice'));
  });
}

it.each(failures)('shows $name in place of search results and retries the submitted search', async (example) => {
  search.mockRejectedValueOnce(new RequestError(example.failure)).mockResolvedValueOnce(page('retried'));
  open(chosenPath, example.connection);
  enter('Filter pattern', 'submitted');
  submit();
  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(screen.getByRole('table')).toHaveTextContent(example.resultMessage(FILTER_LOG_EVENTS));
  enter('Filter pattern', 'edited');
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByText('retried')).toBeVisible());
  expect(search.mock.calls.map(([, request, token]) => [request.filterPattern, token])).toEqual([
    ['submitted', undefined],
    ['submitted', undefined],
  ]);
});

it('explains the Standard class restriction with the emulator’s reason', async () => {
  const reason = 'This operation is only supported on the Standard log class.';
  search.mockRejectedValueOnce(
    new RequestError({ kind: 'other', operation: FILTER_LOG_EVENTS, code: 'ValidationException', message: reason }),
  );
  open();
  submit();
  expect(
    await screen.findByText('The emulator reads and searches log events only in log groups of the Standard class.'),
  ).toBeVisible();
  expect(screen.getByText(reason)).toBeVisible();
});
