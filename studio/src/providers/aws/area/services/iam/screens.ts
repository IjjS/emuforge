import type { ScreenCrumbs, ScreenNavigation, ServiceScreen } from '../../screens';
import {
  CREATE_POLICY_PATH,
  CREATE_ROLE_PATH,
  IAM_PATH,
  POLICIES_PATH,
  POLICY_DETAILS_PATH,
  policyArnOf,
  policyNameOfArn,
  ROLES_PATH,
} from './format';
import { CREATE_POLICY_TITLE, CreatePolicyPage } from './pages/create-policy-page';
import { CREATE_ROLE_TITLE, CreateRolePage } from './pages/create-role-page';
import { PoliciesPage, POLICIES_TITLE } from './pages/policy-list-page';
import { PolicyPage } from './pages/policy-page';
import { RoleListPage, ROLES_TITLE } from './pages/role-list-page';
import { ROLE_NAME_PARAM, RolePage } from './pages/role-page';

const NAVIGATION_HEADER: ScreenNavigation['header'] = {
  text: 'Identity and Access Management (IAM)',
  href: IAM_PATH,
};

/** The side navigation of the role screens (S1 to S3): "Roles" current. */
export const IAM_NAVIGATION: ScreenNavigation = {
  header: NAVIGATION_HEADER,
  activeHref: ROLES_PATH,
};

/** The side navigation of the policy screens (S4 to S6, issue 535): "Policies" current. */
export const IAM_POLICIES_NAVIGATION: ScreenNavigation = {
  header: NAVIGATION_HEADER,
  activeHref: POLICIES_PATH,
};

/** What stands for a policy's name when the address names no ARN. */
export const NO_POLICY_TITLE = 'Policy';

/** A policy page's title and last crumb: the name of the address's ARN, its text after the last `/`. */
export function policyTitle(query: URLSearchParams): string {
  const arn = policyArnOf(query);
  return arn === undefined ? NO_POLICY_TITLE : policyNameOfArn(arn);
}

const POLICIES_CRUMB = { text: POLICIES_TITLE, href: POLICIES_PATH };

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
  // S4, the policy list (issue 535, task 6).
  {
    paths: [POLICIES_PATH],
    title: POLICIES_TITLE,
    crumbs: [{ text: POLICIES_TITLE }],
    navigation: IAM_POLICIES_NAVIGATION,
    Page: PoliciesPage,
  },
  // S5, a policy's page: its ARN in `?arn=`, since an ARN may hold `/` and a path parameter is one segment.
  {
    paths: [POLICY_DETAILS_PATH],
    title: (_params, query) => policyTitle(query),
    crumbs: (_params, query): ScreenCrumbs => [POLICIES_CRUMB, { text: policyTitle(query) }],
    navigation: IAM_POLICIES_NAVIGATION,
    Page: PolicyPage,
  },
  // S6, "Create policy".
  {
    paths: [CREATE_POLICY_PATH],
    title: CREATE_POLICY_TITLE,
    crumbs: [POLICIES_CRUMB, { text: CREATE_POLICY_TITLE }],
    navigation: IAM_POLICIES_NAVIGATION,
    Page: CreatePolicyPage,
  },
];
