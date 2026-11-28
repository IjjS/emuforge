import Box from '@cloudscape-design/components/box';
import Multiselect, { type MultiselectProps } from '@cloudscape-design/components/multiselect';
import type { Ref } from 'react';

import { FixedChoiceDescription, optional, useChoiceField, type ChoiceFieldProps } from './choice-select';
import { identityOption } from './name-identity';

// A form's field of several choices, read a page at a time (issue 553, design "What is shared"): a Cloudscape
// `Multiselect` over the same hook and states as `choice-select.tsx`. Each choice made is shown as a token that can
// be removed, and stays chosen whatever the list then shows. It names no service.

export interface ChoiceMultiselectProps<T> extends ChoiceFieldProps<T> {
  /** The choices made, in the order they were made. */
  value: readonly T[];
  onChange: (choices: T[]) => void;
  multiselectRef?: Ref<MultiselectProps.Ref> | undefined;
}

/** A field of several choices of `source`, read a page at a time. */
export function ChoiceMultiselect<T>(props: ChoiceMultiselectProps<T>) {
  const { source, value, onChange, placeholder, invalid, ariaLabel, multiselectRef, lockedBy, held } = props;
  const { fieldRef, fixedOption, items, options, props: parts } = useChoiceField(props);
  const selectedFixedOption = value.length === 0 && lockedBy === undefined ? fixedOption : undefined;
  const selected =
    selectedFixedOption === undefined
      ? value.map((choice) => {
          const option = identityOption(source.optionOf(choice));
          return held === undefined ? option : { ...option, disabled: true };
        })
      : [{ ...optional({ value: selectedFixedOption.value, label: selectedFixedOption.label }), disabled: true }];

  return (
    <div ref={fieldRef}>
      <Multiselect
        ref={multiselectRef}
        {...parts}
        selectedOptions={selected}
        options={options}
        {...optional({
          placeholder: lockedBy === undefined ? placeholder : `Choose ${lockedBy} first`,
          invalid,
          ariaLabel,
        })}
        deselectAriaLabel={(option) => `Remove ${option.label ?? option.value ?? ''}`}
        onChange={({ detail }) => {
          if (held !== undefined) return;
          if (
            fixedOption !== undefined &&
            selectedFixedOption === undefined &&
            detail.selectedOptions.some((option) => option.value === fixedOption.value)
          ) {
            onChange([]);
            return;
          }
          const available = items.filter((choice) => source.optionOf(choice).disabled !== true);
          const known = [...value, ...available];
          const chosen = detail.selectedOptions.flatMap((option) => {
            const found = known.find((each) => source.optionOf(each).value === option.value);
            return found === undefined ? [] : [found];
          });
          onChange(chosen);
        }}
      />
      {selectedFixedOption?.description && (
        <Box padding={{ top: 'xxs' }}>
          <FixedChoiceDescription>{selectedFixedOption.description}</FixedChoiceDescription>
        </Box>
      )}
      {held !== undefined && (
        <Box color="text-status-inactive" padding={{ top: 'xxs' }} nativeAttributes={{ role: 'status' }}>
          {held}
        </Box>
      )}
    </div>
  );
}
