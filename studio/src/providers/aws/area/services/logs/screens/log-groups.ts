import type { ServiceScreen } from '../../../screens';
import { LOG_GROUPS_PATH, LOG_GROUPS_TITLE, LOGS_PATH } from '../format';
import { logsNavigation } from '../navigation';
import { LogGroupListPage } from '../pages/log-group-list-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [LOG_GROUPS_PATH, LOGS_PATH],
    title: LOG_GROUPS_TITLE,
    crumbs: [{ text: LOG_GROUPS_TITLE }],
    navigation: logsNavigation(LOG_GROUPS_PATH),
    Page: LogGroupListPage,
  },
];
