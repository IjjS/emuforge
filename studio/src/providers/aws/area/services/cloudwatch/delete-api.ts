import { DeleteAlarmsCommand } from '@aws-sdk/client-cloudwatch';

import { sendCloudWatch } from './clients';

export const DELETE_ALARMS = 'DeleteAlarms';

export async function deleteAlarm(endpoint: string, name: string, signal: AbortSignal): Promise<void> {
  await sendCloudWatch(
    endpoint,
    DELETE_ALARMS,
    (client, abort) => client.send(new DeleteAlarmsCommand({ AlarmNames: [name] }), { abortSignal: abort }),
    signal,
  );
}
