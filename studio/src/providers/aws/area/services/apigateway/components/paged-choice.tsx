import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useEffectEvent, useRef } from 'react';

import { optional, useChoiceField, type ChoiceSelectProps } from '../../../components/choice-select';
import { identityOption } from '../../../components/name-identity';
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
  const { readAgainOnOpen } = source;
  const {
    choices,
    items,
    options,
    props: field,
  } = useChoiceField({ ...props, source: { ...source, readAgainOnOpen: false } }, fixedOption);
  const select = useRef<HTMLDivElement>(null);
  const firstPageRetry = useRef(false);
  const selectedOption = value === undefined ? fixedOption : source.optionOf(value);
  const selected = selectedOption === undefined ? null : identityOption(selectedOption);

  useEffect(() => {
    if (!choices.loading) firstPageRetry.current = false;
  }, [choices.loading]);

  const handleReopen = useEffectEvent(() => {
    // Retry below the field closes the dropdown. Reuse its first-page read if it is still pending.
    if (firstPageRetry.current && choices.loading) return;
    choices.restart();
  });

  useEffect(() => {
    if (readAgainOnOpen !== true) return;
    const trigger = select.current?.querySelector('button[aria-haspopup="dialog"]');
    if (!trigger) return;

    // Select requests its first page on the initial opening. Its trigger exposes later openings.
    let opened = false;
    const observer = new MutationObserver(() => {
      if (trigger.getAttribute('aria-expanded') !== 'true') return;
      if (opened) handleReopen();
      opened = true;
    });
    observer.observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] });
    return () => observer.disconnect();
  }, [readAgainOnOpen]);

  const handleRetry = () => {
    firstPageRetry.current = choices.choices === undefined;
    choices.retry();
  };

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
      <div ref={select}>
        <Select
          ref={selectRef}
          {...field}
          {...optional({ placeholder, invalid, ariaLabel, triggerVariant })}
          options={options}
          selectedOption={selected}
          dropdownRole="dialog"
          onChange={handleChange}
        />
      </div>
      {choices.failure !== undefined && (
        <RequestReadFailure failure={choices.failure} connection={connection} thing={things} onRetry={handleRetry} />
      )}
    </SpaceBetween>
  );
}
