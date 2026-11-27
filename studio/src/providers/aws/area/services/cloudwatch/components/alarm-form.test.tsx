import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { NAME_RULE, newAlarmForm, type AlarmFormValues } from '../alarm-form';
import { AlarmForm, type AlarmFormProps } from './alarm-form';
import { AlarmName } from './alarm-name';

vi.mock('../metric-api', { spy: true });
import { listDimensionSets } from '../metric-api';

const PAGE = createWrapper(document.body);
const ready = (): AlarmFormValues => ({
  ...newAlarmForm(),
  name: ' alarm  name ',
  description: 'Old description',
  metric: { namespace: 'App', name: 'Jobs', dimensions: [] },
  threshold: '-3',
});

function open({ start = newAlarmForm(), ...props }: Partial<AlarmFormProps> & { start?: AlarmFormValues } = {}) {
  const submitted = vi.fn();
  const cancelled = vi.fn();
  vi.mocked(listDimensionSets).mockResolvedValue([[]]);
  function Field() {
    const [values, setValues] = useState(start);
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <AlarmForm
            mode="create"
            connection={{ engineOrigin: 'http://127.0.0.1:9682', result: undefined }}
            values={values}
            initialValues={start}
            onChange={setValues}
            onSubmit={submitted}
            onCancel={cancelled}
            {...props}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Field />
    </QueryClientProvider>,
  );
  return { submitted, cancelled };
}

function findField(label: string) {
  return PAGE.findAllFormFields().find((wrapper) => wrapper.findLabel()?.getElement().textContent === label);
}

function field(label: string) {
  const found = findField(label);
  if (!found) throw new Error(`No field named ${label}`);
  return found;
}

function control(label: string) {
  return createWrapper(field(label).getElement());
}

function button(label: string) {
  const found = PAGE.findAllButtons().find((wrapper) => wrapper.findTextRegion()?.getElement().textContent === label);
  if (!found) throw new Error(`No button named ${label}`);
  return found;
}

function expectOptions(label: string, expected: Record<string, [string, string]>) {
  const select = control(label).findSelect();
  select?.openDropdown();
  expect(select?.findDropdown().findOptions()).toHaveLength(Object.keys(expected).length);
  for (const [value, [title, description]] of Object.entries(expected)) {
    const option = select?.findDropdown().findOptionByValue(value);
    expect(option?.findLabel().getElement()).toHaveTextContent(title);
    expect(option?.findDescription()?.getElement()).toHaveTextContent(description);
  }
}

const periodOptions = Object.fromEntries(
  (
    [
      [10, '10 seconds'],
      [30, '30 seconds'],
      [60, '1 minute'],
      [300, '5 minutes'],
      [900, '15 minutes'],
      [3600, '1 hour'],
      [21600, '6 hours'],
      [86400, '1 day'],
    ] as const
  ).map(([value, title]): [number, [string, string]] => [
    value,
    [title, `The statistic is calculated over each ${title}.`],
  ]),
);

it('renders the create fields and the name rule before submit', () => {
  open();
  expect(control('Name').findInput()?.getInputValue()).toBe('');
  expect(field('Name').findConstraint()?.getElement()).toHaveTextContent(NAME_RULE);
  expect(control('Description').findTextarea()?.getTextareaValue()).toBe('');
  for (const label of [
    'Namespace',
    'Metric name',
    'Dimensions',
    'Statistic',
    'Period',
    'Comparison',
    'Missing data treatment',
  ]) {
    expect(control(label).findSelect()).not.toBeNull();
  }
  for (const label of ['Threshold', 'Data points to alarm', 'Evaluation periods'])
    expect(control(label).findInput()).not.toBeNull();
  expect(PAGE.findCheckbox()?.findNativeInput().getElement()).toBeChecked();
  for (const label of ['In alarm', 'OK', 'Insufficient data']) expect(control(label).findMultiselect()).not.toBeNull();
});

it('describes the eight periods and includes a stored period when editing', () => {
  const original = open();
  expectOptions('Period', periodOptions);
  expect(original.submitted).not.toHaveBeenCalled();
});

it('shows the edit name as text and describes the additional period', () => {
  const start = { ...ready(), period: 120 };
  const view = renderEdit(start);
  expect(findField('Name')).toBeUndefined();
  expect(view.container).toHaveTextContent(start.name, { normalizeWhitespace: false });
  expect(control('Period').findSelect()?.findTrigger().getElement()).toHaveTextContent('2 minutes');
  expectOptions('Period', { ...periodOptions, 120: ['2 minutes', 'The statistic is calculated over each 2 minutes.'] });
});

function renderEdit(start: AlarmFormValues) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AlarmForm
        mode="edit"
        connection={{ engineOrigin: undefined, result: undefined }}
        values={start}
        initialValues={start}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

it('describes all comparison options', () => {
  open();
  expectOptions('Comparison', {
    GreaterThanThreshold: ['Greater than', 'In alarm when the value is above the threshold.'],
    GreaterThanOrEqualToThreshold: [
      'Greater than or equal to',
      'In alarm when the value is at or above the threshold.',
    ],
    LessThanThreshold: ['Less than', 'In alarm when the value is below the threshold.'],
    LessThanOrEqualToThreshold: ['Less than or equal to', 'In alarm when the value is at or below the threshold.'],
  });
});

