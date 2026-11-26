import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { CREATE_TABLE_PATH, DYNAMODB_PATH, TABLES_PATH } from './format';
import { CREATE_TABLE_TITLE, CreateTablePage } from './pages/create-table-page';
import { TableListPage, TABLES_TITLE } from './pages/table-list-page';
import { TablePage } from './pages/table-page';

/** DynamoDB's side navigation on its screens (issue 496, requirement "Screens, routes, layer"): "DynamoDB" and "Tables". */
const NAVIGATION: ScreenNavigation = {
  header: { text: 'DynamoDB', href: DYNAMODB_PATH },
  activeHref: TABLES_PATH,
};

/** DynamoDB's screens, which the area collects (issue 386, R3.1). */
export const SCREENS: readonly ServiceScreen[] = [
  // S1, the table list (issue 496, tasks 1 and 5): at the service's route and at its own, neither redirecting.
  {
    paths: [DYNAMODB_PATH, TABLES_PATH],
    title: TABLES_TITLE,
    crumbs: [{ text: TABLES_TITLE }],
    navigation: NAVIGATION,
    Page: TableListPage,
  },
  // S3, "Create table" (issue 496, task 4).
  {
    paths: [CREATE_TABLE_PATH],
    title: CREATE_TABLE_TITLE,
    crumbs: [{ text: TABLES_TITLE, href: TABLES_PATH }, { text: CREATE_TABLE_TITLE }],
    navigation: NAVIGATION,
    Page: CreateTablePage,
  },
  // S2, a table's page (issue 496, tasks 1, 2 and 5): its name one segment below `table/`, decoded once by the area.
  {
    paths: [`${TABLES_PATH}/table/{name}`],
    title: ({ name }) => name ?? '',
    crumbs: ({ name }) => [{ text: TABLES_TITLE, href: TABLES_PATH }, { text: name ?? '' }],
    navigation: NAVIGATION,
    Page: TablePage,
  },
];
