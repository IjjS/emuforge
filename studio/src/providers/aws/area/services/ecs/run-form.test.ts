import { describe, expect, it } from 'vitest';

import {
  RUN_FORM_START,
  runFormMessages,
  runRequestOf,
  withFamily,
  withNewest,
  withSubnets,
  type RunFormState,
} from './run-form';

const VALID: RunFormState = {
  family: 'web',
  revision: { value: 'web:3', family: 'web', revision: 3 },
  count: '2',
  subnets: [
    { id: 'subnet-a', vpcId: 'vpc-1', zone: 'us-east-1a' },
    { id: 'subnet-b', vpcId: 'vpc-1', zone: 'us-east-1b' },
  ],
  groups: [],
  publicIp: true,
};

describe('the Run task form', () => {
  it('at start → count 1, public IP on, nothing else chosen', () => {
    expect(RUN_FORM_START).toEqual({
      family: undefined,
      revision: undefined,
      count: '1',
      subnets: [],
      groups: [],
      publicIp: true,
    });
  });

  it("each field's message: family, revision, subnet, and a count of 0, 11, 1.5 or nothing", () => {
    expect(runFormMessages(RUN_FORM_START)).toEqual({
      family: 'Choose a task definition family.',
      revision: 'Choose a revision.',
      subnets: 'Choose at least one subnet.',
    });
    for (const count of ['0', '11', '1.5', '']) {
      expect(runFormMessages({ ...VALID, count })).toEqual({ count: 'Enter a whole number from 1 to 10.' });
      expect(runRequestOf('dev', { ...VALID, count })).toBeUndefined();
    }
    for (const count of ['1', '10']) {
      expect(runFormMessages({ ...VALID, count })).toEqual({});
    }
    expect(runRequestOf('dev', RUN_FORM_START)).toBeUndefined();
  });

  it('a valid form → the request of the design; security groups only when chosen; the public IP ENABLED or DISABLED', () => {
    expect(runRequestOf('dev', VALID)).toEqual({
      cluster: 'dev',
      taskDefinition: 'web:3',
      count: 2,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: { subnets: ['subnet-a', 'subnet-b'], assignPublicIp: 'ENABLED' },
      },
    });
    expect(
      runRequestOf('dev', { ...VALID, groups: [{ id: 'sg-1', name: 'default' }], publicIp: false })
        ?.networkConfiguration,
    ).toEqual({
      awsvpcConfiguration: { subnets: ['subnet-a', 'subnet-b'], securityGroups: ['sg-1'], assignPublicIp: 'DISABLED' },
    });
  });

  it("changing the family → the revision is the new family's newest; removing the last subnet clears the groups", () => {
    const newest = { value: 'api:7', family: 'api', revision: 7 };
    expect(withFamily(VALID, 'api', newest).revision).toEqual(newest);
    const changed = withFamily(VALID, 'api', undefined);
    expect(changed.family).toBe('api');
    expect(changed.revision).toBeUndefined();
    expect(withNewest(changed, newest).revision).toEqual(newest);
    // The newest of another family, or a revision already chosen, is not taken.
    expect(withNewest(changed, { value: 'web:9', family: 'web', revision: 9 }).revision).toBeUndefined();
    expect(withNewest(VALID, { value: 'web:9', family: 'web', revision: 9 }).revision?.value).toBe('web:3');

    const withGroups = { ...VALID, groups: [{ id: 'sg-1' }] };
    const one = withSubnets(withGroups, [{ id: 'subnet-a', vpcId: 'vpc-1' }]);
    expect(one.groups).toEqual([{ id: 'sg-1' }]);
    const none = withSubnets(one, []);
    expect(none.subnets).toEqual([]);
    expect(none.groups).toEqual([]);
  });
});
