import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Toggle from '@cloudscape-design/components/toggle';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { ChoiceSelect } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState } from '../../../components/failure-states';
import { failureOf, noEndpoint } from '../../../components/use-token-listing';
import { emptyMetric, METRIC_NAME_RULE, NAMESPACE_RULE, type AlarmFormErrors, type MetricEntry } from '../alarm-form';
import { dimensionSetKey, listDimensionSets, listMetricNames, listNamespaces, LIST_METRICS } from '../metric-api';

type MetricFieldName = 'namespace' | 'metricName' | 'dimensions';
type Focusable = { focus: () => void };

interface MetricFieldProps {
  connection: AreaConnection;
  value: MetricEntry;
  onChange: (metric: MetricEntry) => void;
  errors?: AlarmFormErrors;
  register?: (field: MetricFieldName, control: Focusable | null) => void;
}

export function MetricField({ connection, value, onChange, errors = {}, register }: MetricFieldProps) {
  const id = useId();
  const [opening] = useState(() => value);
  const [typedChoice, setTypedChoice] = useState<boolean>();
  const endpoint = connection.engineOrigin;
  const { namespace, name, dimensions } = value;
  const initialKey = opening.dimensions === undefined ? undefined : dimensionSetKey(opening.dimensions);
  const openingListing = useQuery({
    queryKey: ['cloudwatch', LIST_METRICS, 'opening', id, endpoint, opening.namespace, opening.name],
    enabled: endpoint !== undefined && Boolean(opening.namespace && opening.name) && initialKey !== undefined,
    queryFn: ({ signal }) =>
      endpoint === undefined ? noEndpoint() : listDimensionSets(endpoint, opening.namespace, opening.name, signal),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const missingFromListing = openingListing.data?.every((set) => dimensionSetKey(set) !== initialKey) ?? false;
  const typed = typedChoice ?? (openingListing.isError || missingFromListing);
  const source = { endpoint, operation: LIST_METRICS, readAgainOnOpen: true, filtering: 'local' as const };

  function changeTyped(update: Partial<MetricEntry>) {
    setTypedChoice(true);
    onChange({ ...value, ...update });
  }

  const openingFailure = openingListing.isError
    ? readFailureState(failureOf(openingListing.error, LIST_METRICS), connection, 'metric listing')
    : undefined;

  return (
    <SpaceBetween size="m">
      <Toggle
        checked={typed}
        onChange={({ detail }) => {
          setTypedChoice(detail.checked);
          onChange(detail.checked ? { ...value, dimensions: dimensions ?? [] } : emptyMetric());
        }}
        description="The emulator lists a metric once a data point was put. Turn this on to name one before that."
      >
        Enter a metric that has no data yet
      </Toggle>
      {openingFailure && (
        <Alert
          type={openingFailure.type === 'info' ? 'info' : 'error'}
          header={openingFailure.first}
          action={
            <Button
              formAction="none"
              onClick={() => {
                void openingListing.refetch();
              }}
            >
              Retry
            </Button>
          }
        >
          {openingFailure.detail}
        </Alert>
      )}
      <FormField label="Namespace" errorText={errors.namespace} constraintText={typed ? NAMESPACE_RULE : undefined}>
        {typed ? (
          <Input
            ref={(control) => register?.('namespace', control)}
            value={namespace}
            onChange={({ detail }) => changeTyped({ namespace: detail.value })}
          />
        ) : (
          <ChoiceSelect
            connection={connection}
            things="namespaces"
            placeholder="Choose a namespace"
            selectRef={(control) => register?.('namespace', control)}
            value={namespace ? { name: namespace } : undefined}
            source={{
              ...source,
              key: ['cloudwatch', 'namespaces'],
              read: async (origin, _text, _token, signal) => ({ items: await listNamespaces(origin, signal) }),
              optionOf: ({ name, metricCount }: { name: string; metricCount?: number }) => ({
                value: name,
                label: name,
                ...(metricCount === undefined
                  ? {}
                  : { description: `${metricCount} metric name${metricCount === 1 ? '' : 's'}` }),
              }),
            }}
            onChange={(option) => {
              if (option && option.name !== namespace) {
                setTypedChoice(false);
                onChange({ ...emptyMetric(), namespace: option.name });
              }
            }}
          />
        )}
      </FormField>
      <FormField
        label="Metric name"
        errorText={errors.metricName}
        constraintText={typed ? METRIC_NAME_RULE : undefined}
      >
        {typed ? (
          <Input
            ref={(control) => register?.('metricName', control)}
            value={name}
            onChange={({ detail }) => changeTyped({ name: detail.value })}
          />
        ) : namespace === '' ? (
          <Select disabled selectedOption={null} placeholder="Choose a namespace first" />
        ) : (
          <ChoiceSelect
            key={namespace}
            connection={connection}
            things="metric names"
            placeholder="Choose a metric name"
            selectRef={(control) => register?.('metricName', control)}
            value={name ? { name } : undefined}
            source={{
              ...source,
              key: ['cloudwatch', 'metric names', namespace],
              read: async (origin, _text, _token, signal) => ({
                items: await listMetricNames(origin, namespace, signal),
              }),
              optionOf: ({ name, dimensionSetCount }: { name: string; dimensionSetCount?: number }) => ({
                value: name,
                label: name,
                ...(dimensionSetCount === undefined
                  ? {}
                  : { description: `${dimensionSetCount} dimension set${dimensionSetCount === 1 ? '' : 's'} listed` }),
              }),
            }}
            onChange={(option) => {
              if (option && option.name !== name) {
                setTypedChoice(false);
                onChange({ namespace, name: option.name, dimensions: undefined });
              }
            }}
          />
        )}
      </FormField>
      <FormField label="Dimensions" errorText={errors.dimensions}>
        {typed ? (
          <AttributeEditor
            items={dimensions ?? []}
            addButtonText="Add dimension"
            removeButtonText="Remove"
            empty="No dimensions"
            ref={(control) => register?.('dimensions', control ? { focus: () => control.focusAddButton() } : null)}
            onAddButtonClick={() => changeTyped({ dimensions: [...(dimensions ?? []), { Name: '', Value: '' }] })}
            onRemoveButtonClick={({ detail }) =>
              changeTyped({ dimensions: dimensions?.filter((_, index) => index !== detail.itemIndex) })
            }
            definition={[
              {
                label: 'Dimension name',
                control: (item, index) => (
                  <Input
                    value={item.Name}
                    onChange={({ detail }) =>
                      changeTyped({
                        dimensions: dimensions?.map((row, i) => (i === index ? { ...row, Name: detail.value } : row)),
                      })
                    }
                  />
                ),
              },
              {
                label: 'Dimension value',
                control: (item, index) => (
                  <Input
                    value={item.Value}
                    onChange={({ detail }) =>
                      changeTyped({
                        dimensions: dimensions?.map((row, i) => (i === index ? { ...row, Value: detail.value } : row)),
                      })
                    }
                  />
                ),
              },
            ]}
          />
        ) : name === '' ? (
          <Select disabled selectedOption={null} placeholder="Choose a metric name first" />
        ) : (
          <ChoiceSelect
            key={JSON.stringify([namespace, name])}
            connection={connection}
            things="dimension sets"
            placeholder="Choose dimensions"
            selectRef={(control) => register?.('dimensions', control)}
            value={dimensions}
            source={{
              ...source,
              key: ['cloudwatch', 'dimensions', namespace, name],
              read: async (origin, _text, _token, signal) => ({
                items: await listDimensionSets(origin, namespace, name, signal),
              }),
              optionOf: (set) => ({
                value: dimensionSetKey(set),
                label: set.length ? set.map(({ Name, Value }) => `${Name} = ${Value}`).join(', ') : 'No dimensions',
                description: set.length
                  ? `${set.length} dimension${set.length === 1 ? '' : 's'}`
                  : 'The metric as listed without dimensions',
              }),
            }}
            onChange={(set) => {
              if (set !== undefined) {
                setTypedChoice(false);
                onChange({ namespace, name, dimensions: set });
              }
            }}
          />
        )}
      </FormField>
    </SpaceBetween>
  );
}
