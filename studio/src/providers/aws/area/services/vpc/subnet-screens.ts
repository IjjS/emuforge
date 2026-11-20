import type { ServiceScreen } from '../../screens';
import { CREATE_SUBNET_PATH, CREATE_SUBNET_TITLE, SUBNET_PATTERN, SUBNETS_PATH, SUBNETS_TITLE } from './format';
import { SUBNETS_NAVIGATION } from './navigation';
import { CreateSubnetPage } from './pages/create-subnet-page';
import { SubnetListPage } from './pages/subnet-list-page';
import { SubnetPage } from './pages/subnet-page';

/** VPC's screens of S4 to S6, the subnets, which `screens.ts` collects. */
export const SUBNET_SCREENS: readonly ServiceScreen[] = [
  // S4: the subnets.
  {
    paths: [SUBNETS_PATH],
    title: SUBNETS_TITLE,
    crumbs: [{ text: SUBNETS_TITLE }],
    navigation: SUBNETS_NAVIGATION,
    Page: SubnetListPage,
  },
  // S5: "Create subnet", `?vpc={id}` choosing the VPC.
  {
    paths: [CREATE_SUBNET_PATH],
    title: CREATE_SUBNET_TITLE,
    crumbs: [{ text: SUBNETS_TITLE, href: SUBNETS_PATH }, { text: CREATE_SUBNET_TITLE }],
    navigation: SUBNETS_NAVIGATION,
    Page: CreateSubnetPage,
  },
  // S6: a subnet, its crumb the id of the address.
  {
    paths: [SUBNET_PATTERN],
    title: ({ id }) => id ?? '',
    crumbs: ({ id }) => [{ text: SUBNETS_TITLE, href: SUBNETS_PATH }, { text: id ?? '' }],
    navigation: SUBNETS_NAVIGATION,
    Page: SubnetPage,
  },
];
