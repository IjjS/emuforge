import createWrapper from '@cloudscape-design/components/test-utils/dom';
import FormFieldWrapper from '@cloudscape-design/components/test-utils/dom/form-field';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { emptyMetric, type MetricEntry } from '../alarm-form';
import { dimensionSetKey, listDimensionSets, listMetricNames, listNamespaces } from '../metric-api';
import { MetricField } from './metric-field';

vi.mock('../metric-api', { spy: true });

const endpoint = 'http://127.0.0.1:9682';
const connection = { engineOrigin: endpoint, result: undefined };
const host = [{ Name: 'Host', Value: 'a' }];
const PAGE = createWrapper(document.body);
let form: MetricEntry;

function Field({ initial }: { initial: MetricEntry }) {
  const [value, setValue] = useState(initial);
  return (
    <MetricField
      connection={connection}
      value={value}
      onChange={(metric) => {
        form = metric;
        setValue(metric);
      }}
    />
  );
}

function open(initial = emptyMetric()) {
  form = initial;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Field initial={initial} />
    </QueryClientProvider>,
  );
}

function field(label: string) {
  const found = PAGE.findAll(FormFieldWrapper.rootSelector)
    .map((node) => new FormFieldWrapper(node.getElement()))
    .find((wrapper) => wrapper.findLabel()?.getElement().textContent === label);
  if (!found) throw new Error(`No field named ${label}`);
  return found;
}

function select(label: string) {
  const found = field(label).findSelect();
  if (!found) throw new Error(`No select named ${label}`);
  return found;
}

async function checkOption(label: string, value: string, title?: string, description?: string) {
  await waitFor(() => {
    const option = select(label).findDropdown().findOptionByValue(value);
    expect(option).not.toBeNull();
    if (title) expect(option?.findLabel().getElement()).toHaveTextContent(title);
    if (description) expect(option?.findDescription()?.getElement()).toHaveTextContent(description);
  });
}

async function pick(label: string, value: string) {
  select(label).openDropdown();
  await checkOption(label, value);
  select(label).selectOptionByValue(value);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listNamespaces).mockResolvedValue([
    { name: 'App', metricCount: 2 },
    { name: 'Other', metricCount: 1 },
  ]);
  vi.mocked(listMetricNames).mockImplementation(async (_origin, namespace) =>
    namespace === 'App'
      ? [
          { name: 'Jobs', dimensionSetCount: 2 },
          { name: 'Load', dimensionSetCount: 1 },
        ]
      : [{ name: 'Queue', dimensionSetCount: 1 }],
  );
  vi.mocked(listDimensionSets).mockImplementation(async (_origin, _namespace, name) =>
    name === 'Jobs' ? [host, []] : [[]],
  );
});

it('loads dependent options with values and descriptions, including the empty dimension set', async () => {
  open();
  expect(listNamespaces).not.toHaveBeenCalled();
  select('Namespace').openDropdown();
  await checkOption('Namespace', 'App', 'App', '2 metric names');
  await checkOption('Namespace', 'Other', 'Other', '1 metric name');
  select('Namespace').selectOptionByValue('App');
  select('Metric name').openDropdown();
  await checkOption('Metric name', 'Jobs', 'Jobs', '2 dimension sets listed');
  await checkOption('Metric name', 'Load', 'Load', '1 dimension set listed');
  select('Metric name').selectOptionByValue('Jobs');
  select('Dimensions').openDropdown();
  await checkOption('Dimensions', dimensionSetKey(host), 'Host = a', '1 dimension');
  await checkOption('Dimensions', '[]', 'No dimensions', 'The metric as listed without dimensions');
  expect(listMetricNames).toHaveBeenCalledWith(endpoint, 'App', expect.any(AbortSignal));
  expect(listDimensionSets).toHaveBeenCalledWith(endpoint, 'App', 'Jobs', expect.any(AbortSignal));
  select('Dimensions').selectOptionByValue('[]');
  expect(form).toEqual({ namespace: 'App', name: 'Jobs', dimensions: [] });
});

