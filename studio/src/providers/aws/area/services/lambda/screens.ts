import type { ServiceScreen } from '../../screens';
import { CREATE_FUNCTION_PATH, FUNCTIONS_PATH, LAMBDA_PATH } from './format';
import { CREATE_FUNCTION_TITLE, CreateFunctionPage } from './pages/create-function-page';
import { FUNCTIONS_TITLE, FunctionListPage } from './pages/function-list-page';
import { FunctionPage } from './pages/function-page';
import { LAYERS_TITLE, LayersPage } from './pages/layers-page';

const LAYERS_PATH = `${LAMBDA_PATH}/layers`;

/** Lambda's side navigation on its screens. */
const NAVIGATION: ServiceScreen['navigation'] = {
  header: { text: 'Lambda', href: LAMBDA_PATH },
  activeHref: FUNCTIONS_PATH,
};

/** Lambda's screens, which the area collects (issue 386, R3.1). */
export const SCREENS: readonly ServiceScreen[] = [
  // S1, the function list (issue 84, R0): at the service's route and at its own, neither redirecting.
  {
    paths: [LAMBDA_PATH, FUNCTIONS_PATH],
    title: FUNCTIONS_TITLE,
    crumbs: [{ text: FUNCTIONS_TITLE }],
    navigation: NAVIGATION,
    Page: FunctionListPage,
  },
  // S2, a function's page (R0): its name one segment below `function/`, decoded once by the area.
  {
    paths: [`${FUNCTIONS_PATH}/function/{name}`],
    title: ({ name }) => name ?? '',
    crumbs: ({ name }) => [{ text: FUNCTIONS_TITLE, href: FUNCTIONS_PATH }, { text: name ?? '' }],
    navigation: NAVIGATION,
    Page: FunctionPage,
  },
  // S3, "Create Event Function" (R0, R6.1).
  {
    paths: [CREATE_FUNCTION_PATH],
    title: CREATE_FUNCTION_TITLE,
    crumbs: [{ text: FUNCTIONS_TITLE, href: FUNCTIONS_PATH }, { text: CREATE_FUNCTION_TITLE }],
    navigation: NAVIGATION,
    Page: CreateFunctionPage,
  },
  {
    paths: [LAYERS_PATH],
    title: LAYERS_TITLE,
    crumbs: [{ text: LAYERS_TITLE }],
    navigation: { ...NAVIGATION, activeHref: LAYERS_PATH },
    Page: LayersPage,
  },
];
