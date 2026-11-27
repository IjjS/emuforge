import type { CloudWatchClient, PutMetricAlarmCommand } from '@aws-sdk/client-cloudwatch';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext } from '../../../components/page-flash';
import type { Alarm, EditableAlarm } from '../alarm';
import { readAlarmHistory, readAlarmTags } from '../alarm-page-api';
import { readAlarm } from '../alarms-api';
import { sendCloudWatch } from '../clients';
import { editAlarm } from '../edit-api';
import { listDimensionSets } from '../metric-api';
import { ALARMS_PATH, EDIT_ALARM_PATH, alarmPath, editAlarmPath } from '../paths';
import { listTopicArns } from '../topic-api';
import { EditAlarmPage } from './edit-alarm-page';

vi.mock('../alarms-api', { spy: true });
vi.mock('../alarm-page-api', { spy: true });
vi.mock('../clients', { spy: true });
vi.mock('../edit-api', { spy: true });
vi.mock('../metric-api', { spy: true });
vi.mock('../topic-api', { spy: true });

const read = vi.mocked(readAlarm);
const history = vi.mocked(readAlarmHistory);
const tags = vi.mocked(readAlarmTags);
const send = vi.mocked(sendCloudWatch);
const edit = vi.mocked(editAlarm);
const topics = vi.mocked(listTopicArns);
const metrics = vi.mocked(listDimensionSets);
const engineOrigin = 'http://127.0.0.1:8322';
const emulator = { port: 9322, endpoint: 'https://127.0.0.1:9322' };
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 0, emulator },
};
const name = ' local  errors /?# ';
const destination = alarmPath(name);
const reason =
  "Studio edits a metric alarm that compares one metric's statistic with a fixed threshold. This alarm is not one of those.";
const historyItems = { items: [{ time: undefined, type: 'Configuration' as const, summary: 'Alarm saved' }] };
const tagItems = [{ Key: 'Stage', Value: 'local' }];
const externalAction = 'arn:aws:lambda:us-east-1:000000000000:function:local';

function metric(alarmName = name, fields: Partial<EditableAlarm['data']> = {}): EditableAlarm {
  return {
    type: 'metric',
    data: {
      AlarmName: alarmName,
      AlarmArn: `arn:aws:cloudwatch:us-east-1:000000000000:alarm:${alarmName}`,
      AlarmDescription: 'before',
      Namespace: 'App',
      MetricName: 'Errors',
      Statistic: 'Sum',
      Period: 120,
      EvaluationPeriods: 1,
      DatapointsToAlarm: 1,
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 5,
      ...fields,
    },
  } as EditableAlarm;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function denied(operation: string, message: string) {
  return new RequestError({ kind: 'access-denied', operation, message });
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  read.mockReset().mockResolvedValue(metric());
  history.mockReset().mockResolvedValue(historyItems);
  tags.mockReset().mockResolvedValue(tagItems);
  send.mockReset().mockResolvedValue({});
  edit.mockClear();
  topics.mockReset().mockResolvedValue([]);
  metrics.mockReset().mockResolvedValue([[]]);
});

afterEach(() => vi.unstubAllGlobals());

