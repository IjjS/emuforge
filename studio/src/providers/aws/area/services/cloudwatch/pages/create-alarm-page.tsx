import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { alarmFormInput, newAlarmForm, type AlarmFormValues } from '../alarm-form';
import { DESCRIBE_ALARMS } from '../alarms-api';
import { AlarmForm } from '../components/alarm-form';
import { AlarmName } from '../components/alarm-name';
import { createAlarm } from '../create-api';
import { ALARMS_PATH, alarmPath } from '../paths';

export function CreateAlarmPage({ connection }: ScreenPageProps) {
  useShowsResources('alarms');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const [initialValues] = useState(newAlarmForm);
  const [values, setValues] = useState(initialValues);
  const [failure, setFailure] = useState<RequestFailure>();
  const [existingName, setExistingName] = useState<string>();
  const fieldErrors = useMemo(
    () =>
      existingName === values.name
        ? {
            name: (
              <>
                An alarm named <AlarmName name={existingName} /> already exists.
              </>
            ),
          }
        : undefined,
    [existingName, values.name],
  );

  async function handleSubmit(submitted: AlarmFormValues) {
    setFailure(undefined);
    setExistingName(undefined);
    const endpoint = connection.engineOrigin;
    if (endpoint === undefined) {
      setFailure({ kind: 'engine-did-not-answer', operation: DESCRIBE_ALARMS });
      return;
    }

    const signal = pageSignal();
    const { name } = submitted;
    try {
      const result = await createAlarm(endpoint, { ...alarmFormInput(submitted), AlarmName: name }, signal);
      if (signal.aborted) return;
      if (result === 'exists') {
        setExistingName(name);
        return;
      }
    } catch (error) {
      if (!signal.aborted) setFailure(failureOf(error, DESCRIBE_ALARMS));
      return;
    }

    flash.handOver(alarmPath(name), [
      {
        type: 'success',
        content: (
          <>
            Alarm <AlarmName name={name} /> created.
          </>
        ),
      },
    ]);
  }

  return (
    <ContentLayout header={<Header variant="h1">Create alarm</Header>}>
      <AlarmForm
        mode="create"
        connection={connection}
        initialValues={initialValues}
        values={values}
        failure={failure}
        fieldErrors={fieldErrors}
        onChange={setValues}
        onSubmit={handleSubmit}
        onCancel={() => void navigate(ALARMS_PATH)}
      />
    </ContentLayout>
  );
}
