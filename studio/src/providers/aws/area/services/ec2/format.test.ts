import { describe, expect, it } from 'vitest';

import {
  ADD_RULE_PATTERN,
  addRuleHref,
  CREATE_KEY_PAIR_PATH,
  CREATE_SECURITY_GROUP_PATH,
  EC2_PATH,
  INSTANCE_PATTERN,
  instanceHeading,
  instanceHref,
  instanceName,
  INSTANCES_PATH,
  INSTANCES_WORD,
  KEY_PAIRS_PATH,
  KEY_PAIRS_WORD,
  LAUNCH_INSTANCE_PATH,
  SECURITY_GROUP_PATTERN,
  securityGroupHref,
  SECURITY_GROUPS_PATH,
  SECURITY_GROUPS_WORD,
} from './format';

describe("EC2's addresses", () => {
  it("are the requirement's routes", () => {
    expect(EC2_PATH).toBe('/aws/ec2');
    expect(INSTANCES_PATH).toBe('/aws/ec2/instances');
    expect(LAUNCH_INSTANCE_PATH).toBe('/aws/ec2/instances/launch');
    expect(INSTANCE_PATTERN).toBe('/aws/ec2/instances/instance/{id}');
    expect(SECURITY_GROUPS_PATH).toBe('/aws/ec2/security-groups');
    expect(CREATE_SECURITY_GROUP_PATH).toBe('/aws/ec2/security-groups/create');
    expect(SECURITY_GROUP_PATTERN).toBe('/aws/ec2/security-groups/group/{id}');
    expect(ADD_RULE_PATTERN).toBe('/aws/ec2/security-groups/group/{id}/add-rule');
    expect(KEY_PAIRS_PATH).toBe('/aws/ec2/key-pairs');
    expect(CREATE_KEY_PAIR_PATH).toBe('/aws/ec2/key-pairs/create');
  });

  it("an instance's and a group's address hold the id percent-encoded once as one segment", () => {
    expect(instanceHref('i-0abc')).toBe('/aws/ec2/instances/instance/i-0abc');
    expect(instanceHref('a/b %c')).toBe('/aws/ec2/instances/instance/a%2Fb%20%25c');
    expect(securityGroupHref('sg-1')).toBe('/aws/ec2/security-groups/group/sg-1');
    expect(securityGroupHref('x/y')).toBe('/aws/ec2/security-groups/group/x%2Fy');
    expect(addRuleHref('sg-1')).toBe('/aws/ec2/security-groups/group/sg-1/add-rule');
    expect(addRuleHref('x/y')).toBe('/aws/ec2/security-groups/group/x%2Fy/add-rule');
  });
});

describe("an instance's name", () => {
  it('is the value of its tag Name, "-" without one or with an empty one', () => {
    expect(instanceName([{ key: 'env', value: 'dev' }, { key: 'Name', value: 'web' }])).toBe('web');
    expect(instanceName([{ key: 'env', value: 'dev' }])).toBe('-');
    expect(instanceName([])).toBe('-');
    expect(instanceName([{ key: 'Name', value: '' }])).toBe('-');
    expect(instanceName([{ key: 'name', value: 'lower' }])).toBe('-');
  });

  it("S3's heading is the name when there is one, else the ID", () => {
    expect(instanceHeading('i-1', [{ key: 'Name', value: 'web' }])).toBe('web');
    expect(instanceHeading('i-1', [])).toBe('i-1');
    expect(instanceHeading('i-1', [{ key: 'Name', value: '' }])).toBe('i-1');
  });
});

describe('the notice words', () => {
  it('are "instances", "security groups", "key pairs"', () => {
    expect([INSTANCES_WORD, SECURITY_GROUPS_WORD, KEY_PAIRS_WORD]).toEqual([
      'instances',
      'security groups',
      'key pairs',
    ]);
  });
});
