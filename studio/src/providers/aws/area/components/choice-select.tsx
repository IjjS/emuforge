import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import { useEffect, useEffectEvent, useRef, useState, type Ref, type RefObject } from 'react';

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

/**
 * What failed in a page of the choices, as one line (the select's error status takes a string): a 501 with the
 * operation's name, a refusal with the engine's reason, a code with its message, else the first line of the read
 * failure state.
 */
function failureWords(failure: RequestFailure, connection: AreaConnection, things: string): string {
  switch (failure.kind) {
    case 'other':
      return failure.message === undefined ? failure.code : `${failure.code}: ${failure.message}`;
    case 'not-implemented':
      return `Not implemented by the emulator. The emulator answered 501 Not Implemented for ${failure.operation}.`;
    case 'access-denied':
      return `Access denied. ${failure.operation} was refused: ${failure.message}`;
    default:
      break;
  }
  return readFailureState(failure, connection, things).firstText;
}

/** The props of `values` that are given, so an absent one is left out rather than passed as `undefined`. */
// eslint-disable-next-line react-refresh/only-export-components -- the single and the multiple field are one part over one hook
export function optional<T extends object>(values: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/** What both fields are given besides their value. */
export interface ChoiceFieldProps<T> {
  source: ChoiceSource<T>;
  connection: AreaConnection;
  /** The plural of what is chosen, as the states name it: "images" → "Loading images", "No images match". */
  things: string;
  placeholder?: string | undefined;
  /** The field is shown as failing a check. */
  invalid?: boolean | undefined;
  ariaLabel?: string | undefined;
  /** The label of a parent that must be chosen before the field can open. */
  lockedBy?: string | undefined;
  /** The words of an empty, unfiltered list. */
  none?: string | undefined;
  /** A status shown while the form checks which choices are valid. */
  held?: string | undefined;
  /** Runs on every opening, including the first. */
  onOpen?: (() => void) | undefined;
}

/** What the two fields share of Cloudscape's props, from the choices read. */
interface FieldParts<T> {
  choices: PagedChoices<T>;
  fieldRef: RefObject<HTMLDivElement | null>;
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
    | 'disabled'
  >;
}

/** The choices of `source` and the props a `Select` or `Multiselect` shows them with. */
// eslint-disable-next-line react-refresh/only-export-components -- the single and the multiple field are one part over one hook
export function useChoiceField<T>(
  { source, connection, things, lockedBy, none, held, onOpen }: ChoiceFieldProps<T>,
  fixed: SelectProps.Option | undefined,
): FieldParts<T> {
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState('');
  const fieldRef = useRef<HTMLDivElement>(null);
  const filtering = source.filtering ?? 'none';
  const choices = usePagedChoices(source, opened && lockedBy === undefined, text);

  const handleOpen = useEffectEvent((again: boolean) => {
    if (again && source.readAgainOnOpen === true) {
      setText('');
      choices.restart('');
    }
    onOpen?.();
  });

  useEffect(() => {
    const trigger = fieldRef.current?.querySelector('button[aria-haspopup][aria-expanded]');
    if (trigger === undefined || trigger === null) return;

    // Cloudscape only requests items when the filtering text changes. Its trigger reports every opening.
    let openedBefore = false;
    const observer = new MutationObserver((records) => {
      const finalValue = trigger.getAttribute('aria-expanded');
      for (const [index, record] of records.entries()) {
        const next = index + 1 < records.length ? records[index + 1]?.oldValue : finalValue;
        if (record.oldValue !== 'true' && next === 'true') {
          handleOpen(openedBefore);
          openedBefore = true;
        }
      }
    });
    observer.observe(trigger, { attributes: true, attributeOldValue: true, attributeFilter: ['aria-expanded'] });
    return () => observer.disconnect();
  }, []);
  const items = choices.choices ?? [];
  const available = [...(fixed === undefined ? [] : [fixed]), ...items.map(source.optionOf)];
  const options = held === undefined ? available : available.map((option) => ({ ...option, disabled: true }));

  let statusType: NonNullable<SelectProps['statusType']> = 'finished';
  if (choices.failure !== undefined) {
    statusType = 'error';
  } else if (choices.loading || (opened && choices.choices === undefined)) {
    statusType = 'loading';
  }
  // A further page is read when the developer asks for it with "Load more" at the list's end, never by itself.
  const more = statusType === 'finished' && choices.more;
  const empty = choices.text === '' ? (none ?? `No ${things}`) : `No ${things} match`;
  // With a fixed first choice the list is never empty, so the words that it holds nothing stand at its end.
  const finishedText = fixed !== undefined && choices.choices !== undefined && items.length === 0 ? empty : undefined;

  return {
    choices,
    fieldRef,
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
      empty,
      disabled: lockedBy !== undefined,
      ...(finishedText === undefined ? {} : { finishedText }),
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
  fixed?: string | undefined;
  /** The sentence shown with the fixed first choice. */
  fixedDescription?: string | undefined;
  selectRef?: Ref<SelectProps.Ref> | undefined;
  /**
   * What the closed field shows of the choice made: its label alone (`label`, the default), or its label with its
   * description and tags (`option`), for choices that differ only in a few characters of their label.
   */
  triggerVariant?: SelectProps.TriggerVariant | undefined;
}

/** A field of one choice of `source`, read a page at a time. */
export function ChoiceSelect<T>(props: ChoiceSelectProps<T>) {
  const {
    source,
    value,
    onChange,
    fixed,
    fixedDescription,
    placeholder,
    invalid,
    ariaLabel,
    selectRef,
    triggerVariant,
    lockedBy,
    held,
  } = props;
  const fixedOption =
    fixed === undefined ? undefined : { value: FIXED, label: fixed, ...optional({ description: fixedDescription }) };
  const { fieldRef, items, options, props: parts } = useChoiceField(props, fixedOption);
  const selected = value === undefined ? (fixedOption ?? null) : source.optionOf(value);
  const variant = value === undefined && fixedOption?.description !== undefined ? 'option' : triggerVariant;

  return (
    <div ref={fieldRef}>
      <Select
        ref={selectRef}
        {...parts}
        selectedOption={lockedBy === undefined ? selected : null}
        options={options}
        {...optional({
          placeholder: lockedBy === undefined ? placeholder : `Choose ${lockedBy} first`,
          invalid,
          ariaLabel,
          triggerVariant: variant,
        })}
        dropdownRole="dialog"
        onChange={({ detail }) => {
          const selectedValue = detail.selectedOption.value;
          if (!options.some((option) => option.value === selectedValue && option.disabled !== true)) return;
          if (selectedValue === FIXED && fixedOption !== undefined) {
            onChange(undefined);
            return;
          }
          const chosen = items.find((each) => source.optionOf(each).value === selectedValue);
          if (chosen !== undefined) onChange(chosen);
        }}
      />
      {held !== undefined && (
        <Box color="text-status-inactive" padding={{ top: 'xxs' }} nativeAttributes={{ role: 'status' }}>
          {held}
        </Box>
      )}
    </div>
  );
}
