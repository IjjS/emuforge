import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { ParameterDetailPage } from './pages/detail';
import { ParameterListPage } from './pages/list';
import { PARAMETER_DETAIL_PATH, PARAMETER_STORE_PATH, parameterName } from './paths';

const NAVIGATION: ScreenNavigation = {
  header: { text: 'Systems Manager', href: PARAMETER_STORE_PATH },
  items: [{ type: 'link', text: 'Parameter Store', href: PARAMETER_STORE_PATH }],
  activeHref: PARAMETER_STORE_PATH,
};

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
    crumbs: (_, query) => [
      { text: 'Parameter Store', href: PARAMETER_STORE_PATH },
      { text: parameterName(query) || 'Parameter details' },
    ],
    navigation: NAVIGATION,
    Page: ParameterDetailPage,
  },
];
