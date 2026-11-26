import type { ServiceScreen } from '../../../screens';
import { LOG_EVENTS_PATH } from '../format';
import { logsNavigation } from '../navigation';
import { LogEventsPage } from '../pages/log-events-page';

const title = 'Log events';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [LOG_EVENTS_PATH],
    title,
    crumbs: [{ text: title }],
    navigation: logsNavigation(LOG_EVENTS_PATH),
    Page: LogEventsPage,
  },
];
