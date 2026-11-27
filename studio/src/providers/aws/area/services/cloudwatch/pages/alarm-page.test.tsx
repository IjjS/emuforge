import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageResourcesContext } from '../../../components/page-resources';
import type { TokenPage } from '../../../components/use-token-listing';
import type { Alarm } from '../alarm';
import { readAlarmHistory, readAlarmTags, type AlarmHistoryItem } from '../alarm-page-api';
import { readAlarm } from '../alarms-api';
import { ALARM_PATH, ALARMS_PATH, alarmPath, editAlarmPath } from '../paths';
import { AlarmPage } from './alarm-page';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

vi.mock('../alarms-api', async (load) => ({
  ...(await load<typeof import('../alarms-api')>()),
  readAlarm: vi.fn(),
}));
vi.mock('../alarm-page-api', async (load) => ({
  ...(await load<typeof import('../alarm-page-api')>()),
  readAlarmHistory: vi.fn(),
  readAlarmTags: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8310';
const EMULATOR = { port: 9310, endpoint: 'https://127.0.0.1:9310' };
const CONNECTED = { kind: 'connected', checkedAt: 0, emulator: EMULATOR } as const;
const operation = 'DescribeAlarms';
const read = vi.mocked(readAlarm);
const history = vi.mocked(readAlarmHistory);
const tags = vi.mocked(readAlarmTags);
const name = 'local-alarm';
const arn = (alarmName: string) => `arn:aws:cloudwatch:us-east-1:000000000000:alarm:${alarmName}`;
const metric = (alarmName: string): Alarm => ({
  type: 'metric',
  data: {
    AlarmName: alarmName,
    AlarmArn: arn(alarmName),
    Namespace: 'Application',
    MetricName: 'Errors',
    Statistic: 'Sum',
    Period: 60,
    EvaluationPeriods: 3,
    Threshold: 1,
    ComparisonOperator: 'GreaterThanThreshold',
  },
});
const entry = (summary: string): AlarmHistoryItem => ({ time: undefined, type: 'State', summary });

beforeEach(() => {
  read.mockReset().mockResolvedValue(metric(name));
  history.mockReset().mockResolvedValue({ items: [entry('State changed')] });
  tags.mockReset().mockResolvedValue([{ Key: 'Stage', Value: 'local' }]);
});

function open(address = alarmPath(name), result: AreaConnection['result'] = CONNECTED) {
  const resources = vi.fn();
  let navigate: NavigateFunction | undefined;
  function Page() {
    navigate = useNavigate();
    return <AlarmPage connection={{ engineOrigin: ENGINE, result }} params={{}} />;
  }
  const { container } = render(
    <MemoryRouter initialEntries={[address]}>
      <QueryClientProvider client={new QueryClient()}>
        <PageResourcesContext.Provider value={resources}>
          <Page />
        </PageResourcesContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const layout = createWrapper(container).findContentLayout();
  if (!layout) throw new Error('Alarm layout missing');
  return {
    layout,
    resources,
    follow: (next: string) => {
      if (!navigate) throw new Error('Navigation missing');
      void navigate(next);
    },
    header: () => layout.findHeader()?.findHeader(),
    tables: () => layout.findContent().findAllTables(),
    sectionHeadings: () =>
      layout
        .findContent()
        .findAllHeaders()
        .map((header) => header.findHeadingText().getElement().textContent),
  };
}

it('shows the five sections and uses alarms as the resource word', async () => {
  const page = open();
  await waitFor(() => expect(page.sectionHeadings()).toEqual(['Summary', 'Condition', 'Actions', 'History', 'Tags']));
  expect(page.resources).toHaveBeenCalledWith({ word: 'alarms' });
  expect(page.header()?.findHeadingText().getElement().textContent).toBe(name);
  await waitFor(() => expect(page.tables()[0]?.findBodyCell(1, 3)?.getElement().textContent).toBe('State changed'));
  await waitFor(() => expect(page.tables()[1]?.findBodyCell(1, 2)?.getElement().textContent).toBe('local'));
});

it('shows loading and then Alarm not found with a link and no dependent reads', async () => {
  read.mockResolvedValue(undefined);
  const page = open();
  expect(page.layout.findContent().findStatusIndicator()?.getElement().textContent).toBe('Loading alarm');
  await waitFor(() => expect(page.layout.findContent().getElement()).toHaveTextContent('Alarm not found'));
  expect(page.layout.findContent().findLink()?.getElement()).toHaveAttribute('href', ALARMS_PATH);
  expect(history).not.toHaveBeenCalled();
  expect(tags).not.toHaveBeenCalled();
});

it('shows Alarm not found with no name and asks for nothing', () => {
  const page = open(ALARM_PATH);
  expect(page.header()?.findHeadingText().getElement().textContent).toBe('Alarm not found');
  expect(page.layout.findContent().findLink()?.getElement()).toHaveAttribute('href', ALARMS_PATH);
  expect(read).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
  expect(tags).not.toHaveBeenCalled();
});

it('keeps alarm details and tags readable when history fails', async () => {
  history.mockRejectedValue(
    new RequestError({ kind: 'access-denied', operation: 'DescribeAlarmHistory', message: 'history refused' }),
  );
  const page = open();
  await waitFor(() => expect(page.tables()[0]?.findEmptySlot()?.getElement()).toHaveTextContent('history refused'));
  expect(page.sectionHeadings()).toEqual(['Summary', 'Condition', 'Actions', 'History', 'Tags']);
  await waitFor(() => expect(page.tables()[1]?.findBodyCell(1, 2)?.getElement().textContent).toBe('local'));
});

it('refreshes the alarm, current history token and tags from the page header', async () => {
  history
    .mockResolvedValueOnce({ items: [entry('First')], next: 'next' })
    .mockResolvedValue({ items: [entry('Second')] });
  const page = open();
  await waitFor(() => expect(page.tables()[0]?.findBodyCell(1, 3)?.getElement().textContent).toBe('First'));
  page.tables()[0]?.findPagination()?.findNextPageButton().click();
  await waitFor(() => expect(page.tables()[0]?.findBodyCell(1, 3)?.getElement().textContent).toBe('Second'));
  const refresh = page.header()?.findActions()?.findButton();
  expect(refresh?.getElement()).toHaveAccessibleName('Refresh');
  refresh?.click();
  await waitFor(() => {
    expect(read).toHaveBeenCalledTimes(2);
    expect(history).toHaveBeenCalledTimes(3);
    expect(tags).toHaveBeenCalledTimes(2);
  });
  expect(history).toHaveBeenLastCalledWith(ENGINE, name, 'next', expect.any(AbortSignal));
  expect(tags).toHaveBeenLastCalledWith(ENGINE, arn(name), expect.any(AbortSignal));
});

it.each([true, false])(
  'offers Edit only when editable (%s) and preserves the heading’s whitespace',
  async (editable) => {
    const exactName = 'alarm with  spaces\nand a line';
    read.mockResolvedValue(editable ? metric(exactName) : { type: 'composite', data: { AlarmName: exactName } });
    const page = open(alarmPath(exactName));
    await waitFor(() => expect(page.sectionHeadings()).toContain('Summary'));
    const heading = page.header()?.findHeadingText();
    expect(heading?.getElement().textContent).toBe(exactName);
    expect(heading?.find('.aws-area-value-name')?.getElement().parentElement).toHaveStyle({ whiteSpace: 'pre-wrap' });
    const edit = page
      .header()
      ?.findActions()
      ?.findAllButtons()
      .find((button) => button.findTextRegion()?.getElement().textContent === 'Edit');
    if (editable) expect(edit?.getElement()).toHaveAttribute('href', editAlarmPath(exactName));
    else expect(edit).toBeUndefined();
  },
);

it('drops the first alarm’s pending history and tags when the name changes', async () => {
  const previousHistory = deferred<TokenPage<AlarmHistoryItem>>();
  const previousTags = deferred<Awaited<ReturnType<typeof readAlarmTags>>>();
  read.mockResolvedValueOnce(metric(name)).mockResolvedValueOnce(metric('second'));
  history.mockReturnValueOnce(previousHistory.promise).mockResolvedValueOnce({ items: [entry('Second history')] });
  tags.mockReturnValueOnce(previousTags.promise).mockResolvedValueOnce([{ Key: 'Stage', Value: 'second tag' }]);
  const page = open();
  await waitFor(() => expect(tags).toHaveBeenCalledTimes(1));
  const historySignal = history.mock.calls[0]?.[3];
  const tagsSignal = tags.mock.calls[0]?.[2];
  act(() => page.follow(alarmPath('second')));
  await waitFor(() => expect(page.tables()[0]?.findBodyCell(1, 3)?.getElement().textContent).toBe('Second history'));
  await waitFor(() => expect(page.tables()[1]?.findBodyCell(1, 2)?.getElement().textContent).toBe('second tag'));
  expect(historySignal?.aborted).toBe(true);
  expect(tagsSignal?.aborted).toBe(true);
  await act(async () => {
    previousHistory.resolve({ items: [entry('First history')] });
    previousTags.resolve([{ Key: 'Stage', Value: 'first tag' }]);
  });
  expect(page.header()?.findHeadingText().getElement().textContent).toBe('second');
  expect(page.tables()[0]?.findBodyCell(1, 3)?.getElement().textContent).toBe('Second history');
  expect(page.tables()[1]?.findBodyCell(1, 2)?.getElement().textContent).toBe('second tag');
});

const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator: EMULATOR,
  reason,
  message: '',
});

const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, CONNECTED, '501 Not Implemented for DescribeAlarms'],
  ['access denied', { kind: 'access-denied', operation, message: 'policy refusal' }, CONNECTED, 'policy refusal'],
  [
    'emulator not started',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('not_started'),
    'Not started on port 9310',
  ],
  [
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('timeout'),
    'Not answering at https://127.0.0.1:9310',
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: EMULATOR.port },
    `The EmuForge engine at ${ENGINE} is not answering`,
  ],
  [
    'another refusal',
    { kind: 'other', operation, code: 'InvalidParameterValue', message: 'bad parameter' },
    CONNECTED,
    'InvalidParameterValue: bad parameter',
  ],
];

it.each(failures)('shows %s as a read failure and retries the alarm', async (_, failure, result, text) => {
  read.mockRejectedValueOnce(new RequestError(failure));
  const page = open(alarmPath(name), result);
  const content = page.layout.findContent();
  await waitFor(() => expect(content.getElement()).toHaveTextContent(text));
  if (failure.kind === 'not-implemented') {
    expect(content.findStatusIndicator()?.getElement().textContent).toBe('Not implemented by the emulator');
  }
  expect(content.getElement()).not.toHaveTextContent('Alarm not found');
  expect(history).not.toHaveBeenCalled();
  expect(tags).not.toHaveBeenCalled();
  content.findButton()?.click();
  await waitFor(() => expect(page.sectionHeadings()).toContain('Summary'));
  expect(read).toHaveBeenCalledTimes(2);
});
