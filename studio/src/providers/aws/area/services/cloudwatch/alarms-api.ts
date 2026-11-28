import { DescribeAlarmsCommand, type AlarmType, type StateValue } from '@aws-sdk/client-cloudwatch';

import type { TokenPage } from '../../components/use-token-listing';
import { alarmsFromAnswer, type Alarm } from './alarm';
import { sendCloudWatch } from './clients';

export const ALARM_TYPES: readonly AlarmType[] = ['CompositeAlarm', 'MetricAlarm', 'LogAlarm'];
export const DESCRIBE_ALARMS = 'DescribeAlarms';

export interface AlarmFilters {
  prefix?: string;
  state?: StateValue;
}

export async function listAlarms(
  endpoint: string,
  { prefix, state }: AlarmFilters,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<Alarm>> {
  const command = new DescribeAlarmsCommand({
    AlarmTypes: [...ALARM_TYPES],
    MaxRecords: 25,
    ...(prefix ? { AlarmNamePrefix: prefix } : {}),
    ...(state === undefined ? {} : { StateValue: state }),
    ...(token === undefined ? {} : { NextToken: token }),
  });
  const answer = await sendCloudWatch(
    endpoint,
    DESCRIBE_ALARMS,
    (client, abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  return {
    items: alarmsFromAnswer(answer),
    ...(answer.NextToken === undefined ? {} : { next: answer.NextToken }),
  };
}

export async function readAlarm(endpoint: string, name: string, signal: AbortSignal): Promise<Alarm | undefined> {
  const command = new DescribeAlarmsCommand({ AlarmTypes: [...ALARM_TYPES], AlarmNames: [name] });
  const answer = await sendCloudWatch(
    endpoint,
    DESCRIBE_ALARMS,
    (client, abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  return alarmsFromAnswer(answer).find(({ data }) => data.AlarmName === name);
}
