import { describe, expect, it } from 'vitest';

import { accountOfArn, INITIAL_CUSTOM_TRUST_POLICY, trustPolicyText, type TrustedEntity } from './trust-policy';

// Test criteria, "Unit — providers/aws/area/services/iam/trust-policy.test.ts" (issue 82, requirement R6.3).

function sent(entity: TrustedEntity): unknown {
  return JSON.parse(trustPolicyText(entity)) as unknown;
}

describe('the trust policy the wizard sends', () => {
  it('allows sts:AssumeRole to the service for "AWS service", without a condition', () => {
    expect(sent({ type: 'aws-service', principal: 'lambda.amazonaws.com' })).toStrictEqual({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    });
  });

  it('allows sts:AssumeRole to the account’s root for "AWS account" with no box checked, without a condition', () => {
    expect(sent({ type: 'aws-account', account: '000000000000', requireMfa: false })).toStrictEqual({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::000000000000:root' }, Action: 'sts:AssumeRole' }],
    });
  });

  it('adds a condition for "Require external ID", for "Require MFA", and both members for both', () => {
    const condition = (entity: TrustedEntity) =>
      (sent(entity) as { Statement: { Condition?: unknown }[] }).Statement[0]?.Condition;

    expect(
      condition({ type: 'aws-account', account: '000000000000', externalId: 'abc', requireMfa: false }),
    ).toStrictEqual({ StringEquals: { 'sts:ExternalId': 'abc' } });
    expect(condition({ type: 'aws-account', account: '000000000000', requireMfa: true })).toStrictEqual({
      Bool: { 'aws:MultiFactorAuthPresent': 'true' },
    });
    expect(
      condition({ type: 'aws-account', account: '000000000000', externalId: 'abc', requireMfa: true }),
    ).toStrictEqual({ StringEquals: { 'sts:ExternalId': 'abc' }, Bool: { 'aws:MultiFactorAuthPresent': 'true' } });
  });

  it('sends a custom trust policy as typed, its content unchanged', () => {
    const typed = '{ "Version":"2012-10-17",\n  "Statement": [ {"Effect":"Deny"} ] }';

    expect(trustPolicyText({ type: 'custom', document: typed })).toBe(typed);
  });
});

describe('the caller’s account', () => {
  it('is the account of an ARN, and none for an ARN without one', () => {
    expect(accountOfArn('arn:aws:iam::000000000000:user/emulator')).toBe('000000000000');
    expect(accountOfArn('arn:aws:s3:::bucket')).toBeUndefined();
    expect(accountOfArn(undefined)).toBeUndefined();
  });
});

describe('the custom policy at start', () => {
  it('is {"Version": "2012-10-17", "Statement": []} on several lines', () => {
    expect(JSON.parse(INITIAL_CUSTOM_TRUST_POLICY)).toStrictEqual({ Version: '2012-10-17', Statement: [] });
    expect(INITIAL_CUSTOM_TRUST_POLICY.split('\n').length).toBeGreaterThan(1);
  });
});
