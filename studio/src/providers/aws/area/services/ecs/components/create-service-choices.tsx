import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Link from '@cloudscape-design/components/link';
import Multiselect, { type MultiselectProps } from '@cloudscape-design/components/multiselect';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useId, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { optional } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { Code, readFailureState } from '../../../components/failure-states';
import { useFollow } from '../../../components/use-follow';
import { usePagedChoices, type ChoiceSource, type PagedChoices } from '../../../components/use-paged-choices';
import { revealBelowBreadcrumbs } from './reveal-below-breadcrumbs';

export interface CreateServiceChoiceRef {
  focus(reveal?: boolean): void;
}

interface ChoiceProps<T> {
  source: ChoiceSource<T>;
  focusRef?: Ref<CreateServiceChoiceRef>;
  listing: PagedChoices<T>;
  connection: AreaConnection;
  label: string;
  placeholder: string;
  empty: React.ReactNode;
  unavailable?: boolean;
  error?: string | undefined;
  description?: string | undefined;
}

type SingleChoice<T> = {
  multiple?: false;
  value: T | undefined;
  onChange: (value: T) => void;
};

type MultipleChoices<T> = {
  multiple: true;
  value: readonly T[];
  onChange: (values: T[]) => void;
};

/** One pager supplies both the first answer used by the form and the subsequent dropdown pages. */
export function CreateServiceChoice<T>(props: ChoiceProps<T> & (SingleChoice<T> | MultipleChoices<T>)) {
  const {
    source,
    listing,
    label,
    placeholder,
    connection,
    empty,
    error,
    description,
    unavailable = false,
    multiple,
    value,
    focusRef,
    onChange,
  } = props;
  const items = listing.choices ?? [];
  const blocked = listing.failure?.kind === 'not-implemented';
  const continuationBlocked = blocked && listing.choices !== undefined;
  const loadingContinuation = listing.loading && listing.choices !== undefined;
  const disabled = unavailable || blocked || source.ready === false;
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerHadFocus = useRef(false);
  const selectRef = useRef<SelectProps.Ref>(null);
  const multiRef = useRef<MultiselectProps.Ref>(null);
  const diagnosticRef = useRef<HTMLDivElement>(null);
  const diagnosticId = useId();
  useImperativeHandle(
    focusRef,
    () => ({
      focus(reveal) {
        if (disabled) {
          const diagnostic = diagnosticRef.current;
          diagnostic?.focus();
          if (reveal && diagnostic !== null) {
            revealBelowBreadcrumbs(diagnostic, 'if-covered');
          }
          return;
        }
        (multiple ? multiRef : selectRef).current?.focus();
        if (reveal) {
          const picker = pickerRef.current;
          const trigger = picker?.ownerDocument.activeElement;
          if (trigger instanceof HTMLElement && picker?.contains(trigger)) {
            revealBelowBreadcrumbs(trigger, 'if-covered');
          }
        }
      },
    }),
    [disabled, multiple],
  );
  useLayoutEffect(() => {
    const picker = pickerRef.current;
    if (picker === null || !loadingContinuation) {
      return;
    }
    const handleOutsidePointer = ({ target }: PointerEvent) => {
      if (target instanceof Node && !picker.contains(target)) {
        pickerHadFocus.current = false;
      }
    };
    const { ownerDocument } = picker;
    ownerDocument.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => ownerDocument.removeEventListener('pointerdown', handleOutsidePointer, true);
  }, [loadingContinuation]);

  useLayoutEffect(() => {
    const diagnostic = diagnosticRef.current;
    if (!continuationBlocked || !pickerHadFocus.current || diagnostic === null) {
      return;
    }
    const { activeElement, body } = diagnostic.ownerDocument;
    if (activeElement === body || pickerRef.current?.contains(activeElement)) {
      diagnostic.focus();
      revealBelowBreadcrumbs(diagnostic, 'if-covered');
    }
  }, [continuationBlocked]);

  const controls = {
    ...optional({ placeholder, invalid: error === undefined ? undefined : true }),
    disabled,
    options: disabled ? [] : items.map(source.optionOf),
    statusType: listing.loading ? ('loading' as const) : ('finished' as const),
    loadingText: `Loading ${label.toLowerCase()}`,
    renderDropdownFooter: () =>
      !disabled && listing.more && !listing.failure ? (
        <Box padding={{ vertical: 'xs', horizontal: 's' }}>
          <Button
            variant="inline-link"
            formAction="none"
            loading={listing.loading}
            loadingText={`Loading more ${choiceNoun(label)}`}
            onClick={listing.loadMore}
          >
            Load more
          </Button>
        </Box>
      ) : null,
  };
  const emptyNow = listing.choices !== undefined && items.length === 0 && !listing.more;

  return (
    <SpaceBetween size="xs">
      <div
        ref={pickerRef}
        onFocus={() => {
          pickerHadFocus.current = true;
        }}
        onBlur={({ currentTarget, relatedTarget }) => {
          // Removing a focused option can blur to the body without moving focus to another control.
          if (relatedTarget !== null && !currentTarget.contains(relatedTarget)) {
            pickerHadFocus.current = false;
          }
        }}
      >
        <FormField label={label} {...optional({ errorText: error, description: unavailable ? empty : description })}>
          {multiple === true ? (
            <Multiselect
              key={disabled ? 'unavailable' : 'available'}
              {...controls}
              ref={multiRef}
              selectedOptions={value.map(source.optionOf)}
              deselectAriaLabel={(option) => `Remove ${option.label ?? option.value ?? ''}`}
              onChange={({ detail }) => {
                if (disabled) return;
                const known = [...value, ...items];
                onChange(
                  detail.selectedOptions.flatMap((option) => {
                    const found = known.find((item) => source.optionOf(item).value === option.value);
                    return found === undefined ? [] : [found];
                  }),
                );
              }}
            />
          ) : (
            <Select
              key={disabled ? 'unavailable' : 'available'}
              {...controls}
              ref={selectRef}
              dropdownRole="dialog"
              selectedOption={value === undefined ? null : source.optionOf(value)}
              onChange={({ detail }) => {
                if (disabled) return;
                const found = items.find((item) => source.optionOf(item).value === detail.selectedOption.value);
                if (found !== undefined) {
                  onChange(found);
                }
              }}
            />
          )}
        </FormField>
      </div>
      {listing.failure !== undefined ? (
        <div
          ref={diagnosticRef}
          tabIndex={-1}
          role="group"
          aria-label={`${label} diagnostic`}
          aria-describedby={diagnosticId}
        >
          <div id={diagnosticId}>
            <ChoiceFailure
              failure={listing.failure}
              connection={connection}
              label={label}
              continuationBlocked={continuationBlocked}
              onRetry={listing.retry}
            />
          </div>
        </div>
      ) : (
        emptyNow && !unavailable && <Box>{empty}</Box>
      )}
    </SpaceBetween>
  );
}

