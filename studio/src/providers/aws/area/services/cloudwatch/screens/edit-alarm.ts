import type { ServiceScreen } from '../../../screens';
import { cloudWatchNavigation } from '../navigation';
import { EditAlarmPage } from '../pages/edit-alarm-page';
import { ALARMS_PATH, alarmPath, EDIT_ALARM_PATH } from '../paths';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [EDIT_ALARM_PATH],
    title: 'Edit alarm',
    crumbs: (_, query) => {
      const name = query.get('name');
      return [
        { text: 'Alarms', href: ALARMS_PATH },
        ...(name ? [{ text: name, href: alarmPath(name) }] : []),
        { text: 'Edit' },
      ];
    },
    navigation: cloudWatchNavigation(),
    Page: EditAlarmPage,
  },
];
