import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { isEditableAlarm, type EditableAlarm } from '../alarm';
import { alarmDatapointCount, alarmEditValues, type AlarmEditValues, type EditField } from '../alarm-edit';
import type { AlarmFormErrors, AlarmFormValues, MetricEntry } from '../alarm-form';
import { useAlarm } from '../alarm-queries';
import { DESCRIBE_ALARMS } from '../alarms-api';
import { AlarmForm } from '../components/alarm-form';
import { AlarmName } from '../components/alarm-name';
import { editAlarm } from '../edit-api';
import { actionsEnabledText, comparisonText, periodText, statisticText } from '../format';
import { dimensionSetKey } from '../metric-api';
import { alarmNameFromSearch, alarmPath, ALARMS_PATH } from '../paths';

const NOT_EDITABLE = 'Studio cannot edit this alarm yet';
const REASON =
  "Studio edits a metric alarm that compares one metric's statistic with a fixed threshold. This alarm is not one of those.";

const FIELD_LABELS: Record<EditField, string> = {
  description: 'Description',
  metric: 'Metric',
  statistic: 'Statistic',
  period: 'Period',
  comparison: 'Comparison',
  threshold: 'Threshold',
  evaluationPeriods: 'Evaluation periods',
  datapointsToAlarm: 'Data points to alarm',
  missingData: 'Missing data treatment',
  actionsEnabled: 'Enable actions',
  alarmActions: 'In alarm',
  okActions: 'OK',
  insufficientDataActions: 'Insufficient data',
};

const MISSING_DATA_TEXT: Record<AlarmFormValues['missingData'], string> = {
  missing: 'Missing',
  notBreaching: 'Not breaching',
  breaching: 'Breaching',
  ignore: 'Ignore',
};

function conflictValue(field: EditField, values: AlarmEditValues) {
  switch (field) {
    case 'metric': {
      const { namespace, name, dimensions } = values.metric;
      const pairs = dimensions?.map(({ Name, Value }) => `${Name} = ${Value}`).join(', ');
      return <AlarmName name={`${namespace} / ${name} (${pairs || 'No dimensions'})`} />;
    }
    case 'statistic':
      return values.statistic.kind === 'Other' ? values.statistic.text : statisticText(values.statistic.kind);
    case 'period':
      return periodText(values.period);
    case 'comparison':
      return comparisonText(values.comparison);
    case 'missingData':
      return MISSING_DATA_TEXT[values.missingData];
    case 'actionsEnabled':
      return actionsEnabledText(values.actionsEnabled);
    case 'alarmActions':
    case 'okActions':
    case 'insufficientDataActions':
      return values[field].length ? <ValueText kind="address" value={values[field].join(', ')} /> : 'No actions';
    case 'datapointsToAlarm':
      return alarmDatapointCount(values);
    case 'description':
      return values.description ? <AlarmName name={values.description} /> : 'Empty';
    default:
      return values[field];
  }
}

function metricKey({ namespace, name, dimensions }: MetricEntry) {
  return JSON.stringify([namespace, name, dimensions && dimensionSetKey(dimensions)]);
}

export function EditAlarmPage({ connection }: ScreenPageProps) {
  useShowsResources('alarms');
  const { search } = useLocation();
  const name = alarmNameFromSearch(search);
  return <EditAlarm key={name} name={name} connection={connection} />;
}

function EditAlarm({ name, connection }: { name: string | undefined; connection: AreaConnection }) {
  const follow = useFollow();
  const read = useAlarm(connection.engineOrigin, name);
  const failure = read.failure && readFailureState(read.failure, connection, 'alarm');
  const alarm = read.value;
  const editable = alarm !== undefined && isEditableAlarm(alarm);
  const backToAlarm = alarm !== undefined && name !== undefined;

  return (
    <ContentLayout header={<Header variant="h1">Edit alarm</Header>}>
      {editable && name !== undefined ? (
        <EditForm alarm={alarm} name={name} connection={connection} />
      ) : (
        <Container>
          {failure ? (
            <ReadFailure state={failure} onRetry={() => void read.refresh()} />
          ) : read.loading ? (
            <StatusIndicator type="loading">Loading alarm</StatusIndicator>
          ) : (
            <SpaceBetween size="s">
              <Box variant="h2">{alarm === undefined ? 'Alarm not found' : NOT_EDITABLE}</Box>
              {alarm !== undefined && <Box variant="p">{REASON}</Box>}
              <Link href={backToAlarm ? alarmPath(name) : ALARMS_PATH} onFollow={follow}>
                {backToAlarm ? 'Back to alarm' : 'Alarms'}
              </Link>
            </SpaceBetween>
          )}
        </Container>
      )}
    </ContentLayout>
  );
}

