import type { ServiceScreen } from '../../../screens';
import { LOG_GROUP_PATH, LOG_GROUPS_PATH, LOG_GROUPS_TITLE, nameFromSegment } from '../format';
import { logsNavigation } from '../navigation';
import { LogGroupPage } from '../pages/log-group-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [LOG_GROUP_PATH],
    title: ({ group }) => nameFromSegment(group ?? ''),
    crumbs: ({ group }) => [{ text: LOG_GROUPS_TITLE, href: LOG_GROUPS_PATH }, { text: nameFromSegment(group ?? '') }],
    navigation: logsNavigation(LOG_GROUPS_PATH),
    Page: LogGroupPage,
  },
];