function open(address = editAlarmPath(name), inArea = false, state = connection) {
  const handOver = vi.fn();
  const show = vi.fn();
  let currentAddress = '';
  let navigate: NavigateFunction | undefined;

  function Page() {
    const { pathname, search } = useLocation();
    currentAddress = pathname + search;
    navigate = useNavigate();
    if (inArea) {
      return (
        <AreaLayout
          headerSelector="#studio-header"
          connection={state}
          routeChanges={pathname === EDIT_ALARM_PATH ? 0 : 1}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
      );
    }
    return (
      <PageFlashContext.Provider value={{ handOver, show }}>
        <EditAlarmPage connection={state} params={{}} />
      </PageFlashContext.Provider>
    );
  }

  const { container } = render(
    <MemoryRouter initialEntries={[address]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Page />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return {
    wrapper: createWrapper(container),
    address: () => currentAddress,
    go: (path: string) => act(async () => void navigate?.(path)),
    handOver,
  };
}

type Page = ReturnType<typeof open>;

function button(page: Page, label: string) {
  const found = page.wrapper.findAllButtons().find((item) => item.findTextRegion()?.getElement().textContent === label);
  if (!found) throw new Error(`No button named ${label}`);
  return found;
}

function field(page: Page, label: string) {
  const found = page.wrapper.findAllFormFields().find((item) => item.findLabel()?.getElement().textContent === label);
  if (!found) throw new Error(`No field named ${label}`);
  return found;
}

function input(page: Page, label: string) {
  const found = createWrapper(field(page, label).getElement()).findInput();
  if (!found) throw new Error(`No input named ${label}`);
  return found;
}

function description(page: Page) {
  return createWrapper(field(page, 'Description').getElement()).findTextarea()?.getTextareaValue();
}

function content(page: Page) {
  return page.wrapper.findContentLayout()?.findContent();
}

async function ready(page: Page, threshold = '5') {
  await waitFor(() => expect(input(page, 'Threshold').getInputValue()).toBe(threshold));
}

function submit(page: Page) {
  return act(async () => button(page, 'Save changes').click());
}

function captureAlarmWrite() {
  const write = vi.fn<(command: PutMetricAlarmCommand) => Promise<unknown>>().mockResolvedValue({});
  send.mockImplementationOnce(async (_endpoint, _operation, request, signal) =>
    request({ send: write } as unknown as CloudWatchClient, signal),
  );
  return write;
}

function expectFlash(page: Page) {
  const items = page.wrapper.findFlashbar()?.findItems();
  expect(items).toHaveLength(1);
  expect(items?.[0]?.findContent()?.getElement().textContent).toBe(`Alarm ${name} saved.`);
}

it('opens the populated edit form with an immutable name and the replace notice', async () => {
  const page = open();
  await ready(page);
  expect(content(page)?.getElement()).toHaveTextContent(
    "Saving replaces the alarm's settings. Its tags stay as they are.",
  );
  expect(content(page)?.find('.aws-area-value-name')?.getElement().textContent).toBe(name);
  expect(page.wrapper.findAllFormFields().map((item) => item.findLabel()?.getElement().textContent)).not.toContain(
    'Name',
  );
  expect(description(page)).toBe('before');
  expect(input(page, 'Data points to alarm').getInputValue()).toBe('1');
  const period = createWrapper(field(page, 'Period').getElement()).findSelect();
  expect(period?.findTrigger().getElement().textContent).toBe('2 minutes');
  expect(button(page, 'Save changes').getElement()).toBeEnabled();
});

it.each([false, true])('tracks implicit data points until overridden (%s)', async (override) => {
  read.mockResolvedValue(metric(name, { DatapointsToAlarm: undefined }));
  const write = captureAlarmWrite();

  const page = open();
  await ready(page);
  const datapoints = input(page, 'Data points to alarm');
  const periods = input(page, 'Evaluation periods');
  expect(datapoints.getInputValue()).toBe('1');
  expect(content(page)?.getElement()).toHaveTextContent('Alarm when 1 out of 1 periods');

  periods.setInputValue('3');
  expect(datapoints.getInputValue()).toBe('3');
  expect(content(page)?.getElement()).toHaveTextContent('Alarm when 3 out of 3 periods');

  if (override) {
    datapoints.setInputValue('2');
    periods.setInputValue('4');
    expect(datapoints.getInputValue()).toBe('2');
    expect(content(page)?.getElement()).toHaveTextContent('Alarm when 2 out of 4 periods');
  }

  await submit(page);
  expect(write).toHaveBeenCalledTimes(1);
  const request = write.mock.calls[0]?.[0].input;
  expect(request?.EvaluationPeriods).toBe(override ? 4 : 3);
  if (override) {
    expect(request?.DatapointsToAlarm).toBe(2);
  } else {
    expect(request).not.toHaveProperty('DatapointsToAlarm');
  }
});

it.each([
  { entered: '5', count: '5', sent: 5 },
  { entered: '3', count: '6', sent: undefined },
])('uses the opening count to detect a revert when $entered is entered', async ({ entered, count, sent }) => {
  read.mockResolvedValue(metric(name, { EvaluationPeriods: 3, DatapointsToAlarm: undefined }));
  const write = captureAlarmWrite();
  const page = open();
  await ready(page);

  const datapoints = input(page, 'Data points to alarm');
  const periods = input(page, 'Evaluation periods');
  periods.setInputValue('5');
  datapoints.setInputValue('2');
  datapoints.setInputValue(entered);
  periods.setInputValue('6');
  expect(datapoints.getInputValue()).toBe(count);
  expect(content(page)?.getElement()).toHaveTextContent(`Alarm when ${count} out of 6 periods`);

  await submit(page);
  expect(write).toHaveBeenCalledTimes(1);
  const request = write.mock.calls[0]?.[0].input;
  expect(request?.EvaluationPeriods).toBe(6);
  if (sent === undefined) {
    expect(request).not.toHaveProperty('DatapointsToAlarm');
  } else {
    expect(request?.DatapointsToAlarm).toBe(sent);
  }
});

it('focuses the invalid evaluation periods or the invalid explicit datapoint count', async () => {
  read.mockResolvedValue(metric(name, { DatapointsToAlarm: undefined }));
  const page = open();
  await ready(page);

  const datapoints = input(page, 'Data points to alarm');
  const periods = input(page, 'Evaluation periods');
  periods.setInputValue('');
  await submit(page);

  const datapointField = field(page, 'Data points to alarm');
  const periodField = field(page, 'Evaluation periods');
  expect(datapointField.findError()).toBeNull();
  expect(periodField.findError()?.getElement()).toHaveTextContent('Enter a whole number of at least 1.');
  expect(periods.findNativeInput().getElement()).toHaveFocus();
  expect(read).toHaveBeenCalledTimes(1);

  periods.setInputValue('3');
  datapoints.setInputValue('');
  await submit(page);
  expect(periodField.findError()).toBeNull();
  expect(datapointField.findError()?.getElement()).toHaveTextContent('Enter a whole number of at least 1.');
  expect(datapoints.findNativeInput().getElement()).toHaveFocus();
  expect(read).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});

it('clears the prior datapoint rule from the field when the count is implicit again', async () => {
  read.mockResolvedValue(metric(name, { DatapointsToAlarm: undefined }));
  const page = open();
  await ready(page);

  const datapoints = input(page, 'Data points to alarm');
  const periods = input(page, 'Evaluation periods');
  datapoints.setInputValue('2');
  await submit(page);
  const datapointField = field(page, 'Data points to alarm');
  expect(datapointField.findError()?.getElement()).toHaveTextContent(
    'Data points to alarm cannot exceed the evaluation periods.',
  );

  datapoints.setInputValue('1');
  periods.setInputValue('');
  await submit(page);
  expect(datapointField.findError()).toBeNull();
  expect(field(page, 'Evaluation periods').findError()?.getElement()).toHaveTextContent(
    'Enter a whole number of at least 1.',
  );
  expect(periods.findNativeInput().getElement()).toHaveFocus();
  expect(read).toHaveBeenCalledTimes(2);
  expect(send).not.toHaveBeenCalled();
});

it('shows loading and then the missing alarm state, and makes no request for a missing name', async () => {
  const opening = deferred<undefined>();
  read.mockReturnValueOnce(opening.promise);
  const page = open();
  expect(content(page)?.findStatusIndicator()?.getElement().textContent).toBe('Loading alarm');
  await act(async () => opening.resolve(undefined));
  await waitFor(() => expect(content(page)?.getElement()).toHaveTextContent('Alarm not found'));
  const link = content(page)?.findLink()?.getElement();
  expect(link).toHaveAttribute('href', ALARMS_PATH);
  expect(link?.textContent).toBe('Alarms');
  await page.go(EDIT_ALARM_PATH);
  expect(content(page)?.getElement()).toHaveTextContent('Alarm not found');
  expect(read).toHaveBeenCalledTimes(1);
});

const openingFailures: { failure: RequestFailure; result: AreaConnection['result']; text: string }[] = [
  {
    failure: { kind: 'not-implemented', operation: 'DescribeAlarms' },
    result: connection.result,
    text: '501 Not Implemented for DescribeAlarms',
  },
  {
    failure: { kind: 'access-denied', operation: 'DescribeAlarms', message: 'Permission refused' },
    result: connection.result,
    text: 'DescribeAlarms was refused: Permission refused',
  },
  {
    failure: { kind: 'other', operation: 'DescribeAlarms', code: 'InvalidParameterValue', message: 'Bad name' },
    result: connection.result,
    text: 'InvalidParameterValue: Bad name',
  },
  {
    failure: { kind: 'emulator-did-not-answer', operation: 'DescribeAlarms', message: '' },
    result: { kind: 'emulator-unreachable', checkedAt: 0, emulator, reason: 'not_started', message: '' },
    text: 'Not started on port 9322',
  },
  {
    failure: { kind: 'emulator-did-not-answer', operation: 'DescribeAlarms', message: '' },
    result: { kind: 'emulator-unreachable', checkedAt: 0, emulator, reason: 'timeout', message: '' },
    text: 'Not answering at https://127.0.0.1:9322',
  },
  {
    failure: { kind: 'engine-did-not-answer', operation: 'DescribeAlarms' },
    result: { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: 9322 },
    text: `The EmuForge engine at ${engineOrigin} is not answering`,
  },
];

it.each(openingFailures)('shows the opening failure $text', async ({ failure, result, text }) => {
  read.mockRejectedValueOnce(new RequestError(failure));
  const page = open(editAlarmPath(name), false, { ...connection, result });
  await waitFor(() => expect(content(page)?.getElement()).toHaveTextContent(text));
  expect(page.wrapper.findForm()).toBeNull();
});

const unsupported: Alarm[] = [
  { type: 'metric-math', data: { ...metric().data, Metrics: [{ Id: 'm1' }] } },
  metric(name, { EvaluationCriteria: { PromQLCriteria: { Query: 'up', PendingPeriod: 0, RecoveryPeriod: 0 } } }),
  { type: 'composite', data: { AlarmName: name } },
  { type: 'log', data: { AlarmName: name } },
  { type: 'metric', data: { AlarmName: name, MetricName: 'Errors' } },
];

it.each(unsupported)('shows the edit restriction for $type', async (alarm) => {
  read.mockResolvedValueOnce(alarm);
  const page = open();
  await waitFor(() => expect(content(page)?.getElement()).toHaveTextContent('Studio cannot edit this alarm yet'));
  expect(content(page)?.getElement()).toHaveTextContent(reason);
  const link = content(page)?.findLink()?.getElement();
  expect(link).toHaveAttribute('href', destination);
  expect(link?.textContent).toBe('Back to alarm');
  expect(page.wrapper.findForm()).toBeNull();
});

it('hands the exact name and success to the alarm page after saving', async () => {
  const page = open();
  await ready(page);
  input(page, 'Threshold').setInputValue('7');
  await submit(page);
  expect(send).toHaveBeenCalledExactlyOnceWith(
    engineOrigin,
    'PutMetricAlarm',
    expect.any(Function),
    expect.any(AbortSignal),
  );
  expect(page.handOver).toHaveBeenCalledExactlyOnceWith(destination, [expect.objectContaining({ type: 'success' })]);
  const handed = page.handOver.mock.calls[0]?.[1] as { content: React.ReactNode }[] | undefined;
  const { container } = render(<>{handed?.[0]?.content}</>);
  expect(container.textContent).toBe(`Alarm ${name} saved.`);
});

it('keeps the submitted edit stable until the save-time read returns a conflict', async () => {
  const user = userEvent.setup();
  const request = deferred<Alarm>();
  const page = open();
  await ready(page);
  read.mockReturnValueOnce(request.promise);
  input(page, 'Threshold').setInputValue('7');
  const textarea = createWrapper(field(page, 'Description').getElement()).findTextarea();
  const description = textarea?.findNativeTextarea().getElement();
  if (!textarea || !description) throw new Error('Missing Description field');
  textarea.setTextareaValue('Submitted description');
  description.focus();

  await submit(page);
  expect(button(page, 'Save changes').findLoadingIndicator()).not.toBeNull();
  expect(description.readOnly).toBe(true);
  expect(description).toHaveFocus();
  await user.keyboard('new text');
  const enabled = page.wrapper.findCheckbox()?.findNativeInput();
  enabled?.click();
  expect(enabled?.getElement()).toBeChecked();
  expect(textarea.getTextareaValue()).toBe('Submitted description');
  expect(description).toHaveFocus();

  await act(async () => request.resolve(metric(name, { Threshold: 8 })));
  expect(textarea.getTextareaValue()).toBe('Submitted description');
  expect(description.readOnly).toBe(false);
  expect(input(page, 'Threshold').getInputValue()).toBe('7');
  expect(page.wrapper.findAlert()?.findHeader()?.getElement().textContent).toBe(
    'This alarm changed while you were editing it',
  );
  expect(send).not.toHaveBeenCalled();
});

it('shows every conflict, keeps changed entries, adopts untouched ones and allows a new save', async () => {
  const page = open();
  await ready(page);
  input(page, 'Threshold').setInputValue('7');
  input(page, 'Evaluation periods').setInputValue('4');
  read.mockResolvedValue(
    metric(name, {
      Threshold: 8,
      EvaluationPeriods: 3,
      AlarmDescription: 'outside',
      Namespace: 'Outside',
      AlarmActions: [externalAction],
    }),
  );
  metrics.mockResolvedValue([]);
  await submit(page);

  const alert = page.wrapper.findAlert();
  expect(alert?.findHeader()?.getElement().textContent).toBe('This alarm changed while you were editing it');
  expect(alert?.getElement().contains(document.activeElement)).toBe(true);
  expect(alert?.findContent().getElement()).toHaveTextContent(
    'Nothing was saved. Save changes again to apply your form entries over the conflicting values shown below.',
  );
  expect(alert?.findContent().getElement()).toHaveTextContent('Threshold (now 8)');
  expect(alert?.findContent().getElement()).toHaveTextContent('Evaluation periods (now 3)');
  expect(input(page, 'Threshold').getInputValue()).toBe('7');
  expect(input(page, 'Evaluation periods').getInputValue()).toBe('4');
  expect(description(page)).toBe('outside');
  expect(send).not.toHaveBeenCalled();
  await waitFor(() => expect(input(page, 'Namespace').getInputValue()).toBe('Outside'));
  const action = createWrapper(field(page, 'In alarm').getElement()).findMultiselect();
  await waitFor(() =>
    expect(action?.findToken(1)?.findOption().getElement()).toHaveTextContent('Not a topic in the emulator'),
  );

  await submit(page);
  expect(edit).toHaveBeenLastCalledWith(
    engineOrigin,
    name,
    expect.objectContaining({ data: expect.objectContaining({ Threshold: 8, EvaluationPeriods: 3 }) }),
    expect.objectContaining({ threshold: '7', evaluationPeriods: '4', description: 'outside' }),
    expect.any(AbortSignal),
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(page.handOver).toHaveBeenCalledTimes(1);
});

it.each([
  [undefined, 'Alarm not found'],
  [unsupported[0], 'Studio cannot edit this alarm yet'],
] as const)('stops on a save-time alarm of %s', async (latest, text) => {
  const page = open();
  await ready(page);
  read.mockResolvedValueOnce(latest);
  input(page, 'Threshold').setInputValue('7');
  await submit(page);
  expect(page.wrapper.findAlert()?.findHeader()?.getElement().textContent).toBe(text);
  expect(send).not.toHaveBeenCalled();
  expect(page.handOver).not.toHaveBeenCalled();
});

it.each(['DescribeAlarms', 'PutMetricAlarm'])('shows the failed %s and keeps the entries', async (operation) => {
  const page = open();
  await ready(page);
  const failure = denied(operation, 'The request was refused.');
  if (operation === 'DescribeAlarms') read.mockRejectedValueOnce(failure);
  else send.mockRejectedValueOnce(failure);
  input(page, 'Threshold').setInputValue('7');
  await submit(page);
  expect(page.wrapper.findAlert()?.findContent().getElement().textContent).toBe(
    `${operation} was refused: The request was refused.`,
  );
  expect(input(page, 'Threshold').getInputValue()).toBe('7');
  if (operation === 'DescribeAlarms') expect(send).not.toHaveBeenCalled();
  expect(page.handOver).not.toHaveBeenCalled();
});

it('keeps Save changes visible and unavailable after PutMetricAlarm returns 501', async () => {
  const page = open();
  await ready(page);
  send.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'PutMetricAlarm' }));
  await submit(page);

  const alert = page.wrapper.findAlert();
  expect(alert?.findHeader()?.getElement().textContent).toBe('Not implemented by the emulator');
  expect(alert?.findContent().getElement().textContent).toBe(
    'The emulator answered 501 Not Implemented for PutMetricAlarm.',
  );
  expect(button(page, 'Save changes').getElement()).toBeDisabled();
  expect(page.handOver).not.toHaveBeenCalled();
});

