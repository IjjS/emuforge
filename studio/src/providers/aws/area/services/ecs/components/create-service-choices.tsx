import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Link from '@cloudscape-design/components/link';
import Multiselect, { type MultiselectProps } from '@cloudscape-design/components/multiselect';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { Ref } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { optional } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { Code, readFailureState } from '../../../components/failure-states';
import { useFollow } from '../../../components/use-follow';
import { usePagedChoices, type ChoiceSource, type PagedChoices } from '../../../components/use-paged-choices';

interface ChoiceProps<T> {
  source: ChoiceSource<T>;
  listing: PagedChoices<T>;
  connection: AreaConnection;
  label: string;
  placeholder: string;
  empty: React.ReactNode;
  error?: string | undefined;
  description?: string | undefined;
}

type SingleChoice<T> = {
  multiple?: false;
  value: T | undefined;
  inputRef?: Ref<SelectProps.Ref> | undefined;
  onChange: (value: T) => void;
};

type MultipleChoices<T> = {
  multiple: true;
  value: readonly T[];
  inputRef?: Ref<MultiselectProps.Ref> | undefined;
  onChange: (values: T[]) => void;
};

/** One pager supplies both the first answer used by the form and the subsequent dropdown pages. */
export function CreateServiceChoice<T>(props: ChoiceProps<T> & (SingleChoice<T> | MultipleChoices<T>)) {
  const { source, listing, label, placeholder, connection, empty, error, description } = props;
  const items = listing.choices ?? [];
  const blocked = listing.failure?.kind === 'not-implemented';
  const controls = {
    ...optional({ placeholder, invalid: error === undefined ? undefined : true }),
    disabled: blocked || source.ready === false,
    options: items.map(source.optionOf),
    statusType: listing.loading ? ('loading' as const) : ('finished' as const),
    loadingText: `Loading ${label.toLowerCase()}`,
    renderDropdownFooter: () =>
      listing.more && !listing.failure && !listing.loading ? (
        <Box padding={{ vertical: 'xs', horizontal: 's' }}>
          <Button variant="inline-link" formAction="none" onClick={listing.loadMore}>
            Load more
          </Button>
        </Box>
      ) : null,
  };
  const emptyNow = listing.choices !== undefined && items.length === 0 && !listing.more;

  return (
    <SpaceBetween size="xs">
      <FormField label={label} {...optional({ errorText: error, description })}>
        {props.multiple === true ? (
          <Multiselect
            {...controls}
            ref={props.inputRef}
            selectedOptions={props.value.map(source.optionOf)}
            deselectAriaLabel={(option) => `Remove ${option.label ?? option.value ?? ''}`}
            onChange={({ detail }) => {
              const known = [...props.value, ...items];
              props.onChange(
                detail.selectedOptions.flatMap((option) => {
                  const found = known.find((item) => source.optionOf(item).value === option.value);
                  return found === undefined ? [] : [found];
                }),
              );
            }}
          />
        ) : (
          <Select
            {...controls}
            ref={props.inputRef}
            dropdownRole="dialog"
            selectedOption={props.value === undefined ? null : source.optionOf(props.value)}
            onChange={({ detail }) => {
              const found = items.find((item) => source.optionOf(item).value === detail.selectedOption.value);
              if (found !== undefined) {
                props.onChange(found);
              }
            }}
          />
        )}
      </FormField>
      {listing.failure !== undefined ? (
        <ChoiceFailure failure={listing.failure} connection={connection} label={label} onRetry={listing.retry} />
      ) : (
        emptyNow && <Box>{empty}</Box>
      )}
    </SpaceBetween>
  );
}

function ChoiceFailure({
  failure,
  connection,
  label,
  onRetry,
}: {
  failure: RequestFailure;
  connection: AreaConnection;
  label: string;
  onRetry: () => void;
}) {
  const follow = useFollow();
  const status = readFailureState(failure, connection, label.toLowerCase());
  const diagnostic = readFailureState(failure, { ...connection, result: undefined }, label.toLowerCase());
  return (
    <SpaceBetween size="xxs">
      <StatusIndicator type={diagnostic.type}>{diagnostic.first}</StatusIndicator>
      {failure.kind === 'other' && (
        <Box>
          <Code>{failure.operation}</Code>
        </Box>
      )}
      {diagnostic.detail !== undefined && <Box>{diagnostic.detail}</Box>}
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
