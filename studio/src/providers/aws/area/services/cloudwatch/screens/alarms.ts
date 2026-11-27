import type { ServiceScreen } from '../../../screens';
import { cloudWatchNavigation } from '../navigation';
import { AlarmListPage } from '../pages/alarm-list-page';
import { ALARMS_PATH, ALARM_PATH, CLOUDWATCH_PATH, CREATE_ALARM_PATH, EDIT_ALARM_PATH } from '../paths';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [ALARMS_PATH, CLOUDWATCH_PATH],
    leadsTo: [ALARM_PATH, CREATE_ALARM_PATH, EDIT_ALARM_PATH],
    title: 'Alarms',
    crumbs: [{ text: 'Alarms' }],
    navigation: cloudWatchNavigation(),
    Page: AlarmListPage,
  },
];
