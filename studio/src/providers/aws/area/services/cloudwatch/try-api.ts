import {
  DisableAlarmActionsCommand,
  EnableAlarmActionsCommand,
  SetAlarmStateCommand,
  type StateValue,
} from '@aws-sdk/client-cloudwatch';

import { sendCloudWatch } from './clients';

export const SET_ALARM_STATE = 'SetAlarmState';
export const ENABLE_ALARM_ACTIONS = 'EnableAlarmActions';
export const DISABLE_ALARM_ACTIONS = 'DisableAlarmActions';

export async function setAlarmState(
  endpoint: string,
  name: string,
  state: StateValue,
  reason: string,
  signal: AbortSignal,
): Promise<void> {
  const command = new SetAlarmStateCommand({ AlarmName: name, StateValue: state, StateReason: reason });
  await sendCloudWatch(
    endpoint,
    SET_ALARM_STATE,
    (client, abort) => client.send(command, { abortSignal: abort }),
    signal,
  );
}

export function actionsSwitchOperation(enabled: boolean) {
  return enabled ? ENABLE_ALARM_ACTIONS : DISABLE_ALARM_ACTIONS;
}

export async function setAlarmActions(
  endpoint: string,
  name: string,
  enabled: boolean,
  signal: AbortSignal,
): Promise<void> {
  const input = { AlarmNames: [name] };
  const command = enabled ? new EnableAlarmActionsCommand(input) : new DisableAlarmActionsCommand(input);
  await sendCloudWatch(
    endpoint,
    actionsSwitchOperation(enabled),
    (client, abort) => client.send(command, { abortSignal: abort }),
    signal,
  );
}
