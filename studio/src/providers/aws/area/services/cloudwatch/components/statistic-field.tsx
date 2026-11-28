import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { Ref } from 'react';

import type { StatisticEntry } from '../alarm-form';
import { statisticText } from '../format';

const OPTIONS = [
  { value: 'Average', description: 'The mean of the values in a period.' },
  { value: 'Sum', description: 'The values in a period added up.' },
  { value: 'Minimum', description: 'The lowest value in a period.' },
  { value: 'Maximum', description: 'The highest value in a period.' },
  { value: 'SampleCount', description: 'How many values a period holds.' },
  { value: 'Other', description: 'A percentile or another extended statistic, such as p99.' },
] as const;
const options = OPTIONS.map(({ value, description }) => ({
  value,
  label: value === 'Other' ? value : statisticText(value),
  description,
}));

interface StatisticFieldProps {
  value: StatisticEntry;
  onChange: (statistic: StatisticEntry) => void;
  error?: string | undefined;
  inputRef?: Ref<InputProps.Ref>;
}

export function StatisticField({ value, onChange, error, inputRef }: StatisticFieldProps) {
  return (
    <SpaceBetween size="m">
      <FormField label="Statistic">
        <Select
          options={options}
          selectedOption={options.find((option) => option.value === value.kind) ?? null}
          onChange={({ detail }) => {
            const picked = OPTIONS.find((option) => option.value === detail.selectedOption.value)?.value;
            if (picked && picked !== value.kind) {
              onChange(picked === 'Other' ? { kind: 'Other', text: '' } : { kind: picked });
            }
          }}
        />
      </FormField>
      {value.kind === 'Other' && (
        <FormField label="Extended statistic" errorText={error}>
          <Input
            ref={inputRef}
            value={value.text}
            onChange={({ detail }) => onChange({ kind: 'Other', text: detail.value })}
          />
        </FormField>
      )}
    </SpaceBetween>
  );
}
