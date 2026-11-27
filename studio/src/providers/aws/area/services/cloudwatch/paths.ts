export const CLOUDWATCH_PATH = '/aws/cloudwatch';
export const ALARMS_PATH = `${CLOUDWATCH_PATH}/alarms`;
export const ALARM_PATH = `${ALARMS_PATH}/alarm`;
export const CREATE_ALARM_PATH = `${ALARMS_PATH}/create`;
export const EDIT_ALARM_PATH = `${ALARMS_PATH}/edit`;

export function alarmPath(name: string): string {
  return `${ALARM_PATH}?${new URLSearchParams({ name })}`;
}

export function editAlarmPath(name: string): string {
  return `${EDIT_ALARM_PATH}?${new URLSearchParams({ name })}`;
}

export function alarmNameFromSearch(search: string): string | undefined {
  return new URLSearchParams(search).get('name') || undefined;
}
