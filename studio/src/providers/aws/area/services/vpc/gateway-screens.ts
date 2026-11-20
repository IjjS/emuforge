import type { ServiceScreen } from '../../screens';
import {
  ATTACH_INTERNET_GATEWAY_PATTERN,
  ATTACH_INTERNET_GATEWAY_TITLE,
  CREATE_INTERNET_GATEWAY_PATH,
  CREATE_INTERNET_GATEWAY_TITLE,
  INTERNET_GATEWAYS_PATH,
  INTERNET_GATEWAYS_TITLE,
} from './format';
import { INTERNET_GATEWAYS_NAVIGATION } from './navigation';
import { AttachGatewayPage } from './pages/attach-gateway-page';
import { CreateGatewayPage } from './pages/create-gateway-page';
import { GatewayListPage } from './pages/gateway-list-page';

/** VPC's screens of S12 to S14, the internet gateways, which `screens.ts` collects. */
export const GATEWAY_SCREENS: readonly ServiceScreen[] = [
  // S12: the internet gateways.
  {
    paths: [INTERNET_GATEWAYS_PATH],
    title: INTERNET_GATEWAYS_TITLE,
    crumbs: [{ text: INTERNET_GATEWAYS_TITLE }],
    navigation: INTERNET_GATEWAYS_NAVIGATION,
    Page: GatewayListPage,
  },
  // S13: "Create internet gateway".
  {
    paths: [CREATE_INTERNET_GATEWAY_PATH],
    title: CREATE_INTERNET_GATEWAY_TITLE,
    crumbs: [{ text: INTERNET_GATEWAYS_TITLE, href: INTERNET_GATEWAYS_PATH }, { text: CREATE_INTERNET_GATEWAY_TITLE }],
    navigation: INTERNET_GATEWAYS_NAVIGATION,
    Page: CreateGatewayPage,
  },
  // S14: "Attach internet gateway" of the gateway of the address.
  {
    paths: [ATTACH_INTERNET_GATEWAY_PATTERN],
    title: ATTACH_INTERNET_GATEWAY_TITLE,
    crumbs: [{ text: INTERNET_GATEWAYS_TITLE, href: INTERNET_GATEWAYS_PATH }, { text: ATTACH_INTERNET_GATEWAY_TITLE }],
    navigation: INTERNET_GATEWAYS_NAVIGATION,
    Page: AttachGatewayPage,
  },
];
