import type { ServiceScreen } from '../../screens';
import {
  ADD_RULE_PATTERN,
  ADD_RULE_TITLE,
  CREATE_SECURITY_GROUP_PATH,
  CREATE_SECURITY_GROUP_TITLE,
  securityGroupHref,
  SECURITY_GROUP_PATTERN,
  SECURITY_GROUPS_PATH,
  SECURITY_GROUPS_TITLE,
} from './format';
import { SECURITY_GROUPS_NAVIGATION } from './navigation';
import { AddRulePage } from './pages/add-rule-page';
import { CreateGroupPage } from './pages/create-group-page';
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
  // S5: "Create security group".
  {
    paths: [CREATE_SECURITY_GROUP_PATH],
    title: CREATE_SECURITY_GROUP_TITLE,
    crumbs: [{ text: SECURITY_GROUPS_TITLE, href: SECURITY_GROUPS_PATH }, { text: CREATE_SECURITY_GROUP_TITLE }],
    navigation: SECURITY_GROUPS_NAVIGATION,
    Page: CreateGroupPage,
  },
  // S6: a security group, its crumb the id of the address.
  {
    paths: [SECURITY_GROUP_PATTERN],
    title: ({ id }) => id ?? '',
    crumbs: ({ id }) => [{ text: SECURITY_GROUPS_TITLE, href: SECURITY_GROUPS_PATH }, { text: id ?? '' }],
    navigation: SECURITY_GROUPS_NAVIGATION,
    Page: GroupPage,
  },
  // S7: "Add rule" of a security group, its middle crumb the id of the address, to S6.
  {
    paths: [ADD_RULE_PATTERN],
    title: ADD_RULE_TITLE,
    crumbs: ({ id }) => [
      { text: SECURITY_GROUPS_TITLE, href: SECURITY_GROUPS_PATH },
      { text: id ?? '', href: securityGroupHref(id ?? '') },
      { text: ADD_RULE_TITLE },
    ],
    navigation: SECURITY_GROUPS_NAVIGATION,
    Page: AddRulePage,
  },
];
