import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { aws, boxText, buttonIn, requiredElement } from '../logs-test-utils.test';
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

const option = (index: number, value: string) => choice(index).findDropdown().findOptionByValue(value)?.getElement();
const resultsTable = () => createWrapper(document.body).findTable();
const resultDescription = () => resultsTable()?.findHeaderSlot()?.findHeader()?.findDescription()?.getElement();
const resultEmpty = () => resultsTable()?.findEmptySlot();
const resultRetry = () => resultEmpty()?.findButton()?.getElement();
const resultStatus = () => resultEmpty()?.findStatusIndicator()?.getElement();
const messageCell = () => resultsTable()?.findBodyCell(1, 3);
const resultMessage = () => messageCell()?.getElement();
const resultPagination = () => resultsTable()?.findPagination();

function expectResult(message: string) {
  const cell = resultMessage();
  expect(cell).toBeVisible();
  expect(cell?.textContent).toBe(message);
}

const searchButton = () => requiredElement(buttonIn(aws().findContainer()?.findFooter(), 'Search'));
const submit = () => fireEvent.click(searchButton());
const timeRange = () =>
  createWrapper(document.body)
    .findAllFormFields()
    .find((item) => item.findLabel()?.getElement().textContent === 'Time range');
function field(name: string) {
  const label = name.replace(/^Time range /, '');
  const control = aws()
    .findAllFormFields()
    .find((item) => item.findLabel()?.getElement().textContent === label)
    ?.findControl();
  const input = (control?.findInput() ?? control?.findDateInput() ?? control?.findTimeInput())
    ?.findNativeInput()
    ?.getElement();
  expect(input).toHaveAccessibleName(name);
  return requiredElement(input);
}

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
  expect(boxText(aws(), 'Choose a log group.')).toBeVisible();
  expect(searchButton()).toBeDisabled();
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

  await waitFor(() => expectResult('error one'));
  const row = resultsTable()?.findRows()[0];
  expect(row?.getElement()).toHaveTextContent(creationDateText(new Date(timestamp)));
  const link = row?.findLink()?.getElement();
  expect(link).toHaveAccessibleName(stream);
  expect(link).toHaveAttribute('href', logStreamPath(group, stream));

  enter('Filter pattern', 'ok');
  expectResult('error one');
  expect(search).toHaveBeenCalledTimes(1);
  submit();
  await waitFor(() => expectResult('ok two'));
  expect(search.mock.calls.map(([, request]) => request.filterPattern)).toEqual(['error', 'ok']);
});