it.each(['answers', 'fails'])('hands over once when the pending opening topic read %s later', async (outcome) => {
  const topicRead = deferred<string[]>();
  topics.mockReturnValueOnce(topicRead.promise);
  read.mockResolvedValue(metric(name, { AlarmActions: [externalAction] }));
  const page = open(editAlarmPath(name), true);
  await ready(page);
  await waitFor(() => expect(topics).toHaveBeenCalledTimes(1));
  await submit(page);
  expect(page.address()).toBe(destination);
  expectFlash(page);
  await act(async () => {
    if (outcome === 'answers') topicRead.resolve([]);
    else topicRead.reject(denied('ListTopics', 'The topic read failed.'));
  });
  expect(page.address()).toBe(destination);
  expectFlash(page);
  expect(send).toHaveBeenCalledTimes(1);
});

it.each(['history first', 'tags first', 'history failure', 'tags failure', 'alarm failure'])(
  'keeps the success in the area through destination reads (%s)',
  async (order) => {
    const alarmRead = deferred<Alarm>();
    const historyRead = deferred<Awaited<ReturnType<typeof readAlarmHistory>>>();
    const tagsRead = deferred<Awaited<ReturnType<typeof readAlarmTags>>>();
    read.mockResolvedValueOnce(metric()).mockResolvedValueOnce(metric()).mockReturnValue(alarmRead.promise);
    history.mockReturnValue(historyRead.promise);
    tags.mockReturnValue(tagsRead.promise);
    const page = open(editAlarmPath(name), true);
    await ready(page);
    await submit(page);
    expect(page.address()).toBe(destination);
    expect(content(page)?.findStatusIndicator()?.getElement().textContent).toBe('Loading alarm');
    expectFlash(page);

    if (order === 'alarm failure') {
      await act(async () => alarmRead.reject(denied('DescribeAlarms', 'Alarm refused.')));
      await waitFor(() => expect(content(page)?.getElement()).toHaveTextContent('Alarm refused.'));
      expectFlash(page);
      return;
    }

    await act(async () => alarmRead.resolve(metric()));
    await waitFor(() => {
      expect(history).toHaveBeenCalledTimes(1);
      expect(tags).toHaveBeenCalledTimes(1);
    });
    expectFlash(page);

    const answerHistory = async () => {
      await act(async () => {
        if (order === 'history failure') historyRead.reject(denied('DescribeAlarmHistory', 'History refused.'));
        else historyRead.resolve(historyItems);
      });
      await waitFor(() => {
        const table = page.wrapper.findAllTables()[0];
        if (order === 'history failure')
          expect(table?.findEmptySlot()?.getElement()).toHaveTextContent('History refused.');
        else expect(table?.findBodyCell(1, 3)?.getElement().textContent).toBe('Alarm saved');
      });
      expectFlash(page);
    };

    const answerTags = async () => {
      await act(async () => {
        if (order === 'tags failure') tagsRead.reject(denied('ListTagsForResource', 'Tags refused.'));
        else tagsRead.resolve(tagItems);
      });
      await waitFor(() => {
        const table = page.wrapper.findAllTables()[1];
        if (order === 'tags failure') expect(table?.findEmptySlot()?.getElement()).toHaveTextContent('Tags refused.');
        else expect(table?.findBodyCell(1, 2)?.getElement().textContent).toBe('local');
      });
      expectFlash(page);
    };

    if (order === 'tags first') {
      await answerTags();
      await answerHistory();
    } else {
      await answerHistory();
      await answerTags();
    }
  },
);

