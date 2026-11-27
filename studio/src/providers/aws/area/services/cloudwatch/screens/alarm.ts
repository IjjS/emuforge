import type { ServiceScreen } from '../../../screens';
import { cloudWatchNavigation } from '../navigation';
import { AlarmPage } from '../pages/alarm-page';
import { ALARM_PATH, ALARMS_PATH } from '../paths';

const title = (query: URLSearchParams) => query.get('name') || 'Alarm not found';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [ALARM_PATH],
    title: (_, query) => title(query),
    crumbs: (_, query) => [{ text: 'Alarms', href: ALARMS_PATH }, { text: title(query) }],
    navigation: cloudWatchNavigation(),
    Page: AlarmPage,
  },
];
