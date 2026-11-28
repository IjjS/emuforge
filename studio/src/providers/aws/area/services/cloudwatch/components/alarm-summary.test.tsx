import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { creationDateText } from '../../../components/format-date';
import type { Alarm } from '../alarm';
import { AlarmSummary } from './alarm-summary';

afterEach(() => vi.unstubAllGlobals());

it('shows the name first, copies the exact name and ARN, and renders summary values as text', async () => {
  const name = 'first  second\nthird\u2028last';
  const arn = `arn:aws:cloudwatch:us-east-1:000000000000:alarm:${name}`;
  const description = '<b>literal</b> https://example.com/';
  const changed = new Date('2026-11-27T00:00:00Z');
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const data: Alarm['data'] = {
    AlarmName: name,
    AlarmArn: arn,
    AlarmDescription: description,
    StateTransitionedTimestamp: changed,
    StateValue: 'ALARM',
    StateReason: 'Threshold crossed',
    ActionsEnabled: true,
  };
  const { container, rerender } = render(<AlarmSummary alarm={{ type: 'metric', data }} />);
  const pairs = () => createWrapper(container).findKeyValuePairs()?.findItems() ?? [];
  const values = () => new Map(pairs().map((item) => [item.findLabel()?.getElement().textContent, item.findValue()]));
  const text = (label: string) => values().get(label)?.getElement().textContent;
  expect(pairs()[0]?.findLabel()?.getElement().textContent).toBe('Name');
  for (const [label, value] of [
    ['Name', name],
    ['ARN', arn],
  ] as const) {
    const copy = values().get(label)?.findCopyToClipboard();
    expect(copy?.findDisplayedText()?.getElement().textContent).toBe(value);
    const button = copy?.findCopyButton().getElement();
    expect(button).toHaveAccessibleName(`Copy ${label}`);
    if (!button) throw new Error('Copy control missing');
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(value));
  }
  expect(text('Type')).toBe('Metric alarm');
  expect(text('State')).toBe('In alarm');
  expect(text('State reason')).toBe('Threshold crossed');
  expect(text('State last changed')).toBe(creationDateText(changed));
  expect(text('Actions')).toBe('On');
  expect(text('Description')).toBe(description);
  expect(values().get('Description')?.find('b')).toBeNull();
  expect(values().get('Description')?.findLink()).toBeNull();

  rerender(
    <AlarmSummary alarm={{ type: 'metric', data: { ...data, AlarmDescription: undefined, ActionsEnabled: false } }} />,
  );
  expect(text('Description')).toBe('-');
  expect(text('Actions')).toBe('Off');
});
