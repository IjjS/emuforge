import type { ServiceScreen } from '../../../screens';
import { cloudWatchNavigation } from '../navigation';
import { CreateAlarmPage } from '../pages/create-alarm-page';
import { ALARMS_PATH, CREATE_ALARM_PATH } from '../paths';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [CREATE_ALARM_PATH],
    title: 'Create alarm',
    crumbs: [{ text: 'Alarms', href: ALARMS_PATH }, { text: 'Create alarm' }],
    navigation: cloudWatchNavigation(),
    Page: CreateAlarmPage,
  },
];
