import type { ServiceScreen } from '../../screens';
import { CREATE_VPC_PATH, CREATE_VPC_TITLE, VPC_PATH, VPC_PATTERN, VPCS_PATH, VPCS_TITLE } from './format';
import { VPCS_NAVIGATION } from './navigation';
import { CreateVpcPage } from './pages/create-vpc-page';
import { VpcListPage } from './pages/vpc-list-page';
import { VpcPage } from './pages/vpc-page';

/** VPC's screens of S1 to S3, the VPCs, which `screens.ts` collects. */
export const VPC_SCREENS: readonly ServiceScreen[] = [
  // S1: at the service's route and at its own, neither redirecting.
  {
    paths: [VPC_PATH, VPCS_PATH],
    title: VPCS_TITLE,
    crumbs: [{ text: VPCS_TITLE }],
    navigation: VPCS_NAVIGATION,
    Page: VpcListPage,
  },
  // S2: "Create VPC".
  {
    paths: [CREATE_VPC_PATH],
    title: CREATE_VPC_TITLE,
    crumbs: [{ text: VPCS_TITLE, href: VPCS_PATH }, { text: CREATE_VPC_TITLE }],
    navigation: VPCS_NAVIGATION,
    Page: CreateVpcPage,
  },
  // S3: a VPC, its crumb the id of the address.
  {
    paths: [VPC_PATTERN],
    title: ({ id }) => id ?? '',
    crumbs: ({ id }) => [{ text: VPCS_TITLE, href: VPCS_PATH }, { text: id ?? '' }],
    navigation: VPCS_NAVIGATION,
    Page: VpcPage,
  },
];
