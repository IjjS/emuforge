import { describe, expect, it } from 'vitest';

import { countText, networkTexts, publicIpText } from './service-format';

describe("a service's network values", () => {
  it('assignPublicIp ENABLED → "Enabled", DISABLED → "Disabled", no network configuration → "-" for the three', () => {
    expect(publicIpText('ENABLED')).toBe('Enabled');
    expect(publicIpText('DISABLED')).toBe('Disabled');
    expect(
      networkTexts({
        network: { subnets: ['subnet-1', 'subnet-2'], securityGroups: ['sg-1'], assignPublicIp: 'DISABLED' },
      }),
    ).toEqual({ subnets: 'subnet-1, subnet-2', securityGroups: 'sg-1', publicIp: 'Disabled' });
    expect(networkTexts({})).toEqual({ subnets: '-', securityGroups: '-', publicIp: '-' });
  });

  it('a count → its number, 0 kept; none → "-"', () => {
    expect(countText(0)).toBe('0');
    expect(countText(undefined)).toBe('-');
  });
});