it.each([1, 3])('submits the joined rule for the save-time read of %i evaluation periods', async (periods) => {
  const page = open();
  await ready(page);
  read.mockResolvedValueOnce(metric(name, { EvaluationPeriods: periods }));
  input(page, 'Data points to alarm').setInputValue('2');
  await submit(page);
  expect(read).toHaveBeenCalledTimes(2);
  if (periods === 3) {
    expect(send).toHaveBeenCalledTimes(1);
    expect(page.handOver).toHaveBeenCalledTimes(1);
  } else {
    expect(send).not.toHaveBeenCalled();
    expect(field(page, 'Data points to alarm').findError()?.getElement().textContent).toBe(
      'Data points to alarm cannot exceed the evaluation periods. Evaluation periods now 1.',
    );
  }
});

it('resets entries for a changed name and ignores a pending save from the old form', async () => {
  const other = 'Other alarm';
  const pendingWrite = deferred<unknown>();
  send.mockReturnValueOnce(pendingWrite.promise);
  read.mockImplementation(async (_endpoint, current) =>
    current === name ? metric() : metric(other, { Threshold: 9, AlarmDescription: 'second' }),
  );
  const page = open();
  await ready(page);
  input(page, 'Threshold').setInputValue('7');
  await submit(page);
  expect(send).toHaveBeenCalledTimes(1);
  const firstSignal = send.mock.calls[0]?.[3];

  await page.go(editAlarmPath(other));
  await ready(page, '9');
  expect(description(page)).toBe('second');
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => pendingWrite.resolve({}));
  expect(page.handOver).not.toHaveBeenCalled();
  await submit(page);
  expect(edit).toHaveBeenLastCalledWith(
    engineOrigin,
    other,
    expect.objectContaining({ data: expect.objectContaining({ AlarmName: other }) }),
    expect.objectContaining({ name: other, threshold: '9', description: 'second' }),
    expect.any(AbortSignal),
  );
  expect(page.handOver).toHaveBeenCalledExactlyOnceWith(alarmPath(other), [
    expect.objectContaining({ type: 'success' }),
  ]);
});

