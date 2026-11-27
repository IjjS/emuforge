import { PutMetricAlarmCommand } from '@aws-sdk/client-cloudwatch';

import type { EditableAlarm } from './alarm';
import { mergeAlarmEdit, type AlarmEditValues } from './alarm-edit';
import { readAlarm } from './alarms-api';
import { sendCloudWatch } from './clients';
import { PUT_METRIC_ALARM } from './create-api';

export async function editAlarm(
  endpoint: string,
  name: string,
  baseline: EditableAlarm,
  values: AlarmEditValues,
  signal: AbortSignal,
) {
  const latest = await readAlarm(endpoint, name, signal);
  signal.throwIfAborted();
  const result = mergeAlarmEdit(name, baseline, values, latest);
  if (result.kind !== 'ready') return result;

  const command = new PutMetricAlarmCommand(result.input);
  await sendCloudWatch(
    endpoint,
    PUT_METRIC_ALARM,
    (client, abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  return { kind: 'saved' } as const;
}