it('clears the stream when the group is changed and opens only the new group’s streams', async () => {
  groups.mockResolvedValueOnce({ items: [{ logGroupName: '/different' }] });
  streams.mockResolvedValueOnce({ items: [{ logStreamName: 'new-stream' }] });
  open();
  choice(0).openDropdown();
  await waitFor(() => expect(option(0, '/different')).toBeVisible());
  choice(0).selectOptionByValue('/different');
  expect(choice(1).findTrigger().getElement()).toHaveTextContent('All log streams');
  choice(1).openDropdown();
  await waitFor(() => expect(option(1, 'new-stream')).toBeVisible());
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

  await waitFor(() => expectResult('first result'));
  expect(resultDescription()).toHaveTextContent(`Log group: ${group}`);
  expect(resultDescription()).toHaveTextContent(`Log stream: ${stream}`);
  expect(resultDescription()).toHaveTextContent('Filter pattern: submitted pattern');
  expect(resultDescription()).toHaveTextContent(`Start: ${creationDateText(new Date(timestamp))}`);
  expect(resultDescription()).toHaveTextContent(`End: ${creationDateText(new Date(2026, 10, 26, 12, 35, 57))}`);

  choice(0).openDropdown();
  await waitFor(() => expect(option(0, '/different')).toBeVisible());
  choice(0).selectOptionByValue('/different');
  enter('Filter pattern', 'edited pattern');
  expect(resultDescription()).toHaveTextContent(`Log group: ${group}`);
  expect(resultDescription()).toHaveTextContent('Filter pattern: submitted pattern');
  expect(resultDescription()).not.toHaveTextContent('/different');
  expectResult('first result');

  submit();
  await waitFor(() => expectResult('next result'));
  expect(resultDescription()).toHaveTextContent('Log group: /different');
  expect(resultDescription()).toHaveTextContent('Filter pattern: edited pattern');
  expect(resultDescription()).not.toHaveTextContent(`Log stream: ${stream}`);
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
  expect(timeRange()?.findDescription()?.getElement()).toHaveTextContent('Times are read in your browser’s time zone');
  expect(timeRange()?.findDescription()?.getElement()).toHaveTextContent(
    'Each date and time pair is optional. Enter both fields for any pair you use.',
  );
  enter('Time range Start date', '2026-11-26');
  submit();

  const time = field('Time range Start time');
  expect(time).toHaveAccessibleDescription(/Enter a valid start date and time/);
  const announcement = document.querySelector('form [aria-live="polite"][aria-atomic="true"]');
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

  await waitFor(() => expect(resultMessage()).toBeVisible());
  const row = resultsTable()?.findRows()[0];
  const link = row?.findLink()?.getElement();
  expect(row?.getElement()).toHaveTextContent(creationDateText(new Date(timestamp)));
  expect(link).toHaveAccessibleName(stream);
  expect(link).toHaveAttribute('href', logStreamPath(group, stream));
  const pre = messageCell()?.findBox('pre')?.getElement();
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
  await waitFor(() => expectResult('first page'));

  enter('Filter pattern', 'edited');
  enter('Time range End time', '12:36:00');
  resultPagination()?.findNextPageButton().click();
  await waitFor(() => expectResult('second page'));
  expect(resultPagination()?.findPageNumberByIndex(2)?.getElement()).toHaveAttribute('aria-current', 'true');
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
  await waitFor(() => expectResult('original'));
  resultPagination()?.findNextPageButton().click();
  await waitFor(() => expectResult('second'));
  submit();
  await waitFor(() => expectResult('fresh first'));
  expect(resultPagination()?.findPageNumberByIndex(1)?.getElement()).toHaveAttribute('aria-current', 'true');
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
  const loading = resultsTable()?.findLoadingText()?.getElement();
  expect(loading).toBeVisible();
  expect(loading).toHaveTextContent('Loading log events');
  await waitFor(() => {
    const empty = resultEmpty()?.getElement();
    expect(empty).toBeVisible();
    expect(empty).toHaveTextContent('No log events match');
  });
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
  await waitFor(() => {
    expect(resultRetry()).toBeVisible();
    expect(resultRetry()).toHaveAccessibleName('Retry');
  });
  expect(resultEmpty()?.getElement()).toHaveTextContent('InvalidParameterException: Invalid filter pattern');
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
    const retry = () => choice(index).findErrorRecoveryButton()?.getElement();
    await waitFor(() => expect(retry()).toBeVisible());
    const dropdownStatus = choice(index).findStatusIndicator()?.getElement();
    expect(dropdownStatus).toHaveTextContent(`The ${word} could not be loaded: ${example.choiceMessage(operation)}`);
    fireEvent.click(requiredElement(retry()));
    await waitFor(() => expect(option(index, 'after-retry')).toBeVisible());
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
    await waitFor(() => expect(option(index, 'first-option')).toBeVisible());
    fireEvent.click(requiredElement(buttonIn(choice(index).findDropdownFooter(), 'Load more')));
    const retry = () => choice(index).findErrorRecoveryButton()?.getElement();
    await waitFor(() => expect(retry()).toBeVisible());
    const first = option(index, 'first-option');
    expect(first).toBeVisible();
    expect(
      (first?.compareDocumentPosition(requiredElement(retry())) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(requiredElement(retry()));
    await waitFor(() => expect(option(index, 'second-option')).toBeVisible());
    expect(option(index, 'first-option')).toBeVisible();
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
  await waitFor(() => {
    expect(resultRetry()).toBeVisible();
    expect(resultRetry()).toHaveAccessibleName('Retry');
  });
  const retry = requiredElement(resultRetry());
  expect(resultEmpty()?.getElement()).toHaveTextContent(example.resultMessage(FILTER_LOG_EVENTS));
  enter('Filter pattern', 'edited');
  fireEvent.click(retry);
  await waitFor(() => expectResult('retried'));
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
  await waitFor(() => {
    expect(resultStatus()).toBeVisible();
    expect(resultStatus()).toHaveTextContent(
      'The emulator reads and searches log events only in log groups of the Standard class.',
    );
  });
  const detail = resultEmpty()
    ?.findAllBoxes()
    .find((box) => box.getElement().textContent === reason)
    ?.getElement();
  expect(detail).toBeVisible();
  expect(detail).toHaveTextContent(reason);
});

it('distinguishes line breaks and literal escapes in stream choices and submits each exact stored name', async () => {
  const names = [
    { stored: 'first\rsecond', label: 'first\\rsecond', display: 'first\nsecond' },
    { stored: 'first\nsecond', label: 'first\\nsecond', display: 'first\nsecond' },
    { stored: 'first\r\nsecond', label: 'first\\r\\nsecond', display: 'first\nsecond' },
    { stored: 'first\u2028second', label: 'first\\u2028second', display: 'first\nsecond' },
    { stored: 'first\u2029second', label: 'first\\u2029second', display: 'first\nsecond' },
    { stored: 'first\\nsecond', label: 'first\\\\nsecond', display: 'first\\nsecond' },
    { stored: 'first second', label: 'first second', display: 'first second' },
    {
      stored: 'first second (contains a line break)',
      label: 'first second (contains a line break)',
      display: 'first second (contains a line break)',
    },
  ];
  streams.mockResolvedValue({ items: names.map(({ stored }) => ({ logStreamName: stored })) });
  for (const { stored, label } of names) {
    search.mockResolvedValueOnce({ items: [{ eventId: label, logStreamName: stored, message: label }] });
  }
  open(`${LOG_EVENTS_PATH}?${new URLSearchParams({ group })}`);

  const streamChoice = choice(1);
  for (const [index, { stored, label, display }] of names.entries()) {
    streamChoice.openDropdown();
    const dropdown = streamChoice.findDropdown();
    const streamOption = await waitFor(() => {
      // Cloudscape's attribute selector cannot reliably represent raw line terminators.
      const match = /[\r\n\u2028\u2029]/.test(stored)
        ? dropdown.findOptions().find((option) => option.getElement().getAttribute('data-value') === stored)
        : dropdown.findOptionByValue(stored);
      const wrapper = requiredElement(match);
      expect(wrapper.getElement()).toBeVisible();
      expect(wrapper.getElement()).toHaveAttribute('data-value', stored);
      expect(wrapper.findLabel().getElement().textContent).toBe(label);
      return wrapper;
    });
    fireEvent.mouseUp(streamOption.getElement());
    expect(streamChoice.findTrigger().getElement()).toHaveTextContent(label);
    submit();
    await waitFor(() => expectResult(label));
    expect(search).toHaveBeenNthCalledWith(
      index + 1,
      engineOrigin,
      { logGroupName: group, logStreamNames: [stored] },
      undefined,
      expect.any(AbortSignal),
    );

    const link = resultsTable()?.findBodyCell(1, 2)?.findLink()?.getElement();
    const expectedName = display.includes('\n') ? `${display} (${label})` : display;
    expect(link?.textContent).toBe(expectedName);
    expect(link).toHaveAccessibleName(label);
    expect(link).toHaveAttribute('href', logStreamPath(group, stored));
    const summary = resultsTable()
      ?.findHeaderSlot()
      ?.findHeader()
      ?.findDescription()
      ?.find('span:nth-child(2)')
      ?.getElement();
    expect(summary?.textContent).toBe(`Log stream: ${expectedName}`);
    if (display.includes('\n')) {
      expect(link).toHaveStyle({ whiteSpace: 'pre-wrap' });
      expect(summary).toHaveStyle({ whiteSpace: 'pre-wrap' });
    }
  }
});