function choiceNoun(label: string): string {
  if (label === 'Revision') return 'revisions';
  if (label === 'Task definition family') return 'task definition families';
  return label.toLowerCase();
}

function ChoiceFailure({
  failure,
  connection,
  label,
  continuationBlocked,
  onRetry,
}: {
  failure: RequestFailure;
  connection: AreaConnection;
  label: string;
  continuationBlocked: boolean;
  onRetry: () => void;
}) {
  const follow = useFollow();
  const status = readFailureState(failure, connection, label.toLowerCase());
  const diagnostic = readFailureState(failure, { ...connection, result: undefined }, label.toLowerCase());
  const detail = continuationBlocked
    ? `The emulator answered 501 Not Implemented for ${failure.operation}. Studio cannot load more ${choiceNoun(label)}.`
    : diagnostic.detail;
  return (
    <SpaceBetween size="xxs">
      <StatusIndicator type={diagnostic.type}>{diagnostic.first}</StatusIndicator>
      {failure.kind === 'other' && (
        <Box>
          <Code>{failure.operation}</Code>
        </Box>
      )}
      {detail !== undefined && <Box>{detail}</Box>}
      {status.recovery && (
        <Link href="/" onFollow={follow}>
          Connection status
        </Link>
      )}
      {failure.kind !== 'not-implemented' && (
        <Button variant="inline-link" formAction="none" onClick={onRetry}>
          Retry
        </Button>
      )}
    </SpaceBetween>
  );
}

// These sources make their first page available before opening, including the eligible revision preset.
// eslint-disable-next-line react-refresh/only-export-components -- the field and its first-page reader use one pager
export function useCreateServiceChoices<T>(source: ChoiceSource<T>): PagedChoices<T> {
  return usePagedChoices(source, true, '');
}
