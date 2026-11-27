import type { ServiceScreen } from '../../../screens';
import { cloudWatchNavigation } from '../navigation';
import { AlarmListPage } from '../pages/alarm-list-page';
import { ALARMS_PATH, CLOUDWATCH_PATH } from '../paths';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [ALARMS_PATH, CLOUDWATCH_PATH],
    title: 'Alarms',
    crumbs: [{ text: 'Alarms' }],
    navigation: cloudWatchNavigation(),
    Page: AlarmListPage,
  },
];
