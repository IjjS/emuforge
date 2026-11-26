import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { optional, useChoiceField, type ChoiceSelectProps } from '../../../components/choice-select';
import { RequestReadFailure } from './request-read-failure';

export type PagedChoiceProps<T> = ChoiceSelectProps<T>;

export function PagedChoice<T>(props: PagedChoiceProps<T>) {
  const {
    source,
    value,
    onChange,
    fixed,
    placeholder,
    invalid,
    ariaLabel,
    selectRef,
    triggerVariant,
    connection,
    things,
  } = props;
  const fixedOption = fixed === undefined ? undefined : { value: '', label: fixed };
  const { choices, items, options, props: field } = useChoiceField(props, fixedOption);
  const selected = value === undefined ? (fixedOption ?? null) : source.optionOf(value);

  const handleChange = ({ detail }: { detail: SelectProps.ChangeDetail }) => {
    if (detail.selectedOption.value === fixedOption?.value && fixedOption !== undefined) {
      onChange(undefined);
      return;
    }
    const choice = items.find((item) => source.optionOf(item).value === detail.selectedOption.value);
    if (choice !== undefined) onChange(choice);
  };

  return (
    <SpaceBetween size="xs">
      <Select
        ref={selectRef}
        {...field}
        {...optional({ placeholder, invalid, ariaLabel, triggerVariant })}
        options={options}
        selectedOption={selected}
        dropdownRole="dialog"
        onChange={handleChange}
      />
      {choices.failure !== undefined && (
        <RequestReadFailure failure={choices.failure} connection={connection} thing={things} onRetry={choices.retry} />
      )}
    </SpaceBetween>
  );
}
