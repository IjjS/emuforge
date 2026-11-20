import type { ServiceScreen } from '../../screens';
import {
  ADD_ROUTE_PATTERN,
  ADD_ROUTE_TITLE,
  ASSOCIATE_SUBNET_PATTERN,
  ASSOCIATE_SUBNET_TITLE,
  CREATE_ROUTE_TABLE_PATH,
  CREATE_ROUTE_TABLE_TITLE,
  ROUTE_TABLE_PATTERN,
  ROUTE_TABLES_PATH,
  ROUTE_TABLES_TITLE,
  routeTableHref,
} from './format';
import { ROUTE_TABLES_NAVIGATION } from './navigation';
import { AddRoutePage } from './pages/add-route-page';
import { AssociateSubnetPage } from './pages/associate-subnet-page';
import { CreateRouteTablePage } from './pages/create-route-table-page';
import { RouteTableListPage } from './pages/route-table-list-page';
import { RouteTablePage } from './pages/route-table-page';

/** VPC's screens of S7 to S11, the route tables, which `screens.ts` collects. */
export const ROUTE_TABLE_SCREENS: readonly ServiceScreen[] = [
  // S7: the route tables.
  {
    paths: [ROUTE_TABLES_PATH],
    title: ROUTE_TABLES_TITLE,
    crumbs: [{ text: ROUTE_TABLES_TITLE }],
    navigation: ROUTE_TABLES_NAVIGATION,
    Page: RouteTableListPage,
  },
  // S8: "Create route table".
  {
    paths: [CREATE_ROUTE_TABLE_PATH],
    title: CREATE_ROUTE_TABLE_TITLE,
    crumbs: [{ text: ROUTE_TABLES_TITLE, href: ROUTE_TABLES_PATH }, { text: CREATE_ROUTE_TABLE_TITLE }],
    navigation: ROUTE_TABLES_NAVIGATION,
    Page: CreateRouteTablePage,
  },
  // S9: a route table, its crumb the id of the address.
  {
    paths: [ROUTE_TABLE_PATTERN],
    title: ({ id }) => id ?? '',
    crumbs: ({ id }) => [{ text: ROUTE_TABLES_TITLE, href: ROUTE_TABLES_PATH }, { text: id ?? '' }],
    navigation: ROUTE_TABLES_NAVIGATION,
    Page: RouteTablePage,
  },
  // S10: "Add route", for the route table of its address.
  {
    paths: [ADD_ROUTE_PATTERN],
    title: ADD_ROUTE_TITLE,
    crumbs: ({ id }) => [
      { text: ROUTE_TABLES_TITLE, href: ROUTE_TABLES_PATH },
      { text: id ?? '', href: routeTableHref(id ?? '') },
      { text: ADD_ROUTE_TITLE },
    ],
    navigation: ROUTE_TABLES_NAVIGATION,
    Page: AddRoutePage,
  },
  // S11: "Associate subnet", for the route table of its address.
  {
    paths: [ASSOCIATE_SUBNET_PATTERN],
    title: ASSOCIATE_SUBNET_TITLE,
    crumbs: ({ id }) => [
      { text: ROUTE_TABLES_TITLE, href: ROUTE_TABLES_PATH },
      { text: id ?? '', href: routeTableHref(id ?? '') },
      { text: ASSOCIATE_SUBNET_TITLE },
    ],
    navigation: ROUTE_TABLES_NAVIGATION,
    Page: AssociateSubnetPage,
  },
];
