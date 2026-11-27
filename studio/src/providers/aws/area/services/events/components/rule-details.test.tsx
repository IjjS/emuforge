import type { DescribeRuleResponse } from '@aws-sdk/client-eventbridge';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

import { RuleDetails } from './rule-details';

const arn = 'arn:aws:events:us-east-1:000000000000:rule/../orders';
const roleArn = 'arn:aws:iam::000000000000:role/orders';
const pattern = '{\n  "source": ["orders"]\n}';
const schedule = 'rate(5 minutes)';
const rule = { Arn: arn, State: 'ENABLED', Description: 'Routes orders' } satisfies DescribeRuleResponse;

function open(value: DescribeRuleResponse) {
  const { container } = render(
    <MemoryRouter>
      <RuleDetails rule={value} bus=".." />
    </MemoryRouter>,
  );
  const pairs = createWrapper(container).findAllKeyValuePairs();
  return {
    pairs,
    field(group: number, row: number, label: string) {
      const item = pairs[group]?.findItems()[row];
      expect(item?.findLabel()?.getElement().textContent).toBe(label);
      return item?.findValue();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('shows the ARN with its copy control, linked bus, state, description and stored pattern', async () => {
  const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { field, pairs } = open({ ...rule, EventPattern: pattern });
  const arnField = field(0, 0, 'ARN');
  expect(arnField?.getElement().textContent).toBe(arn);
  const copy = arnField?.findCopyToClipboard()?.findCopyButton().getElement();
  expect(copy).toHaveAccessibleName('Copy ARN');
  if (copy) fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(arn));
  const bus = field(1, 0, 'Event bus')?.findLink()?.getElement();
  expect(bus).toHaveAttribute('href', '/aws/events/event-buses/bus/*..');
  expect(bus?.textContent).toBe('..');
  expect(field(1, 1, 'State')?.getElement().textContent).toBe('Enabled');
  expect(field(1, 2, 'Description')?.getElement().textContent).toBe('Routes orders');
  expect(field(2, 0, 'Event pattern')?.getElement().textContent).toBe(pattern);
  expect(pairs.map((group) => group.findItems().length)).toEqual([1, 3, 1]);
});

it('shows a schedule on its own and a dash for an absent description', () => {
  const { field, pairs } = open({ ScheduleExpression: schedule });
  expect(field(1, 3, 'Schedule expression')?.getElement().textContent).toBe(schedule);
  expect(pairs).toHaveLength(2);
  expect(field(1, 2, 'Description')?.getElement().textContent).toBe('-');
});

it('keeps both triggers and copies the role ARN when present', async () => {
  const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { field } = open({ ...rule, EventPattern: pattern, ScheduleExpression: schedule, RoleArn: roleArn });
  expect(field(2, 0, 'Event pattern')?.getElement().textContent).toBe(pattern);
  expect(field(1, 3, 'Schedule expression')?.getElement().textContent).toBe(schedule);
  const roleField = field(0, 1, 'Role ARN');
  expect(roleField?.getElement().textContent).toBe(roleArn);
  const copy = roleField?.findCopyToClipboard()?.findCopyButton().getElement();
  expect(copy).toHaveAccessibleName('Copy Role ARN');
  if (copy) fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(roleArn));
});

it('renders markup in a pattern as literal text', () => {
  const value = '{"detail-type":["<strong>Order placed</strong>"]}';
  const { field } = open({ EventPattern: value });
  expect(field(2, 0, 'Event pattern')?.getElement().textContent).toBe(value);
});
