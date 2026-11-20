import Multiselect, { type MultiselectProps } from '@cloudscape-design/components/multiselect';
import type { Ref } from 'react';

import { useChoiceField, type ChoiceFieldProps } from './choice-select';

// A form's field of several choices, read a page at a time (issue 553, design "What is shared"): a Cloudscape
// `Multiselect` over the same hook and states as `choice-select.tsx`. Each choice made is shown as a token that can
// be removed, and stays chosen whatever the list then shows. It names no service.

export interface ChoiceMultiselectProps<T> extends ChoiceFieldProps<T> {
  /** The choices made, in the order they were made. */
  value: readonly T[];
  onChange: (choices: T[]) => void;
  multiselectRef?: Ref<MultiselectProps.Ref>;
}

/** A field of several choices of `source`, read a page at a time. */
export function ChoiceMultiselect<T>(props: ChoiceMultiselectProps<T>) {
  const { source, value, onChange, placeholder, invalid, ariaLabel, multiselectRef } = props;
  const { items, options, props: parts } = useChoiceField(props, undefined);

  return (
    <Multiselect
      ref={multiselectRef}
      {...parts}
      selectedOptions={value.map(source.optionOf)}
      options={options}
      placeholder={placeholder}
      invalid={invalid}
      ariaLabel={ariaLabel}
      deselectAriaLabel={(option) => `Remove ${option.label ?? option.value ?? ''}`}
      onChange={({ detail }) => {
        const known = [...value, ...items];
        const chosen = detail.selectedOptions.flatMap((option) => {
          const found = known.find((each) => source.optionOf(each).value === option.value);
          return found === undefined ? [] : [found];
        });
        onChange(chosen);
      }}
    />
  );
}
