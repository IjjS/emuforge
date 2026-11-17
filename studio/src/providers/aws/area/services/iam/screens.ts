import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { CREATE_ROLE_PATH, IAM_PATH, ROLES_PATH } from './format';
import { CREATE_ROLE_TITLE, CreateRolePage } from './pages/create-role-page';
import { RoleListPage, ROLES_TITLE } from './pages/role-list-page';
import { ROLE_NAME_PARAM, RolePage } from './pages/role-page';

/**
 * The side navigation of every IAM screen (issue 82, requirement R6.1): the header, and the group "Access
 * Management" with its one link "Roles", current on every screen of this issue.
 */
export const IAM_NAVIGATION: ScreenNavigation = {
  header: { text: 'Identity and Access Management (IAM)', href: IAM_PATH },
  items: [
    {
      type: 'section',
      text: 'Access Management',
      items: [{ type: 'link', text: 'Roles', href: ROLES_PATH }],
    },
  ],
  activeHref: ROLES_PATH,
};

/** IAM's screens, which the area collects (issue 386, R3.1). */
export const SCREENS: readonly ServiceScreen[] = [
  // S1, the role list (issue 82, R0, R4): at the service's route and at its own, neither redirecting.
  {
    paths: [IAM_PATH, ROLES_PATH],
    title: ROLES_TITLE,
    crumbs: [{ text: 'Roles' }],
    navigation: IAM_NAVIGATION,
    Page: RoleListPage,
  },
  // S2, a role's page (R0, R5): the name as one segment below `details/`, so a role named `create` is not S3's route.
  {
    paths: [`${ROLES_PATH}/details/{${ROLE_NAME_PARAM}}`],
    title: (params) => params[ROLE_NAME_PARAM] ?? '',
    crumbs: (params) => [{ text: 'Roles', href: ROLES_PATH }, { text: params[ROLE_NAME_PARAM] ?? '' }],
    navigation: IAM_NAVIGATION,
    Page: RolePage,
  },
  // S3, "Create role" (R0, R6): its step `k` at `?step=<k>`.
  {
    paths: [CREATE_ROLE_PATH],
    title: CREATE_ROLE_TITLE,
    crumbs: [{ text: 'Roles', href: ROLES_PATH }, { text: CREATE_ROLE_TITLE }],
    navigation: IAM_NAVIGATION,
    Page: CreateRolePage,
  },
];
