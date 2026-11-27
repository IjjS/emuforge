import { PutMetricAlarmCommand, type PutMetricAlarmCommandInput } from '@aws-sdk/client-cloudwatch';

import { readAlarm } from './alarms-api';
import { sendCloudWatch } from './clients';

export const PUT_METRIC_ALARM = 'PutMetricAlarm';

export async function createAlarm(
  endpoint: string,
  input: PutMetricAlarmCommandInput,
  signal: AbortSignal,
): Promise<'created' | 'exists'> {
  if ((await readAlarm(endpoint, input.AlarmName, signal)) !== undefined) return 'exists';

  const command = new PutMetricAlarmCommand(input);
  await sendCloudWatch(
    endpoint,
    PUT_METRIC_ALARM,
    (client, abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  return 'created';
}
