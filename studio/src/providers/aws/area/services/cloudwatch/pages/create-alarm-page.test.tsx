import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext } from '../../../components/page-flash';
import type { Alarm } from '../alarm';
import { readAlarmHistory, readAlarmTags } from '../alarm-page-api';
import { listAlarms, readAlarm } from '../alarms-api';
import { createAlarm } from '../create-api';
import { ALARMS_PATH, CREATE_ALARM_PATH, alarmPath } from '../paths';
import { listTopics } from '../topic-api';
import { CreateAlarmPage } from './create-alarm-page';

vi.mock('../create-api', { spy: true });
vi.mock('../alarms-api', { spy: true });
vi.mock('../alarm-page-api', { spy: true });
vi.mock('../topic-api', { spy: true });

const create = vi.mocked(createAlarm);
const read = vi.mocked(readAlarm);
const history = vi.mocked(readAlarmHistory);
const tags = vi.mocked(readAlarmTags);
const topics = vi.mocked(listTopics);
const engineOrigin = 'http://127.0.0.1:8322';
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9322, endpoint: 'https://127.0.0.1:9322' } },
};
const name = ' local  errors /?# ';
const destination = alarmPath(name);
const success = `Alarm ${name} created.`;
const alarm: Alarm = {
  type: 'metric',
  data: { AlarmName: name, AlarmArn: `arn:aws:cloudwatch:us-east-1:000000000000:alarm:${name}` },
};
const historyItems = { items: [{ time: undefined, type: 'Configuration' as const, summary: 'Alarm created' }] };
const tagItems = [{ Key: 'Stage', Value: 'local' }];

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
  create.mockReset().mockResolvedValue('created');
  read.mockReset().mockResolvedValue(alarm);
  vi.mocked(listAlarms).mockReset().mockResolvedValue({ items: [] });
  history.mockReset().mockResolvedValue(historyItems);
  tags.mockReset().mockResolvedValue(tagItems);
  topics.mockReset().mockResolvedValue({ items: [] });
});

afterEach(() => vi.unstubAllGlobals());