function EditForm({ alarm, name, connection }: { alarm: EditableAlarm; name: string; connection: AreaConnection }) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const [baseline, setBaseline] = useState(alarm);
  const [values, setValues] = useState(() => alarmEditValues(name, alarm));
  const [failure, setFailure] = useState<RequestFailure>();
  const [fieldErrors, setFieldErrors] = useState<AlarmFormErrors>();
  const [feedback, setFeedback] = useState<ReactNode>();
  const [openingMetricKey, setOpeningMetricKey] = useState(() => metricKey(values.metric));
  const initialValues = alarmEditValues(name, baseline);
  const conflictRef = useRef<AlertProps.Ref>(null);

  useEffect(() => {
    if (feedback) conflictRef.current?.focus();
  }, [feedback]);

  function handleChange(entries: AlarmEditValues) {
    const restoresImplicitCondition =
      initialValues.datapointsToAlarm === undefined &&
      entries.evaluationPeriods === initialValues.evaluationPeriods &&
      entries.datapointsToAlarm === initialValues.evaluationPeriods;
    setValues(restoresImplicitCondition ? { ...entries, datapointsToAlarm: undefined } : entries);
  }

  async function handleSubmit(submitted: AlarmEditValues) {
    setFailure(undefined);
    setFieldErrors(undefined);
    setFeedback(undefined);
    const endpoint = connection.engineOrigin;
    if (endpoint === undefined) {
      setFailure({ kind: 'engine-did-not-answer', operation: DESCRIBE_ALARMS });
      return;
    }

    const signal = pageSignal();
    try {
      const result = await editAlarm(endpoint, name, baseline, submitted, signal);
      if (signal.aborted) return;
      if ((result.kind === 'conflict' || result.kind === 'invalid') && result.values.metric !== submitted.metric) {
        setOpeningMetricKey(metricKey(result.values.metric));
      }
      switch (result.kind) {
        case 'gone':
          setFeedback(<Alert type="error" header="Alarm not found" />);
          break;
        case 'not-editable':
          setFeedback(
            <Alert type="error" header={NOT_EDITABLE}>
              {REASON}
            </Alert>,
          );
          break;
        case 'conflict': {
          const now = alarmEditValues(name, result.baseline);
          setBaseline(result.baseline);
          setValues(result.values);
          setFeedback(
            <Alert ref={conflictRef} type="warning" header="This alarm changed while you were editing it">
              <Box variant="p">
                Nothing was saved. Save changes again to apply your form entries over the conflicting values shown
                below.
              </Box>
              <ul>
                {result.fields.map((field) => (
                  <li key={field}>
                    {FIELD_LABELS[field]} (now {conflictValue(field, now)})
                  </li>
                ))}
              </ul>
            </Alert>,
          );
          break;
        }
        case 'invalid': {
          const now = alarmEditValues(name, result.baseline);
          const errors = { ...result.errors };
          if (errors.datapointsToAlarm) {
            errors.datapointsToAlarm += ` Evaluation periods now ${now.evaluationPeriods}.`;
          }
          if (errors.evaluationPeriods) {
            errors.evaluationPeriods += ` Evaluation periods now ${now.evaluationPeriods}, period now ${periodText(now.period)}.`;
          }
          setBaseline(result.baseline);
          setValues(result.values);
          setFieldErrors(errors);
          break;
        }
        case 'saved':
          flash.handOver(alarmPath(name), [
            {
              type: 'success',
              content: (
                <>
                  Alarm <AlarmName name={name} /> saved.
                </>
              ),
            },
          ]);
      }
    } catch (error) {
      if (!signal.aborted) setFailure(failureOf(error, DESCRIBE_ALARMS));
    }
  }

  return (
    <SpaceBetween size="l">
      <Box variant="p">Saving replaces the alarm's settings. Its tags stay as they are.</Box>
      <AlarmForm
        mode="edit"
        connection={connection}
        initialValues={initialValues}
        values={values}
        failure={failure}
        fieldErrors={fieldErrors}
        feedback={feedback}
        metricKey={openingMetricKey}
        onChange={handleChange}
        onSubmit={handleSubmit}
        onCancel={() => void navigate(alarmPath(name))}
      />
    </SpaceBetween>
  );
}
