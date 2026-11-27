import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { DiscardDialog } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { FIXED_COMPARISONS } from '../alarm';
import { alarmDatapointCount, type AlarmEditValues } from '../alarm-edit';
import {
  ACTION_FIELDS,
  COUNT_RULE,
  DESCRIPTION_RULE,
  NAME_RULE,
  validateAlarmFields,
  validateAlarmRelationships,
  type ActionField,
  type AlarmFormErrors,
  type AlarmFormValues,
  type FormFieldName,
  type MissingData,
} from '../alarm-form';
import { comparisonText, periodText } from '../format';
import { dimensionSetKey } from '../metric-api';
import { ActionTopicsField } from './action-topics-field';
import { AlarmName } from './alarm-name';
import { MetricField } from './metric-field';
import { StatisticField } from './statistic-field';

const PERIODS = [10, 30, 60, 300, 900, 3600, 21600, 86400];

const COMPARISON_DESCRIPTIONS: Record<AlarmFormValues['comparison'], string> = {
  GreaterThanThreshold: 'In alarm when the value is above the threshold.',
  GreaterThanOrEqualToThreshold: 'In alarm when the value is at or above the threshold.',
  LessThanThreshold: 'In alarm when the value is below the threshold.',
  LessThanOrEqualToThreshold: 'In alarm when the value is at or below the threshold.',
};
const COMPARISONS = FIXED_COMPARISONS.map((value) => ({
  value,
  label: comparisonText(value),
  description: COMPARISON_DESCRIPTIONS[value],
}));

const MISSING_DATA: { value: MissingData; label: string; description: string }[] = [
  { value: 'missing', label: 'Missing', description: 'Missing data points are not counted either way.' },
  {
    value: 'notBreaching',
    label: 'Not breaching',
    description: 'Missing data points are counted as within the threshold.',
  },
  {
    value: 'breaching',
    label: 'Breaching',
    description: 'Missing data points are counted as breaching the threshold.',
  },
  { value: 'ignore', label: 'Ignore', description: 'Missing data points are skipped, the state is kept.' },
];

const ACTION_LABELS: Record<ActionField, string> = {
  alarmActions: 'In alarm',
  okActions: 'OK',
  insufficientDataActions: 'Insufficient data',
};

const FIELD_ORDER: readonly FormFieldName[] = [
  'name',
  'description',
  'namespace',
  'metricName',
  'dimensions',
  'statistic',
  'period',
  'comparison',
  'threshold',
  'datapointsToAlarm',
  'evaluationPeriods',
  ...ACTION_FIELDS,
];

function periodOption(seconds: number) {
  const label = periodText(seconds);
  return { value: String(seconds), label, description: `The statistic is calculated over each ${label}.` };
}

function differs(values: AlarmEditValues, initial: AlarmEditValues): boolean {
  return (Object.keys(initial) as (keyof AlarmFormValues)[]).some((field) => {
    if (field !== 'metric') return JSON.stringify(values[field]) !== JSON.stringify(initial[field]);
    const { namespace, name, dimensions } = values.metric;
    return (
      namespace !== initial.metric.namespace ||
      name !== initial.metric.name ||
      (dimensions === undefined ? undefined : dimensionSetKey(dimensions)) !==
        (initial.metric.dimensions === undefined ? undefined : dimensionSetKey(initial.metric.dimensions))
    );
  });
}

export interface AlarmFormProps<Values extends AlarmEditValues = AlarmFormValues> {
  mode: 'create' | 'edit';
  connection: AreaConnection;
  /** Current entries and the baseline used by Cancel. Key the form by alarm when switching resources. */
  values: Values;
  initialValues: Values;
  onChange: (values: Values) => void;
  onSubmit: (values: Values) => void | Promise<void>;
  onCancel: () => void;
  pending?: boolean;
  failure?: RequestFailure | undefined;
  fieldErrors?: (Omit<AlarmFormErrors, 'name'> & { name?: ReactNode }) | undefined;
  feedback?: ReactNode;
  metricKey?: string;
}

