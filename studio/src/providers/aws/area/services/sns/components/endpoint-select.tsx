import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Link from '@cloudscape-design/components/link';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactNode, type Ref } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState } from '../../../components/failure-states';
import { CREATE_FUNCTION_PATH, CREATE_QUEUE_PATH } from '../../../components/resource-paths';
import { useFollow } from '../../../components/use-follow';
import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { DeliveryProtocol, FunctionChoice, QueueChoice } from '../api';
import { useFunctionChoices, useQueueChoices, type Choices } from '../queries';

// S4's choice of the endpoint (issue 536, design task 2 step 2): the queues (`ListQueues`) or the functions
// (`ListFunctions`) the emulator holds, each by its name, read a page of 50 at a time by the API's own token, never all
// at once. A further page is added below the ones shown when "Load more" is pressed at the list's end, for as long as
// the last answer gave a token. For queues the typed text is sent as `QueueNamePrefix` and the choices
// start again from its first page; `ListFunctions` has no filter, so a function is found by paging.

/** The endpoint chosen: a queue by its URL, a function by its ARN. */
export type EndpointChoice = ({ protocol: 'sqs' } & QueueChoice) | ({ protocol: 'lambda' } & FunctionChoice);

/** The words of each protocol's field. */
interface Words {
  label: string;
  placeholder: string;
  loading: string;
  none: string;
  create: string;
  createPath: string;
  failed: string;
}

const WORDS: Record<DeliveryProtocol, Words> = {
  sqs: {
    label: 'Queue',
    placeholder: 'Choose a queue',
    loading: 'Loading queues',
    none: 'No queues',
    create: 'Create queue',
    createPath: CREATE_QUEUE_PATH,
    failed: 'The queues could not be loaded',
  },
  lambda: {
    label: 'Function',
    placeholder: 'Choose a function',
    loading: 'Loading functions',
    none: 'No functions',
    create: 'Create function',
    createPath: CREATE_FUNCTION_PATH,
    failed: 'The functions could not be loaded',
  },
};

/** The field's label for `protocol`: "Queue" or "Function". */
// eslint-disable-next-line react-refresh/only-export-components -- the page names the field by the same words
export function endpointLabel(protocol: DeliveryProtocol): string {
  return WORDS[protocol].label;
}

export interface EndpointSelectProps {
  /** The engine's address; nothing is read before it is known. */
  engineOrigin: string | undefined;
  connection: AreaConnection;
  protocol: DeliveryProtocol;
  value: EndpointChoice | undefined;
  onChange: (choice: EndpointChoice) => void;
  /** The field's message after a failed check or a failed read of the choice. */
  errorText?: ReactNode;
  /** The select, so the form can move focus to it. */
  selectRef?: Ref<SelectProps.Ref>;
}

/** What failed in a page of the choices, in the area's few words: the first line of its read failure state. */
function failureWords(failure: RequestFailure, connection: AreaConnection, thing: string): string {
  if (failure.kind === 'other') {
    return failure.message === undefined ? failure.code : `${failure.code}: ${failure.message}`;
  }
  return readFailureState(failure, connection, thing).firstText;
}

interface FieldProps<T> extends EndpointSelectProps {
  choices: Choices<T>;
  /** Each choice as an option, its value the key `chosen` is matched by. */
  optionOf: (choice: T) => SelectProps.Option;
  choiceOf: (choice: T) => EndpointChoice;
  /** The prefix the choices were read with (queues); `undefined` where there is no filter. */
  prefix?: string;
  onFilter?: (text: string) => void;
}

function EndpointField<T>({
  connection,
  protocol,
  value,
  onChange,
  errorText,
  selectRef,
  choices,
  optionOf,
  choiceOf,
  prefix,
  onFilter,
}: FieldProps<T>) {
  const handleFollow = useFollow();
  const words = WORDS[protocol];
  const items = choices.choices ?? [];
  const options = items.map(optionOf);

  let statusType: NonNullable<SelectProps['statusType']> = 'finished';
  if (choices.failure !== undefined) {
    statusType = 'error';
  } else if (choices.loading) {
    statusType = 'loading';
  }
  // A further page is read when the developer asks for it with "Load more" at the list's end, never by itself.
  const more = statusType === 'finished' && choices.more;
  const failed =
    choices.failure === undefined
      ? ''
      : `${words.failed}: ${failureWords(choices.failure, connection, protocol === 'sqs' ? 'queue list' : 'function list')}`;

  const empty =
    prefix !== undefined && prefix !== '' ? (
      'No queues match'
    ) : (
      <SpaceBetween size="xxs">
        <Box variant="span" color="inherit">
          {words.none}
        </Box>
        <Link href={words.createPath} onFollow={handleFollow}>
          {words.create}
        </Link>
      </SpaceBetween>
    );

  return (
    <FormField label={words.label} errorText={errorText}>
      <Select
        ref={selectRef}
        selectedOption={value === undefined ? null : { value: keyOf(value), label: value.name }}
        options={options}
        placeholder={words.placeholder}
        invalid={errorText !== undefined}
        {...(onFilter === undefined
          ? {}
          : {
              filteringType: 'manual' as const,
              filteringPlaceholder: 'Queue name prefix',
              filteringAriaLabel: 'Queue name prefix',
            })}
        onLoadItems={({ detail }) => {
          if (detail.samePage) {
            // "Retry" asks again for the page that failed, the first or a further one.
            choices.retry();
          }
          onFilter?.(detail.filteringText);
        }}
        statusType={statusType}
        loadingText={words.loading}
        errorText={failed}
        recoveryText="Retry"
        empty={empty}
        dropdownRole="dialog"
        renderDropdownFooter={() =>
          more ? (
            <Box padding={{ vertical: 'xs', horizontal: 's' }}>
              <Button variant="inline-link" formAction="none" onClick={choices.loadMore}>
                Load more
              </Button>
            </Box>
          ) : null
        }
        onChange={({ detail }) => {
          const chosen = items.find((each) => optionOf(each).value === detail.selectedOption.value);
          if (chosen !== undefined) {
            onChange(choiceOf(chosen));
          }
        }}
      />
    </FormField>
  );
}

/** The option value of a chosen endpoint: a queue's URL, a function's ARN. */
function keyOf(choice: EndpointChoice): string {
  return choice.protocol === 'sqs' ? choice.url : choice.arn;
}

function QueueSelect(props: EndpointSelectProps) {
  const [filter, setFilter] = useState('');
  const choices = useQueueChoices(props.engineOrigin, filter, true);
  return (
    <EndpointField<QueueChoice>
      {...props}
      choices={choices}
      optionOf={(queue) => ({ value: queue.url, label: queue.name })}
      choiceOf={(queue) => ({ protocol: 'sqs', ...queue })}
      prefix={choices.prefix}
      onFilter={setFilter}
    />
  );
}

function FunctionSelect(props: EndpointSelectProps) {
  const choices = useFunctionChoices(props.engineOrigin, true);
  return (
    <EndpointField<FunctionChoice>
      {...props}
      choices={choices}
      optionOf={(fn) => ({ value: fn.arn, label: fn.name })}
      choiceOf={(fn) => ({ protocol: 'lambda', ...fn })}
    />
  );
}

/**
 * The field "Queue" or "Function" of S4: a Cloudscape `Select` fed a page at a time. Each protocol has its own
 * listing, mounted while that protocol is chosen, so a change of protocol starts its choices from the first page.
 */
export function EndpointSelect(props: EndpointSelectProps) {
  return props.protocol === 'sqs' ? <QueueSelect key="sqs" {...props} /> : <FunctionSelect key="lambda" {...props} />;
}
