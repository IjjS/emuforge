import type { Target } from '@aws-sdk/client-eventbridge';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { TargetsTable } from './targets-table';

const operation = 'ListTargetsByRule';
const engineOrigin = 'http://127.0.0.1:8314';
const lambdaArn = 'arn:aws:lambda:us-east-1:000000000000:function:process';
const eventBusArn = 'arn:aws:events:us-east-1:000000000000:event-bus/forwarded';
const queueArn = 'arn:aws:sqs:us-east-1:000000000000:orders.fifo';
const dlqArn = 'arn:aws:sqs:us-east-1:000000000000:failed';
const roleArn = 'arn:aws:iam::000000000000:role/deliver';

function open({ value, failure, loading = false }: { value?: Target[]; failure?: RequestFailure; loading?: boolean }) {
  const refresh = vi.fn();
  const onRemove = vi.fn();
  const { container } = render(
    <MemoryRouter>
      <TargetsTable
        connection={{ engineOrigin, result: undefined }}
        targets={{ value, failure, loading, refresh }}
        onRemove={onRemove}
      />
    </MemoryRouter>,
  );
  const table = createWrapper(container).findTable();
  if (!table) throw new Error('Expected the targets table');
  return { table, refresh, onRemove };
}

it('lists all target kinds in response order and shows the inputs and optional delivery details', () => {
  const template = '{"id": <order>}';
  const constant = '{"env":"local"}';
  const { table } = open({
    value: [
      { Id: 'lambda', Arn: lambdaArn, Input: constant },
      { Id: 'bus', Arn: eventBusArn, InputPath: '$.detail' },
      {
        Id: 'queue',
        Arn: queueArn,
        DeadLetterConfig: { Arn: dlqArn },
        RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 },
        RoleArn: roleArn,
        SqsParameters: { MessageGroupId: 'orders' },
        InputTransformer: { InputPathsMap: { order: '$.detail.id' }, InputTemplate: template },
      },
      { Id: 'all', Arn: queueArn },
    ],
  });
  expect(table.findRows()).toHaveLength(4);
  const cell = (row: number, column: number) => table.findBodyCell(row, column)?.getElement().textContent;
  expect([1, 2, 3, 4].map((row) => cell(row, 1))).toEqual(['lambda', 'bus', 'queue', 'all']);
  expect([1, 2, 3, 4].map((row) => cell(row, 2))).toEqual([lambdaArn, eventBusArn, queueArn, queueArn]);
  expect(cell(1, 3)).toBe(`Constant${constant}`);
  expect(cell(2, 3)).toBe('Part of the event$.detail');
  expect(cell(3, 3)).toContain('Transformed');
  expect(cell(4, 3)).toBe('Matched event');
  const pairs = (column: number) =>
    table
      .findBodyCell(3, column)
      ?.findKeyValuePairs()
      ?.findItems()
      .map((item) => [item.findLabel()?.getElement().textContent, item.findValue()?.getElement().textContent]);
  expect(pairs(3)).toEqual([
    ['Input paths', '{\n  "order": "$.detail.id"\n}'],
    ['Input template', template],
  ]);
  expect(pairs(4)).toEqual([
    ['Dead-letter queue ARN', dlqArn],
    ['Maximum event age (seconds)', '60'],
    ['Maximum retry attempts', '0'],
    ['Role ARN', roleArn],
    ['Message group ID', 'orders'],
  ]);
  expect(cell(4, 4)).toBe('-');
});

it('shows Loading targets while the read is pending', () => {
  expect(open({ loading: true }).table.findLoadingText()?.getElement().textContent).toBe('Loading targets');
});

it.each([
  [900, 900, 'Targets'],
  [348, 900, 'Targets. Scroll sideways to see target input, delivery details, and Remove.'],
])('shows the scroll hint only when the targets table overflows (%d of %d)', (clientWidth, scrollWidth, label) => {
  const client = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
  const scroll = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
  try {
    const { table } = open({ value: [{ Id: 'queue', Arn: queueArn }] });
    expect(table.find('table')?.getElement()).toHaveAccessibleName(label);
    const description = table.findHeaderSlot()?.findHeader()?.findDescription();
    if (clientWidth < scrollWidth) {
      expect(description?.getElement()).toHaveTextContent(
        'Scroll sideways to see target input, delivery details, and Remove.',
      );
    } else {
      expect(description).toBeNull();
    }
  } finally {
    client.mockRestore();
    scroll.mockRestore();
  }
});

it('shows No targets for an empty answer', () => {
  expect(open({ value: [] }).table.findEmptySlot()?.getElement()).toHaveTextContent(/^No targets$/);
});

it.each([
  [{ kind: 'not-implemented', operation }, 'Not implemented by the emulator', operation],
  [{ kind: 'access-denied', operation, message: 'Policy denied' }, 'Access denied', 'Policy denied'],
  [{ kind: 'emulator-did-not-answer', operation, message: 'Timed out' }, 'The emulator did not answer', 'Timed out'],
  [{ kind: 'engine-did-not-answer', operation }, `The EmuForge engine at ${engineOrigin} did not answer`, ''],
  [
    { kind: 'other', operation, code: 'ValidationException', message: 'Read refused' },
    'The targets could not be read',
    'Read refused',
  ],
] satisfies [RequestFailure, string, string][])(
  'shows the targets failure %j and offers retry',
  (failure, status, detail) => {
    const { table, refresh } = open({ failure });
    const empty = table.findEmptySlot();
    expect(empty?.findStatusIndicator()?.getElement().textContent).toBe(status);
    if (detail) expect(empty?.getElement()).toHaveTextContent(detail);
    const retry = empty?.findButton()?.getElement();
    expect(retry).toHaveAccessibleName('Retry');
    if (retry) fireEvent.click(retry);
    expect(refresh).toHaveBeenCalledOnce();
  },
);

it('offers a named Remove for every target, including kinds the screen cannot add', () => {
  const { table, onRemove } = open({
    value: [
      { Id: 'function', Arn: lambdaArn },
      { Id: 'queue', Arn: queueArn },
    ],
  });
  for (const [row, id] of [
    [1, 'function'],
    [2, 'queue'],
  ] as const) {
    const button = table.findBodyCell(row, 5)?.findButton();
    expect(button?.getElement()).toHaveAccessibleName(`Remove target ${id}`);
    expect(button?.getElement()).toHaveTextContent('Remove');
    button?.click();
  }
  expect(onRemove.mock.calls).toEqual([['function'], ['queue']]);
});
