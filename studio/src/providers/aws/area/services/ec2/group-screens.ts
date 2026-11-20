import type { ServiceScreen } from '../../screens';
import { SECURITY_GROUP_PATTERN, SECURITY_GROUPS_PATH, SECURITY_GROUPS_TITLE } from './format';
import { SECURITY_GROUPS_NAVIGATION } from './navigation';
import { GroupListPage } from './pages/group-list-page';
import { GroupPage } from './pages/group-page';

/** EC2's screens of S4 to S7, the security groups (units s3, s5), which `screens.ts` collects. */
export const GROUP_SCREENS: readonly ServiceScreen[] = [
  // S4: the security groups.
  {
    paths: [SECURITY_GROUPS_PATH],
    title: SECURITY_GROUPS_TITLE,
    crumbs: [{ text: SECURITY_GROUPS_TITLE }],
    navigation: SECURITY_GROUPS_NAVIGATION,
    Page: GroupListPage,
  },
  // S6: a security group, its crumb the id of the address.
  {
    paths: [SECURITY_GROUP_PATTERN],
    title: ({ id }) => id ?? '',
    crumbs: ({ id }) => [{ text: SECURITY_GROUPS_TITLE, href: SECURITY_GROUPS_PATH }, { text: id ?? '' }],
    navigation: SECURITY_GROUPS_NAVIGATION,
    Page: GroupPage,
  },
];