it('clears dependent entries after choosing a different name or namespace', async () => {
  open();
  await pick('Namespace', 'App');
  await pick('Metric name', 'Jobs');
  await pick('Dimensions', dimensionSetKey(host));
  await pick('Metric name', 'Load');
  expect(form).toEqual({ namespace: 'App', name: 'Load', dimensions: undefined });
  expect(select('Dimensions').findTrigger().getElement()).toHaveTextContent('Choose dimensions');
  await pick('Namespace', 'Other');
  expect(form).toEqual({ namespace: 'Other', name: '', dimensions: undefined });
  expect(select('Metric name').findTrigger().getElement()).toHaveTextContent('Choose a metric name');
  expect(select('Dimensions').isDisabled()).toBe(true);
});

it('reuses the read while focused and starts another after returning focus', async () => {
  open();
  const namespace = select('Namespace');
  const trigger = namespace.findTrigger().getElement();
  act(() => trigger.focus());
  namespace.openDropdown();
  await checkOption('Namespace', 'App');
  namespace.closeDropdown();
  namespace.openDropdown();
  await checkOption('Namespace', 'App');
  expect(listNamespaces).toHaveBeenCalledTimes(1);
  namespace.closeDropdown();
  act(() => {
    trigger.blur();
    trigger.focus();
  });
  await waitFor(() => expect(listNamespaces).toHaveBeenCalledTimes(2));
});

it('switches to text with the chosen values and clears the choices when switched off', async () => {
  open();
  const toggle = PAGE.findToggle();
  expect(toggle?.findLabel().getElement()).toHaveTextContent('Enter a metric that has no data yet');
  expect(toggle?.findDescription()?.getElement()).toHaveTextContent(
    'The emulator lists a metric once a data point was put. Turn this on to name one before that.',
  );
  expect(toggle?.findNativeInput().getElement()).not.toBeChecked();
  await pick('Namespace', 'App');
  await pick('Metric name', 'Jobs');
  await pick('Dimensions', dimensionSetKey(host));
  toggle?.findNativeInput().click();
  expect(field('Namespace').findInput()?.getInputValue()).toBe('App');
  expect(field('Metric name').findInput()?.getInputValue()).toBe('Jobs');
  const row = PAGE.findAttributeEditor()?.findRow(1);
  expect(row?.findField(1)?.findInput()?.getInputValue()).toBe('Host');
  expect(row?.findField(2)?.findInput()?.getInputValue()).toBe('a');
  toggle?.findNativeInput().click();
  expect(form).toEqual(emptyMetric());
  expect(select('Namespace').findTrigger().getElement()).toHaveTextContent('Choose a namespace');
});

it('opens a listed metric in its choices with the original values', async () => {
  open({ namespace: 'App', name: 'Jobs', dimensions: host });
  await waitFor(() => expect(listDimensionSets).toHaveBeenCalledWith(endpoint, 'App', 'Jobs', expect.any(AbortSignal)));
  expect(select('Namespace').findTrigger().getElement()).toHaveTextContent('App');
  expect(select('Metric name').findTrigger().getElement()).toHaveTextContent('Jobs');
  expect(select('Dimensions').findTrigger().getElement()).toHaveTextContent('Host = a');
});

it('opens a metric absent from its listing in the text fields with the switch on', async () => {
  open({ namespace: 'App', name: 'Before-data', dimensions: host });
  await waitFor(() => expect(PAGE.findToggle()?.findNativeInput().getElement()).toBeChecked());
  expect(field('Namespace').findInput()?.getInputValue()).toBe('App');
  expect(field('Metric name').findInput()?.getInputValue()).toBe('Before-data');
});

it.each([
  { label: 'Namespace', read: listNamespaces, prepare: async () => {} },
  {
    label: 'Metric name',
    read: listMetricNames,
    prepare: async () => {
      await pick('Namespace', 'App');
    },
  },
  {
    label: 'Dimensions',
    read: listDimensionSets,
    prepare: async () => {
      await pick('Namespace', 'App');
      await pick('Metric name', 'Jobs');
    },
  },
])('shows read failures and Retry at $label', async ({ label, read, prepare }) => {
  vi.mocked(read)
    .mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'ListMetrics' }))
    .mockRejectedValueOnce(new RequestError({ kind: 'access-denied', operation: 'ListMetrics', message: 'denied' }));
  open();
  await prepare();
  select(label).openDropdown();
  await waitFor(() =>
    expect(select(label).findStatusIndicator()?.getElement()).toHaveTextContent('501 Not Implemented for ListMetrics'),
  );
  select(label).findErrorRecoveryButton()?.click();
  await waitFor(() =>
    expect(select(label).findStatusIndicator()?.getElement()).toHaveTextContent('ListMetrics was refused: denied'),
  );
});
