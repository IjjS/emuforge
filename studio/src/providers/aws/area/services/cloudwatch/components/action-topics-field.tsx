import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type Ref } from 'react';

import { ChoiceMultiselect } from '../../../components/choice-multiselect';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState } from '../../../components/failure-states';
import { failureOf, noEndpoint } from '../../../components/use-token-listing';
import { LIST_TOPICS, listTopicArns, listTopics } from '../topic-api';

interface ActionTopicsFieldProps {
  connection: AreaConnection;
  label: string;
  value: string[];
  onChange: (arns: string[]) => void;
  error?: string | undefined;
  multiselectRef?: Ref<MultiselectProps.Ref>;
  /** Shares the opening topic read across all three fields of one form. */
  openingKey?: string;
}

export function ActionTopicsField({
  connection,
  label,
  value,
  onChange,
  error,
  multiselectRef,
  openingKey,
}: ActionTopicsFieldProps) {
  const id = useId();
  const endpoint = connection.engineOrigin;
  const [hasOpeningActions] = useState(() => value.length !== 0);
  const opening = useQuery({
    queryKey: ['cloudwatch', LIST_TOPICS, 'opening', openingKey ?? id, endpoint],
    enabled: hasOpeningActions && endpoint !== undefined,
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : listTopicArns(endpoint, signal)),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const topics = opening.data;

  const openingFailure =
    opening.isError && hasOpeningActions
      ? readFailureState(failureOf(opening.error, LIST_TOPICS), connection, 'topic list')
      : undefined;

  return (
    <FormField label={label} errorText={error}>
      <ChoiceMultiselect
        connection={connection}
        things="topics"
        placeholder="Choose topics"
        {...(multiselectRef === undefined ? {} : { multiselectRef })}
        source={{
          key: ['cloudwatch', 'topic choices'],
          endpoint,
          operation: LIST_TOPICS,
          filtering: 'local',
          read: (origin, _text, token, signal) => listTopics(origin, token, signal),
          optionOf: (arn) => ({
            value: arn,
            label: arn.split(':').at(-1) || arn,
            description: arn,
            ...(topics && !topics.includes(arn) && value.includes(arn)
              ? { tags: ['Not a topic in the emulator'] }
              : {}),
          }),
        }}
        value={value}
        onChange={onChange}
      />
      {openingFailure && (
        <Alert
          type={openingFailure.type === 'info' ? 'info' : 'error'}
          header={openingFailure.first}
          action={
            <Button
              formAction="none"
              onClick={() => {
                void opening.refetch();
              }}
            >
              Retry
            </Button>
          }
        >
          {openingFailure.detail}
        </Alert>
      )}
    </FormField>
  );
}
