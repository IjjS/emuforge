import type { EventBus } from '@aws-sdk/client-eventbridge';
import FormField from '@cloudscape-design/components/form-field';

import { ChoiceSelect } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure } from '../../../components/failure-states';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import { BUS_OPERATIONS, listEventBuses } from '../bus-api';
import type { BusChoice } from '../use-bus-choice';

interface BusSelectProps {
  connection: AreaConnection;
  choice: BusChoice;
  onChange: (name: string) => void;
}

export function BusSelect({ connection, choice, onChange }: BusSelectProps) {
  const source: ChoiceSource<EventBus & { Name: string }> = {
    key: ['events', 'bus-choices'],
    endpoint: connection.engineOrigin,
    operation: BUS_OPERATIONS.listEventBuses,
    filtering: 'sent',
    read: async (endpoint, prefix, token, signal) => {
      const page = await listEventBuses(endpoint, prefix, token, signal);
      return {
        ...page,
        items: page.items.filter((bus): bus is EventBus & { Name: string } => Boolean(bus.Name)),
      };
    },
    optionOf: ({ Name, Description, Arn }) => {
      const description = Description || Arn;
      return { value: Name, label: Name, ...(description ? { description } : {}) };
    },
  };
  const invalid = choice.kind === 'invalid';
  const failure = choice.kind === 'failed' && readFailureState(choice.failure, connection, 'event bus');

  return (
    <FormField
      label="Event bus"
      errorText={invalid ? choice.message : undefined}
      secondaryControl={
        failure && choice.kind === 'failed' ? <ReadFailure state={failure} onRetry={choice.retry} /> : undefined
      }
    >
      <ChoiceSelect
        source={source}
        connection={connection}
        things="event buses"
        placeholder={
          invalid && choice.name !== ''
            ? choice.name
            : choice.kind === 'loading'
              ? 'Loading event bus'
              : 'Choose an event bus'
        }
        invalid={invalid}
        value={choice.kind === 'chosen' ? { Name: choice.name } : undefined}
        onChange={(bus) => {
          if (bus !== undefined) onChange(bus.Name);
        }}
      />
    </FormField>
  );
}
