import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { ParameterDetailPage } from './pages/detail';
import { CreateParameterPage, EditParameterPage } from './pages/form';
import { ParameterListPage } from './pages/list';
import {
  PARAMETER_CREATE_PATH,
  PARAMETER_DETAIL_PATH,
  PARAMETER_EDIT_PATH,
  PARAMETER_STORE_PATH,
  parameterName,
  parameterPath,
} from './paths';

const NAVIGATION: ScreenNavigation = {
  header: { text: 'Systems Manager', href: PARAMETER_STORE_PATH },
  items: [{ type: 'link', text: 'Parameter Store', href: PARAMETER_STORE_PATH }],
  activeHref: PARAMETER_STORE_PATH,
};

const STORE_CRUMB = { text: 'Parameter Store', href: PARAMETER_STORE_PATH };

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [PARAMETER_STORE_PATH],
    title: 'Parameter Store',
    crumbs: [{ text: 'Parameter Store' }],
    navigation: NAVIGATION,
    Page: ParameterListPage,
  },
  {
    paths: [PARAMETER_DETAIL_PATH],
    title: (_, query) => parameterName(query) || 'Parameter details',
    crumbs: (_, query) => [STORE_CRUMB, { text: parameterName(query) || 'Parameter details' }],
    navigation: NAVIGATION,
    Page: ParameterDetailPage,
  },
  {
    paths: [PARAMETER_CREATE_PATH],
    title: 'Create parameter',
    crumbs: [STORE_CRUMB, { text: 'Create parameter' }],
    navigation: NAVIGATION,
    Page: CreateParameterPage,
  },
  {
    paths: [PARAMETER_EDIT_PATH],
    title: 'Edit parameter',
    crumbs: (_, query) => {
      const name = parameterName(query);
      return [STORE_CRUMB, ...(name ? [{ text: name, href: parameterPath(name) }] : []), { text: 'Edit parameter' }];
    },
    navigation: NAVIGATION,
    Page: EditParameterPage,
  },
];
