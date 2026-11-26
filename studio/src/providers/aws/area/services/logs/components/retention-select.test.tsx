import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { RetentionSelect } from './retention-select';

const DAYS = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653];

it('offers Never expire and each allowed value, in order and with a description', () => {
  const { container } = render(<RetentionSelect value={undefined} onChange={vi.fn()} />);
  const select = createWrapper(container).findSelect();
  if (select === null) throw new Error('Retention select was not found.');
  act(() => select.openDropdown());
  const dropdown = select.findDropdown();
  const labels = ['Never expire', ...DAYS.map((days) => (days === 1 ? '1 day' : `${days.toString()} days`))];
  expect(dropdown.findOptions().map((option) => option.findLabel().getElement().textContent)).toEqual(labels);
  expect(dropdown.findOptionByValue('')?.findDescription()?.getElement()).toHaveTextContent(
    'No retention is set on the log group.',
  );
  for (const days of DAYS) {
    expect(dropdown.findOptionByValue(days.toString())?.findDescription()?.getElement()).toHaveTextContent(
      /Sets the log group's retention to .+\./,
    );
  }
  for (const [days, span] of [
    ['7', '1 week'],
    ['365', '1 year'],
    ['3653', '10 years'],
  ] as const) {
    expect(dropdown.findOptionByValue(days)?.findDescription()?.getElement()).toHaveTextContent(span);
  }
});

it('reports a finite retention as days and Never expire as undefined', () => {
  const onChange = vi.fn();
  const { container, rerender } = render(<RetentionSelect value={undefined} onChange={onChange} />);
  const select = createWrapper(container).findSelect();
  if (select === null) throw new Error('Retention select was not found.');
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue('7'));
  expect(onChange).toHaveBeenLastCalledWith(7);
  rerender(<RetentionSelect value={7} onChange={onChange} />);
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue(''));
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});
