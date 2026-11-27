import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

import type { StatisticEntry } from '../alarm-form';
import { StatisticField } from './statistic-field';

const PAGE = createWrapper(document.body);

it('describes each statistic and reports extended text only for Other', () => {
  const changed = vi.fn();
  function Field() {
    const [value, setValue] = useState<StatisticEntry>({ kind: 'Average' });
    return (
      <StatisticField
        value={value}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Field />);
  const select = PAGE.findSelect();
  select?.openDropdown();
  const options = [
    ['Average', 'Average', 'The mean of the values in a period.'],
    ['Sum', 'Sum', 'The values in a period added up.'],
    ['Minimum', 'Minimum', 'The lowest value in a period.'],
    ['Maximum', 'Maximum', 'The highest value in a period.'],
    ['SampleCount', 'Sample count', 'How many values a period holds.'],
    ['Other', 'Other', 'A percentile or another extended statistic, such as p99.'],
  ];
  for (const [value, label, description] of options) {
    const option = select?.findDropdown().findOptionByValue(value!);
    expect(option?.findLabel().getElement()).toHaveTextContent(label!);
    expect(option?.findDescription()?.getElement()).toHaveTextContent(description!);
  }
  select?.selectOptionByValue('Other');
  PAGE.findInput()?.setInputValue('p99');
  expect(changed).toHaveBeenLastCalledWith({ kind: 'Other', text: 'p99' });
  select?.openDropdown();
  select?.selectOptionByValue('Sum');
  expect(PAGE.findInput()).toBeNull();
  expect(changed).toHaveBeenLastCalledWith({ kind: 'Sum' });
});

it('shows Other and its text for an existing extended statistic', () => {
  render(<StatisticField value={{ kind: 'Other', text: 'tm99' }} onChange={vi.fn()} />);
  expect(PAGE.findSelect()?.findTrigger().getElement()).toHaveTextContent('Other');
  expect(PAGE.findInput()?.getInputValue()).toBe('tm99');
});
