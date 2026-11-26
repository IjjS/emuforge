import Select from '@cloudscape-design/components/select';

import { RETENTION_DAYS, retentionText } from '../format';

const SPANS: Record<(typeof RETENTION_DAYS)[number], string> = {
  1: '1 day',
  3: '3 days',
  5: '5 days',
  7: '1 week',
  14: '2 weeks',
  30: '1 month',
  60: '2 months',
  90: '3 months',
  120: '4 months',
  150: '5 months',
  180: '6 months',
  365: '1 year',
  400: '13 months',
  545: '18 months',
  731: '2 years',
  1096: '3 years',
  1827: '5 years',
  2192: '6 years',
  2557: '7 years',
  2922: '8 years',
  3288: '9 years',
  3653: '10 years',
};

const OPTIONS = [
  { value: '', label: retentionText(undefined), description: 'No retention is set on the log group.' },
  ...RETENTION_DAYS.map((days) => ({
    value: String(days),
    label: retentionText(days),
    description: `Sets the log group's retention to ${SPANS[days]}.`,
  })),
];

interface RetentionSelectProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  disabled?: boolean;
}

export function RetentionSelect({ value, onChange, disabled = false }: RetentionSelectProps) {
  return (
    <Select
      options={OPTIONS}
      selectedOption={OPTIONS.find((option) => option.value === (value === undefined ? '' : String(value))) ?? null}
      dropdownRole="dialog"
      disabled={disabled}
      onChange={({ detail }) => {
        onChange(RETENTION_DAYS.find((days) => String(days) === detail.selectedOption.value));
      }}
    />
  );
}