it('keeps an action unmarked when the opening topic read fails and retries at that field', async () => {
  read.mockResolvedValueOnce(metric(name, { AlarmActions: [externalAction] }));
  topics.mockRejectedValueOnce(denied('ListTopics', 'Topics refused.'));
  const page = open();
  await ready(page);
  const action = createWrapper(field(page, 'In alarm').getElement());
  await waitFor(() => expect(action.findAlert()?.findContent().getElement()).toHaveTextContent('Topics refused.'));
  expect(action.findMultiselect()?.findToken(1)?.findOption().getElement()).not.toHaveTextContent(
    'Not a topic in the emulator',
  );
  button(page, 'Retry').click();
  await waitFor(() => expect(action.findAlert()).toBeNull());
  expect(action.findMultiselect()?.findToken(1)?.findOption().getElement()).toHaveTextContent(
    'Not a topic in the emulator',
  );
  expect(topics).toHaveBeenCalledTimes(2);
});

it('uses text fields when the opening metric read fails and retries at the metric', async () => {
  metrics.mockRejectedValueOnce(denied('ListMetrics', 'Metrics refused.'));
  const page = open();
  await ready(page);
  await waitFor(() => expect(input(page, 'Namespace').getInputValue()).toBe('App'));
  expect(input(page, 'Metric name').getInputValue()).toBe('Errors');
  expect(page.wrapper.findAlert()?.findContent().getElement()).toHaveTextContent('Metrics refused.');
  button(page, 'Retry').click();
  await waitFor(() => expect(page.wrapper.findAlert()).toBeNull());
  expect(metrics).toHaveBeenCalledTimes(2);
  expect(
    createWrapper(field(page, 'Metric name').getElement()).findSelect()?.findTrigger().getElement(),
  ).toHaveTextContent('Errors');
});

it.each(['unchanged', 'changed'])('cancels a form that is %s and sends nothing', async (state) => {
  const page = open(editAlarmPath(name), true);
  await ready(page);
  if (state === 'changed') input(page, 'Threshold').setInputValue('7');
  await act(async () => button(page, 'Cancel').click());
  if (state === 'changed') {
    expect(page.address()).toBe(editAlarmPath(name));
    expect(page.wrapper.findModal()?.findHeader()?.getElement().textContent).toBe('Discard what you entered?');
    await act(async () => button(page, 'Discard').click());
  }
  expect(page.address()).toBe(destination);
  expect(send).not.toHaveBeenCalled();
});
