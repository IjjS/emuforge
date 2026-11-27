import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageResourcesContext } from '../../../components/page-resources';
import type { Alarm } from '../alarm';
import { listAlarms, type AlarmFilters } from '../alarms-api';
import { AlarmListPage } from './alarm-list-page';

vi.mock('../alarms-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../alarms-api')>()),
  listAlarms: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8307';
const EMULATOR = { port: 9307, endpoint: 'https://127.0.0.1:9307' };
const CONNECTED = { kind: 'connected', checkedAt: 0, emulator: EMULATOR } as const;
const read = vi.mocked(listAlarms);
const operation = 'DescribeAlarms';
const changedAt = new Date('2026-11-27T08:05:06.000Z');

const metric: Alarm = {
  type: 'metric',
  data: {
    AlarmName: 'a-metric',
    Namespace: 'App',
    MetricName: 'Errors',
    Statistic: 'Sum',
    ComparisonOperator: 'GreaterThanThreshold',
    Threshold: 1,
    EvaluationPeriods: 3,
    Period: 60,
    DatapointsToAlarm: 2,
    StateValue: 'ALARM',
    ActionsEnabled: true,
    StateTransitionedTimestamp: changedAt,
  },
};
const composite: Alarm = {
  type: 'composite',
  data: { AlarmName: 'b-composite', AlarmRule: 'ALARM("a-metric")', StateValue: 'OK', ActionsEnabled: false },
};
const log: Alarm = {
  type: 'log',
  data: {
    AlarmName: 'c-log',
    ScheduledQueryConfiguration: {
      QueryString: 'fields @message',
      ScheduledQueryRoleARN: undefined,
      ScheduleConfiguration: undefined,
      AggregationExpression: undefined,
    },
    StateValue: 'INSUFFICIENT_DATA',
    ActionsEnabled: true,
  },
};

beforeEach(() => read.mockReset());

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a visible control or value');
  return value;
}

function open(result: AreaConnection['result'] = CONNECTED) {
  const resources = vi.fn();
  const client = new QueryClient();
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PageResourcesContext.Provider value={resources}>
          <AlarmListPage connection={{ engineOrigin: ENGINE, result }} />
        </PageResourcesContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { table: present(createWrapper(container).findTable()), resources };
}

type AlarmsTable = ReturnType<typeof open>['table'];
const linkAt = (table: AlarmsTable, row: number) => table.findRows()[row - 1]?.findLink()?.getElement();

function expectRead(filters: AlarmFilters, token?: string) {
  expect(read).toHaveBeenLastCalledWith(ENGINE, { prefix: '', ...filters }, token, expect.any(AbortSignal));
}

function changePrefix(table: AlarmsTable, value: string) {
  const input = present(table.findFilterSlot()?.findTextFilter()?.findInput().findNativeInput());
  fireEvent.change(input.getElement(), { target: { value } });
}

function buttonIn(scope: ReturnType<AlarmsTable['findHeaderSlot']>, name: string) {
  return present(
    scope?.findAllButtons().find((button) => {
      const label = button.getElement().getAttribute('aria-label') ?? button.findTextRegion()?.getElement().textContent;
      return label === name;
    }),
  );
}

it('shows the three types with their links, states, conditions, actions and state changes', async () => {
  read.mockResolvedValue({ items: [metric, composite, log] });
  const { table, resources } = open();
  expect(resources).toHaveBeenCalledWith({ word: 'alarms' });
  await waitFor(() => expect(table.findRows()).toHaveLength(3));
  expect(
    table
      .findColumnHeaders()
      .slice(1)
      .map((header) => header.getElement().textContent),
  ).toEqual(['Name', 'State', 'Type', 'Condition', 'Actions', 'State last changed']);
  const expected = [
    [
      'a-metric',
      'In alarm',
      'Metric alarm',
      'Errors greater than 1 (2 out of 3 periods, 1 minute each)',
      'On',
      creationDateText(changedAt),
    ],
    ['b-composite', 'OK', 'Composite alarm', 'ALARM("a-metric")', 'Off', '-'],
    ['c-log', 'Insufficient data', 'Log alarm', 'fields @message', 'On', '-'],
  ];
  expected.forEach((cells, index) => {
    const row = index + 1;
    expect(linkAt(table, row)).toHaveAttribute('href', `/aws/cloudwatch/alarms/alarm?name=${cells[0]}`);
    expect(cells.map((_, column) => table.findBodyCell(row, column + 2)?.getElement().textContent)).toEqual(cells);
  });
});

it('preserves the whole unusual name in the link text and in its query', async () => {
  const name = ' first  second\nlast ';
  read.mockResolvedValue({ items: [{ type: 'log', data: { AlarmName: name } }] });
  const { table } = open();
  await waitFor(() => expect(linkAt(table, 1)).toBeVisible());
  const link = present(table.findRows()[0]?.findLink());
  const value = link.find('.aws-area-value-name');
  expect(value?.getElement().textContent).toBe(name);
  expect(value?.getElement().parentElement).toHaveStyle({ whiteSpace: 'pre-wrap' });
  const address = new URL(present(link.getElement().getAttribute('href')), ENGINE);
  expect(address.pathname).toBe('/aws/cloudwatch/alarms/alarm');
  expect(address.searchParams.get('name')).toBe(name);
});

it('shows loading, no alarms, and no alarms matching a filter', async () => {
  read.mockResolvedValue({ items: [] });
  const { table } = open();
  expect(table.findLoadingText()?.getElement()).toHaveTextContent(/^Loading alarms$/);
  await waitFor(() => expect(table.findEmptySlot()?.getElement()).toHaveTextContent(/^No alarms$/));
  changePrefix(table, 'Missing');
  await waitFor(() => expect(table.findEmptySlot()?.getElement()).toHaveTextContent(/^No alarms match$/));
  expectRead({ prefix: 'Missing' });
});

