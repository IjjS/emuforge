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
  const details = createWrapper(container);
  return {
    field(label: string) {
      return details
        .findAllKeyValuePairs()
        .flatMap((pairs) => pairs.findItems())
        .find((item) => item.findLabel()?.getElement().textContent === label)
        ?.findValue();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('shows the ARN with its copy control, linked bus, state, description and stored pattern', async () => {
  const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { field } = open({ ...rule, EventPattern: pattern });
  expect(field('ARN')?.getElement().textContent).toBe(arn);
  const copy = field('ARN')?.findCopyToClipboard()?.findCopyButton().getElement();
  expect(copy).toHaveAccessibleName('Copy ARN');
  if (copy) fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(arn));
  const bus = field('Event bus')?.findLink()?.getElement();
  expect(bus).toHaveAttribute('href', '/aws/events/event-buses/bus/*..');
  expect(bus?.textContent).toBe('..');
  expect(field('State')?.getElement().textContent).toBe('Enabled');
  expect(field('Description')?.getElement().textContent).toBe('Routes orders');
  expect(field('Event pattern')?.getElement().textContent).toBe(pattern);
  expect(field('Schedule expression')).toBeUndefined();
  expect(field('Role ARN')).toBeUndefined();
});

it('shows a schedule on its own and a dash for an absent description', () => {
  const { field } = open({ ScheduleExpression: schedule });
  expect(field('Schedule expression')?.getElement().textContent).toBe(schedule);
  expect(field('Event pattern')).toBeUndefined();
  expect(field('Description')?.getElement().textContent).toBe('-');
});

it('keeps both triggers and copies the role ARN when present', async () => {
  const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { field } = open({ ...rule, EventPattern: pattern, ScheduleExpression: schedule, RoleArn: roleArn });
  expect(field('Event pattern')?.getElement().textContent).toBe(pattern);
  expect(field('Schedule expression')?.getElement().textContent).toBe(schedule);
  expect(field('Role ARN')?.getElement().textContent).toBe(roleArn);
  const copy = field('Role ARN')?.findCopyToClipboard()?.findCopyButton().getElement();
  expect(copy).toHaveAccessibleName('Copy Role ARN');
  if (copy) fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(roleArn));
});

it('renders markup in a pattern as literal text', () => {
  const value = '{"detail-type":["<strong>Order placed</strong>"]}';
  const { field } = open({ EventPattern: value });
  expect(field('Event pattern')?.getElement().textContent).toBe(value);
});
