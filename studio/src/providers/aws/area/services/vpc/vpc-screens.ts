import type { ServiceScreen } from '../../screens';
import { VPC_PATH, VPCS_PATH, VPCS_TITLE } from './format';
import { VPCS_NAVIGATION } from './navigation';
import { VpcListPage } from './pages/vpc-list-page';

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
];
