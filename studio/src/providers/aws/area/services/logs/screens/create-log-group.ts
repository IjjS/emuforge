import type { ServiceScreen } from '../../../screens';
import { CREATE_LOG_GROUP_PATH, CREATE_LOG_GROUP_TITLE, LOG_GROUPS_PATH, LOG_GROUPS_TITLE } from '../format';
import { logsNavigation } from '../navigation';
import { CreateLogGroupPage } from '../pages/create-log-group-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [CREATE_LOG_GROUP_PATH],
    title: CREATE_LOG_GROUP_TITLE,
    crumbs: [{ text: LOG_GROUPS_TITLE, href: LOG_GROUPS_PATH }, { text: CREATE_LOG_GROUP_TITLE }],
    navigation: logsNavigation(LOG_GROUPS_PATH),
    Page: CreateLogGroupPage,
  },
];