export function AlarmForm<Values extends AlarmEditValues>({
  mode,
  connection,
  values,
  initialValues,
  onChange,
  onSubmit,
  onCancel,
  pending = false,
  failure,
  fieldErrors,
  feedback,
  metricKey,
}: AlarmFormProps<Values>) {
  const openingKey = useId();
  const [tried, setTried] = useState(false);
  const [rejectedNamePaste, setRejectedNamePaste] = useState(false);
  const [asking, setAsking] = useState(false);
  const [kept, setKept] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const entriesLocked = pending || submitting;
  const controls = useRef<Partial<Record<FormFieldName, { focus: () => void } | null>>>({});
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);

  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);
  useEffect(() => {
    if (kept) cancelRef.current?.focus();
  }, [kept]);
  useEffect(() => {
    const first = FIELD_ORDER.find((field) => fieldErrors?.[field] !== undefined);
    if (first) controls.current[first]?.focus();
  }, [fieldErrors]);

  function register(field: FormFieldName, control: { focus: () => void } | null) {
    controls.current[field] = control;
  }

  const datapointsAreImplicit = values.datapointsToAlarm === undefined;
  const datapointsToAlarm = alarmDatapointCount(values);

  function validate(): AlarmFormErrors {
    const entries = { ...values, datapointsToAlarm };
    const errors = validateAlarmFields(entries, mode);
    if (datapointsAreImplicit) delete errors.datapointsToAlarm;
    return {
      ...(mode === 'create' ? validateAlarmRelationships(entries) : {}),
      ...errors,
      ...(rejectedNamePaste ? { name: NAME_RULE } : {}),
    };
  }

  function change<K extends keyof AlarmFormValues>(field: K, value: AlarmFormValues[K]) {
    if (!pending && !busy.current) onChange({ ...values, [field]: value });
  }

  function handleNamePaste(event: ClipboardEvent<HTMLInputElement>) {
    // The single-line input strips these characters before reporting its new value.
    if (/[\r\n]/.test(event.clipboardData.getData('text/plain'))) {
      event.preventDefault();
      setRejectedNamePaste(true);
    }
  }

  function blockEntryEdit(event: SyntheticEvent) {
    if (!pending && !busy.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  const writeUnavailable = failure?.kind === 'not-implemented' && failure.operation === 'PutMetricAlarm';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || busy.current || writeUnavailable) return;
    setTried(true);
    const invalid = validate();
    const first = FIELD_ORDER.find((field) => invalid[field] !== undefined);
    if (first) {
      controls.current[first]?.focus();
      return;
    }
    busy.current = true;
    setAsking(false);
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  const { name: nameError, ...otherFieldErrors } = fieldErrors ?? {};
  const errors = { ...(tried ? validate() : {}), ...otherFieldErrors };
  const periods = [...new Set([...PERIODS, initialValues.period, values.period])]
    .sort((a, b) => a - b)
    .map(periodOption);
  const submitLabel = mode === 'create' ? 'Create alarm' : 'Save changes';
  const failureItem = failure && actionFailureItem(failure, failure.operation, connection.engineOrigin);

  return (
    <>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        noValidate
      >
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                ref={cancelRef}
                disabled={entriesLocked}
                variant="link"
                formAction="none"
                onClick={() => {
                  if (pending || busy.current) return;
                  if (differs(values, initialValues)) setAsking(true);
                  else onCancel();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={entriesLocked}
                disabled={writeUnavailable}
                loadingText={mode === 'create' ? 'Creating alarm' : 'Saving changes'}
              >
                {submitLabel}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween
            size="l"
            nativeAttributes={{
              'aria-disabled': entriesLocked || undefined,
              onClickCapture: blockEntryEdit,
              onChangeCapture: blockEntryEdit,
              onBeforeInputCapture: blockEntryEdit,
              onPasteCapture: blockEntryEdit,
              onDropCapture: blockEntryEdit,
              onKeyDownCapture: (event) => {
                const copyOrSelect = (event.ctrlKey || event.metaKey) && /^[ac]$/i.test(event.key);
                if (event.key !== 'Tab' && event.key !== 'Escape' && !copyOrSelect) blockEntryEdit(event);
              },
            }}
          >
            <Container header={<Header variant="h2">Details</Header>}>
              <SpaceBetween size="m">
                {mode === 'create' ? (
                  <FormField
                    label="Name"
                    constraintText={NAME_RULE}
                    errorText={rejectedNamePaste ? NAME_RULE : (nameError ?? errors.name)}
                  >
                    <Input
                      ref={(control) => register('name', control)}
                      value={values.name}
                      readOnly={entriesLocked}
                      nativeInputAttributes={{ onPaste: handleNamePaste }}
                      onChange={({ detail }) => {
                        setRejectedNamePaste(false);
                        change('name', detail.value);
                      }}
                    />
                  </FormField>
                ) : (
                  <div>
                    <Box variant="awsui-key-label">Name</Box>
                    <AlarmName name={values.name} />
                  </div>
                )}
                <FormField label="Description" constraintText={DESCRIPTION_RULE} errorText={errors.description}>
                  <Textarea
                    ref={(control) => register('description', control)}
                    value={values.description}
                    readOnly={entriesLocked}
                    onChange={({ detail }) => change('description', detail.value)}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Metric</Header>}>
              <SpaceBetween size="m">
                <MetricField
                  key={metricKey}
                  connection={connection}
                  value={values.metric}
                  errors={errors}
                  register={register}
                  onChange={(metric) => change('metric', metric)}
                />
                <StatisticField
                  value={values.statistic}
                  error={errors.statistic}
                  inputRef={(control) => register('statistic', control)}
                  onChange={(statistic) => change('statistic', statistic)}
                />
                <FormField label="Period">
                  <Select
                    options={periods}
                    selectedOption={periodOption(values.period)}
                    onChange={({ detail }) => change('period', Number(detail.selectedOption.value))}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Condition</Header>}>
              <SpaceBetween size="m">
                <ColumnLayout columns={2}>
                  <FormField label="Comparison">
                    <Select
                      options={COMPARISONS}
                      selectedOption={COMPARISONS.find(({ value }) => value === values.comparison) ?? null}
                      onChange={({ detail }) => {
                        const comparison = FIXED_COMPARISONS.find((value) => value === detail.selectedOption.value);
                        if (comparison) change('comparison', comparison);
                      }}
                    />
                  </FormField>
                  <FormField label="Threshold" errorText={errors.threshold}>
                    <Input
                      ref={(control) => register('threshold', control)}
                      type="number"
                      step="any"
                      value={values.threshold}
                      readOnly={entriesLocked}
                      onChange={({ detail }) => change('threshold', detail.value)}
                    />
                  </FormField>
                </ColumnLayout>
                <Box>
                  Alarm when {datapointsToAlarm || '–'} out of {values.evaluationPeriods || '–'} periods meet the
                  condition.
                </Box>
                <ColumnLayout columns={2}>
                  <FormField
                    label="Data points to alarm"
                    constraintText={COUNT_RULE}
                    errorText={datapointsAreImplicit ? undefined : errors.datapointsToAlarm}
                  >
                    <Input
                      ref={(control) => register('datapointsToAlarm', control)}
                      type="number"
                      value={datapointsToAlarm}
                      readOnly={entriesLocked}
                      onChange={({ detail }) => change('datapointsToAlarm', detail.value)}
                    />
                  </FormField>
                  <FormField
                    label="Evaluation periods"
                    constraintText={COUNT_RULE}
                    errorText={errors.evaluationPeriods}
                  >
                    <Input
                      ref={(control) => register('evaluationPeriods', control)}
                      type="number"
                      value={values.evaluationPeriods}
                      readOnly={entriesLocked}
                      onChange={({ detail }) => change('evaluationPeriods', detail.value)}
                    />
                  </FormField>
                </ColumnLayout>
                <FormField label="Missing data treatment">
                  <Select
                    options={MISSING_DATA}
                    selectedOption={MISSING_DATA.find(({ value }) => value === values.missingData) ?? null}
                    onChange={({ detail }) => {
                      const missingData = MISSING_DATA.find(
                        ({ value }) => value === detail.selectedOption.value,
                      )?.value;
                      if (missingData) change('missingData', missingData);
                    }}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Actions</Header>}>
              <SpaceBetween size="m">
                <Checkbox
                  checked={values.actionsEnabled}
                  onChange={({ detail }) => change('actionsEnabled', detail.checked)}
                >
                  Enable actions
                </Checkbox>
                {ACTION_FIELDS.map((field) => (
                  <ActionTopicsField
                    key={field}
                    openingKey={openingKey}
                    baseline={mode === 'edit' ? initialValues[field] : undefined}
                    connection={connection}
                    label={ACTION_LABELS[field]}
                    value={values[field]}
                    onChange={(arns) => change(field, arns)}
                    error={errors[field]}
                    multiselectRef={(control) => register(field, control)}
                  />
                ))}
              </SpaceBetween>
            </Container>
            {failureItem && (
              <Alert ref={failureRef} type={failureItem.type === 'info' ? 'info' : 'error'} header={failureItem.header}>
                {failure &&
                  (failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') && (
                    <Box variant="p">{failure.operation}</Box>
                  )}
                {failureItem.content}
              </Alert>
            )}
            {feedback}
          </SpaceBetween>
        </Form>
      </form>
      <DiscardDialog
        visible={asking && !entriesLocked}
        onAnswer={(answer) => {
          setAsking(false);
          if (pending || busy.current) return;
          if (answer === 'discard') onCancel();
          else setKept((count) => count + 1);
        }}
      />
    </>
  );
}