function open(inArea = false) {
  const handOver = vi.fn();
  const show = vi.fn();
  let address = '';

  function Page() {
    const { pathname, search } = useLocation();
    address = pathname + search;
    if (inArea) {
      return (
        <AreaLayout
          headerSelector="#studio-header"
          connection={connection}
          routeChanges={pathname === CREATE_ALARM_PATH ? 0 : 1}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
      );
    }
    return (
      <PageFlashContext.Provider value={{ handOver, show }}>
        <CreateAlarmPage connection={connection} params={{}} />
      </PageFlashContext.Provider>
    );
  }

  const { container } = render(
    <MemoryRouter initialEntries={[CREATE_ALARM_PATH]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Page />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { wrapper: createWrapper(container), address: () => address, handOver, show };
}

type Page = ReturnType<typeof open>;

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

function button(page: Page, label: string) {
  const found = page.wrapper.findAllButtons().find((item) => item.findTextRegion()?.getElement().textContent === label);
  if (!found) throw new Error(`No button named ${label}`);
  return found;
}

function enterAlarm(page: Page) {
  input(page, 'Name').setInputValue(name);
  page.wrapper.findToggle()?.findNativeInput().click();
  input(page, 'Namespace').setInputValue('App');
  input(page, 'Metric name').setInputValue('Errors');
  input(page, 'Threshold').setInputValue('2');
}

function submit(page: Page) {
  return act(async () => button(page, 'Create alarm').click());
}

function expectFlash(page: Page) {
  const items = page.wrapper.findFlashbar()?.findItems();
  expect(items).toHaveLength(1);
  expect(items?.[0]?.findContent()?.getElement().textContent).toBe(success);
}

it('hands the exact name and a success message to the created alarm address', async () => {
  const page = open();
  enterAlarm(page);
  await submit(page);

  expect(create).toHaveBeenCalledExactlyOnceWith(
    engineOrigin,
    expect.objectContaining({ AlarmName: name, Namespace: 'App', MetricName: 'Errors', Threshold: 2 }),
    expect.any(AbortSignal),
  );
  expect(page.handOver).toHaveBeenCalledExactlyOnceWith(destination, [expect.objectContaining({ type: 'success' })]);
  const handed = page.handOver.mock.calls[0]?.[1] as { content: React.ReactNode }[] | undefined;
  const { container } = render(<>{handed?.[0]?.content}</>);
  expect(container.textContent).toBe(success);
  expect(page.show).not.toHaveBeenCalled();
});

it('reports an existing name at the Name field and keeps the entries', async () => {
  create.mockResolvedValue('exists');
  const page = open();
  enterAlarm(page);
  await submit(page);

  expect(field(page, 'Name').findError()?.getElement().textContent).toBe(`An alarm named ${name} already exists.`);
  expect(input(page, 'Name').getInputValue()).toBe(name);
  expect(input(page, 'Threshold').getInputValue()).toBe('2');
  expect(page.handOver).not.toHaveBeenCalled();
  expect(page.address()).toBe(CREATE_ALARM_PATH);
});

it.each(['DescribeAlarms', 'PutMetricAlarm'])(
  'shows %s refusal at the form and keeps the entries',
  async (operation) => {
    create.mockRejectedValue(denied(operation, 'The request was refused.'));
    const page = open();
    enterAlarm(page);
    await submit(page);

    expect(page.wrapper.findAlert()?.findContent().getElement().textContent).toBe(
      `${operation} was refused: The request was refused.`,
    );
    expect(input(page, 'Name').getInputValue()).toBe(name);
    expect(input(page, 'Metric name').getInputValue()).toBe('Errors');
    expect(page.handOver).not.toHaveBeenCalled();
  },
);

it('keeps Create alarm visible and unavailable after PutMetricAlarm returns 501', async () => {
  create.mockRejectedValue(new RequestError({ kind: 'not-implemented', operation: 'PutMetricAlarm' }));
  const page = open();
  enterAlarm(page);
  await submit(page);

  const alert = page.wrapper.findAlert();
  expect(alert?.findHeader()?.getElement().textContent).toBe('Not implemented by the emulator');
  expect(alert?.findContent().getElement().textContent).toBe(
    'The emulator answered 501 Not Implemented for PutMetricAlarm.',
  );
  expect(button(page, 'Create alarm').getElement()).toBeDisabled();
  expect(page.handOver).not.toHaveBeenCalled();
});

it.each(['answers', 'fails'])('keeps one hand-over when the pending topic choice later %s', async (outcome) => {
  const choice = deferred<Awaited<ReturnType<typeof listTopics>>>();
  const saved = deferred<'created'>();
  topics.mockReturnValue(choice.promise);
  create.mockReturnValue(saved.promise);
  const page = open(true);
  enterAlarm(page);
  createWrapper(field(page, 'In alarm').getElement()).findMultiselect()?.openDropdown();
  await waitFor(() => expect(topics).toHaveBeenCalledTimes(1));

  await submit(page);
  expect(page.address()).toBe(CREATE_ALARM_PATH);
  await act(async () => saved.resolve('created'));
  expect(page.address()).toBe(destination);
  expectFlash(page);

  await act(async () => {
    if (outcome === 'answers') choice.resolve({ items: ['arn:aws:sns:us-east-1:000000000000:errors'] });
    else choice.reject(denied('ListTopics', 'The choice failed.'));
  });
  expect(page.address()).toBe(destination);
  expectFlash(page);
  expect(read).toHaveBeenCalledTimes(1);
});

it.each(['history first', 'tags first', 'history failure', 'tags failure'])(
  'keeps the success visible in the area through destination reads (%s)',
  async (order) => {
    const alarmRead = deferred<Alarm>();
    const historyRead = deferred<Awaited<ReturnType<typeof readAlarmHistory>>>();
    const tagsRead = deferred<Awaited<ReturnType<typeof readAlarmTags>>>();
    read.mockReturnValue(alarmRead.promise);
    history.mockReturnValue(historyRead.promise);
    tags.mockReturnValue(tagsRead.promise);
    const page = open(true);
    enterAlarm(page);
    await submit(page);
    expect(page.address()).toBe(destination);
    const content = page.wrapper.findContentLayout()?.findContent();
    expect(content?.findStatusIndicator()?.getElement().textContent).toBe('Loading alarm');
    expectFlash(page);

    await act(async () => alarmRead.resolve(alarm));
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
        if (order === 'history failure') {
          expect(table?.findEmptySlot()?.getElement()).toHaveTextContent('History refused.');
        } else {
          expect(table?.findBodyCell(1, 3)?.getElement().textContent).toBe('Alarm created');
        }
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
        if (order === 'tags failure') {
          expect(table?.findEmptySlot()?.getElement()).toHaveTextContent('Tags refused.');
        } else {
          expect(table?.findBodyCell(1, 2)?.getElement().textContent).toBe('local');
        }
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

it.each(['missing', 'failure'])('keeps the success when the destination alarm read is %s', async (outcome) => {
  const alarmRead = deferred<Alarm | undefined>();
  read.mockReturnValue(alarmRead.promise);
  const page = open(true);
  enterAlarm(page);
  await submit(page);
  expectFlash(page);
  await act(async () => {
    if (outcome === 'missing') alarmRead.resolve(undefined);
    else alarmRead.reject(denied('DescribeAlarms', 'Alarm refused.'));
  });

  await waitFor(() => {
    const content = page.wrapper.findContentLayout()?.findContent().getElement();
    expect(content).toHaveTextContent(outcome === 'missing' ? 'Alarm not found' : 'Alarm refused.');
  });
  expectFlash(page);
});

it.each(['unchanged', 'changed'])('cancels a form that is %s and sends nothing', async (state) => {
  const page = open(true);
  if (state === 'changed') input(page, 'Name').setInputValue(name);
  await act(async () => button(page, 'Cancel').click());
  if (state === 'changed') {
    expect(page.address()).toBe(CREATE_ALARM_PATH);
    expect(page.wrapper.findModal()?.findHeader()?.getElement().textContent).toBe('Discard what you entered?');
    await act(async () => button(page, 'Discard').click());
  }
  expect(page.address()).toBe(ALARMS_PATH);
  expect(create).not.toHaveBeenCalled();
});