it('uses the next token and refreshes with the shown page token', async () => {
  read.mockResolvedValueOnce({ items: [metric], next: 'token-2' }).mockResolvedValue({ items: [composite] });
  const { table } = open();
  await waitFor(() => expect(linkAt(table, 1)).toHaveTextContent(/^a-metric$/));

  fireEvent.click(present(table.findPagination()).findNextPageButton().getElement());
  await waitFor(() => expect(linkAt(table, 1)).toHaveTextContent(/^b-composite$/));
  expectRead({}, 'token-2');

  fireEvent.click(buttonIn(table.findHeaderSlot(), 'Refresh').getElement());
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expectRead({}, 'token-2');
  expect(table.findPagination()?.findPageNumberByIndex(2)?.getElement()).toHaveAttribute('aria-current', 'true');
});

it('sends the prefix after a pause and starts from page one', async () => {
  read.mockResolvedValueOnce({ items: [metric], next: 'token-2' }).mockResolvedValue({ items: [composite] });
  const { table } = open();
  await waitFor(() => expect(linkAt(table, 1)).toHaveTextContent(/^a-metric$/));
  fireEvent.click(present(table.findPagination()).findNextPageButton().getElement());
  await waitFor(() => expect(linkAt(table, 1)).toHaveTextContent(/^b-composite$/));
  expectRead({}, 'token-2');
  const field = table.findFilterSlot()?.findAllFormFields()[0];
  expect(field?.findDescription()?.getElement().textContent).toBe(
    'Finds alarms whose name begins with the text. Upper and lower case are different.',
  );

  changePrefix(table, ' b-MiXeD ');
  expect(read).toHaveBeenCalledTimes(2);
  await waitFor(() => expectRead({ prefix: ' b-MiXeD ' }));
  expect(table.findPagination()?.findPageNumberByIndex(1)?.getElement()).toHaveAttribute('aria-current', 'true');
});

it('starts the state filter from page one, combines filters, and clears the state with Any state', async () => {
  read.mockResolvedValue({ items: [metric], next: 'token-2' });
  const { table } = open();
  await waitFor(() => expect(linkAt(table, 1)).toHaveTextContent(/^a-metric$/));
  fireEvent.click(present(table.findPagination()).findNextPageButton().getElement());
  await waitFor(() => expectRead({}, 'token-2'));
  await waitFor(() => expect(linkAt(table, 1)).toBeVisible());

  const select = present(table.findFilterSlot()?.findSelect());
  select.openDropdown();
  const options = present(select.findDropdown().findOptions());
  expect(options.map((option) => option.findLabel().getElement().textContent)).toEqual([
    'Any state',
    'OK',
    'In alarm',
    'Insufficient data',
  ]);
  select.selectOptionByValue('ALARM');
  await waitFor(() => expectRead({ state: 'ALARM' }));
  expect(table.findPagination()?.findPageNumberByIndex(1)?.getElement()).toHaveAttribute('aria-current', 'true');

  changePrefix(table, 'a-');
  await waitFor(() => expectRead({ prefix: 'a-', state: 'ALARM' }));
  select.openDropdown();
  select.selectOptionByValue('');
  await waitFor(() => expectRead({ prefix: 'a-' }));
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
    'Not started on port 9307',
  ],
  [
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('timeout'),
    'Not answering at https://127.0.0.1:9307',
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: EMULATOR.port },
    `The EmuForge engine at ${ENGINE} is not answering`,
  ],
  [
    'another refusal',
    { kind: 'other', operation, code: 'InvalidParameterValue', message: 'bad prefix' },
    CONNECTED,
    'InvalidParameterValue: bad prefix',
  ],
];

it.each(failures)('shows %s in the table and retries the read', async (_, failure, connection, text) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ items: [metric] });
  const { table } = open(connection);
  await waitFor(() => expect(table.findEmptySlot()?.getElement()).toHaveTextContent(text));
  if (failure.kind === 'not-implemented') {
    expect(table.findEmptySlot()?.findStatusIndicator()?.getElement().textContent).toBe(
      'Not implemented by the emulator',
    );
  }
  fireEvent.click(buttonIn(table.findEmptySlot(), 'Retry').getElement());
  await waitFor(() => expect(linkAt(table, 1)).toHaveTextContent(/^a-metric$/));
  expect(read).toHaveBeenCalledTimes(2);
  expectRead({});
});

it('links to the create form', () => {
  read.mockResolvedValue({ items: [] });
  const { table } = open();
  expect(buttonIn(table.findHeaderSlot(), 'Create alarm').getElement()).toHaveAttribute(
    'href',
    '/aws/cloudwatch/alarms/create',
  );
});

it('links Edit to the selected editable alarm and explains why other alarms cannot be edited', async () => {
  read.mockResolvedValue({ items: [metric, composite] });
  const { table } = open();
  const edit = () => buttonIn(table.findHeaderSlot(), 'Edit').getElement();
  expect(edit()).toHaveAttribute('aria-disabled', 'true');
  await waitFor(() => expect(table.findRows()).toHaveLength(2));

  fireEvent.click(present(table.findRowSelectionArea(1)?.find('input')).getElement());
  expect(edit()).toHaveAttribute('href', '/aws/cloudwatch/alarms/edit?name=a-metric');
  fireEvent.click(present(table.findRowSelectionArea(2)?.find('input')).getElement());
  expect(edit()).toHaveAttribute('aria-disabled', 'true');
  expect(edit()).toHaveAccessibleDescription('Studio cannot edit this alarm yet');
});