it('describes the four treatments of missing data', () => {
  open();
  expectOptions('Missing data treatment', {
    missing: ['Missing', 'Missing data points are not counted either way.'],
    notBreaching: ['Not breaching', 'Missing data points are counted as within the threshold.'],
    breaching: ['Breaching', 'Missing data points are counted as breaching the threshold.'],
    ignore: ['Ignore', 'Missing data points are skipped, the state is kept.'],
  });
});

it.each(['create', 'edit'] as const)(
  'checks joined rules at submit for %s according to which page saves',
  async (mode) => {
    const start = { ...ready(), datapointsToAlarm: '2' };
    const { submitted } = open({ mode, start });
    await act(async () => button(mode === 'create' ? 'Create alarm' : 'Save changes').click());
    if (mode === 'create') {
      expect(field('Data points to alarm').findError()?.getElement()).toHaveTextContent(
        'Data points to alarm cannot exceed the evaluation periods.',
      );
      expect(submitted).not.toHaveBeenCalled();
    } else {
      expect(field('Data points to alarm').findError()).toBeNull();
      expect(submitted).toHaveBeenCalledExactlyOnceWith(start);
    }
  },
);

it('preserves the alarm name white space in an external Name error', () => {
  const start = ready();
  open({
    start,
    fieldErrors: {
      name: (
        <>
          An alarm named <AlarmName name={start.name} /> already exists.
        </>
      ),
    },
  });

  const name = field('Name');
  const error = name.findError();
  expect(error?.getElement().textContent).toBe(`An alarm named ${start.name} already exists.`);
  expect(error?.find('span[style*="white-space"]')?.getElement()).toHaveStyle({ whiteSpace: 'pre-wrap' });
  expect(name.findConstraint()?.getElement().textContent).toBe(NAME_RULE);
  expect(control('Name').findInput()?.findNativeInput().getElement()).toHaveFocus();
});

it('shows every invalid field and focuses the first, then reports the complete valid form once', async () => {
  const { submitted } = open();
  button('Create alarm').click();
  expect(control('Name').findInput()?.findNativeInput().getElement()).toHaveFocus();
  expect(field('Name').findError()?.getElement().textContent).toBe(NAME_RULE);
  for (const label of ['Name', 'Namespace', 'Metric name', 'Dimensions', 'Threshold']) {
    expect(field(label).findError()?.getElement()).not.toHaveTextContent(/^$/);
  }
  expect(submitted).not.toHaveBeenCalled();
  control('Name').findInput()?.setInputValue('queue alarm');
  PAGE.findToggle()?.findNativeInput().click();
  control('Namespace').findInput()?.setInputValue('App');
  control('Metric name').findInput()?.setInputValue('Jobs');
  control('Threshold').findInput()?.setInputValue('0.25');
  await act(async () => button('Create alarm').click());
  expect(submitted).toHaveBeenCalledExactlyOnceWith({
    ...newAlarmForm(),
    name: 'queue alarm',
    metric: { namespace: 'App', name: 'Jobs', dimensions: [] },
    threshold: '0.25',
  });
});

it('shows the operation and refusal, keeps the entries, and blocks a second submission while busy', async () => {
  let complete: () => void = () => {};
  const submit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  open({
    start: ready(),
    onSubmit: submit,
    failure: {
      kind: 'other',
      operation: 'PutMetricAlarm',
      code: 'InvalidParameterValue',
      message: 'Unsupported statistic',
    },
  });
  expect(PAGE.findAlert()?.findHeader()?.getElement()).toHaveTextContent('PutMetricAlarm failed');
  expect(PAGE.findAlert()?.findContent().getElement()).toHaveTextContent(
    'InvalidParameterValue: Unsupported statistic',
  );
  expect(control('Description').findTextarea()?.getTextareaValue()).toBe('Old description');
  const submitButton = button('Create alarm');
  submitButton.click();
  expect(submitButton.findLoadingIndicator()).not.toBeNull();
  submitButton.click();
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => complete());
});

it('cancels immediately for unchanged entries or an entry typed and cleared again', () => {
  const { cancelled } = open();
  button('Cancel').click();
  control('Name').findInput()?.setInputValue('temporary');
  control('Name').findInput()?.setInputValue('');
  button('Cancel').click();
  expect(PAGE.findModal()).toBeNull();
  expect(cancelled).toHaveBeenCalledTimes(2);
});

it('confirms a changed form, keeps the entries on Keep editing, and reports Discard', async () => {
  const { cancelled } = open();
  control('Name').findInput()?.setInputValue('keep me');
  button('Cancel').click();
  await waitFor(() =>
    expect(PAGE.findModal()?.findHeader().getElement()).toHaveTextContent('Discard what you entered?'),
  );
  expect(cancelled).not.toHaveBeenCalled();
  button('Keep editing').click();
  expect(PAGE.findModal()).toBeNull();
  expect(control('Name').findInput()?.getInputValue()).toBe('keep me');
  button('Cancel').click();
  await waitFor(() => expect(PAGE.findModal()?.isVisible()).toBe(true));
  button('Discard').click();
  expect(cancelled).toHaveBeenCalledTimes(1);
});
