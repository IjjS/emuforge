import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import { useState, type ReactNode, type Ref } from 'react';

import type { RequestFailure } from '../../../../lib/aws/request';
import type { AreaConnection } from './emulator-line';
import { readFailureState } from './failure-states';
import { usePagedChoices, type ChoiceSource, type PagedChoices } from './use-paged-choices';

// A form's field of one choice, read a page at a time (issue 553, design "What is shared"): a Cloudscape `Select`
// over `use-paged-choices.ts`, given its words, its fixed first choice and its source by the form. The first page is
// read when the field first opens; "Load more" stands at the list's end while a token remains; a typed text, for a
// source that sends it, starts the choices again; a failed page says so with "Retry" and keeps the choices shown. A
// choice made stays shown as chosen whatever the list then shows. It names no service.

/** The option value of the fixed first choice; no source's value is empty. */
const FIXED = '';

/** What failed in a page of the choices, in the area's few words: the first line of its read failure state. */
function failureWords(failure: RequestFailure, connection: AreaConnection, things: string): string {
  if (failure.kind === 'other') {
    return failure.message === undefined ? failure.code : `${failure.code}: ${failure.message}`;
  }
  return readFailureState(failure, connection, things).firstText;
}

/** What both fields are given besides their value. */
export interface ChoiceFieldProps<T> {
  source: ChoiceSource<T>;
  connection: AreaConnection;
  /** The plural of what is chosen, as the states name it: "images" → "Loading images", "No images match". */
  things: string;
  placeholder?: string;
  /** The field is shown as failing a check. */
  invalid?: boolean;
  ariaLabel?: string;
}

/** What the two fields share of Cloudscape's props, from the choices read. */
interface FieldParts<T> {
  choices: PagedChoices<T>;
  items: T[];
  options: SelectProps.Option[];
  props: Pick<
    SelectProps,
    | 'statusType'
    | 'loadingText'
    | 'errorText'
    | 'recoveryText'
    | 'empty'
    | 'finishedText'
    | 'noMatch'
    | 'filteringType'
    | 'filteringPlaceholder'
    | 'filteringAriaLabel'
    | 'onLoadItems'
    | 'renderDropdownFooter'
  >;
}

/** The choices of `source` and the props a `Select` or `Multiselect` shows them with. */
// eslint-disable-next-line react-refresh/only-export-components -- the single and the multiple field are one part over one hook
export function useChoiceField<T>(
  { source, connection, things }: ChoiceFieldProps<T>,
  fixed: SelectProps.Option | undefined,
): FieldParts<T> {
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState('');
  const filtering = source.filtering ?? 'none';
  const choices = usePagedChoices(source, opened, text);
  const items = choices.choices ?? [];
  const options = [...(fixed === undefined ? [] : [fixed]), ...items.map(source.optionOf)];

  let statusType: NonNullable<SelectProps['statusType']> = 'finished';
  if (choices.failure !== undefined) {
    statusType = 'error';
  } else if (choices.loading || (opened && choices.choices === undefined)) {
    statusType = 'loading';
  }
  // A further page is read when the developer asks for it with "Load more" at the list's end, never by itself.
  const more = statusType === 'finished' && choices.more;
  const none = choices.text === '' ? `No ${things}` : `No ${things} match`;
  // With a fixed first choice the list is never empty, so the words that it holds nothing stand at its end.
  const finishedText: ReactNode =
    fixed !== undefined && choices.choices !== undefined && items.length === 0 ? none : undefined;

  return {
    choices,
    items,
    options,
    props: {
      statusType,
      loadingText: `Loading ${things}`,
      errorText:
        choices.failure === undefined
          ? ''
          : `The ${things} could not be loaded: ${failureWords(choices.failure, connection, things)}`,
      recoveryText: 'Retry',
      empty: none,
      finishedText,
      noMatch: `No ${things} match`,
      ...(filtering === 'none'
        ? {}
        : {
            filteringType: filtering === 'sent' ? ('manual' as const) : ('auto' as const),
            filteringPlaceholder: `Find ${things}`,
            filteringAriaLabel: `Find ${things}`,
          }),
      onLoadItems: ({ detail }) => {
        setOpened(true);
        if (detail.samePage) {
          // "Retry" asks again for the page that failed, the first or a further one.
          choices.retry();
        }
        if (filtering === 'sent') {
          setText(detail.filteringText);
        }
      },
      renderDropdownFooter: () =>
        more ? (
          <Box padding={{ vertical: 'xs', horizontal: 's' }}>
            <Button variant="inline-link" formAction="none" onClick={choices.loadMore}>
              Load more
            </Button>
          </Box>
        ) : null,
    },
  };
}

export interface ChoiceSelectProps<T> extends ChoiceFieldProps<T> {
  /** The choice made; `undefined` for none, or for the fixed first choice when there is one. */
  value: T | undefined;
  onChange: (choice: T | undefined) => void;
  /** The label of a fixed first choice ("No key pair"), offered above the others and the choice at start. */
  fixed?: string;
  selectRef?: Ref<SelectProps.Ref>;
}

/** A field of one choice of `source`, read a page at a time. */
export function ChoiceSelect<T>(props: ChoiceSelectProps<T>) {
  const { source, value, onChange, fixed, placeholder, invalid, ariaLabel, selectRef } = props;
  const fixedOption = fixed === undefined ? undefined : { value: FIXED, label: fixed };
  const { items, options, props: parts } = useChoiceField(props, fixedOption);

  let selected: SelectProps.Option | null = null;
  if (value !== undefined) {
    selected = source.optionOf(value);
  } else if (fixedOption !== undefined) {
    selected = fixedOption;
  }

  return (
    <Select
      ref={selectRef}
      {...parts}
      selectedOption={selected}
      options={options}
      placeholder={placeholder}
      invalid={invalid}
      ariaLabel={ariaLabel}
      dropdownRole="dialog"
      onChange={({ detail }) => {
        if (detail.selectedOption.value === FIXED && fixedOption !== undefined) {
          onChange(undefined);
          return;
        }
        const chosen = items.find((each) => source.optionOf(each).value === detail.selectedOption.value);
        if (chosen !== undefined) {
          onChange(chosen);
        }
      }}
    />
  );
}
