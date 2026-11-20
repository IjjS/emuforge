import { NONE } from './format';
import type { Service } from './service-api';

// How the service screens write a service's network values (issue 575, R4, S4): its subnets, its security groups and
// whether it assigns a public IP, each "-" when the service has no network configuration.

const PUBLIC_IP_WORDS: Readonly<Record<string, string>> = { ENABLED: 'Enabled', DISABLED: 'Disabled' };

/** The three network values of S4's summary, as text. */
export interface NetworkTexts {
  subnets: string;
  securityGroups: string;
  publicIp: string;
}

function listText(values: readonly string[]): string {
  return values.length === 0 ? NONE : values.join(', ');
}

/** "Enabled" or "Disabled"; another word as the emulator gave it; none as "-". */
export function publicIpText(value: string | undefined): string {
  if (value === undefined || value === '') {
    return NONE;
  }
  return PUBLIC_IP_WORDS[value] ?? value;
}

/** A service's network values; all three "-" for a service without a network configuration. */
export function networkTexts(service: Pick<Service, 'network'>): NetworkTexts {
  const network = service.network;
  if (network === undefined) {
    return { subnets: NONE, securityGroups: NONE, publicIp: NONE };
  }
  return {
    subnets: listText(network.subnets),
    securityGroups: listText(network.securityGroups),
    publicIp: publicIpText(network.assignPublicIp),
  };
}

/** A count of the answer, "-" when it gave none. */
export function countText(value: number | undefined): string {
  return value === undefined ? NONE : String(value);
}
