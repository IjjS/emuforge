import { describe, expect, it } from 'vitest';

import {
  descriptionText,
  lastActivityText,
  maxSessionDurationText,
  policyArnOf,
  policyNameOfArn,
  policyPath,
  policyTypeText,
  readPolicyDocument,
  rolePath,
  roleTabHref,
  roleTabLabel,
  roleTabOf,
  roleTabPath,
  trustedEntitiesText,
  utcDateText,
} from './format';

// Test criteria, "Unit — providers/aws/area/services/iam/format.test.ts" (issue 82, requirement R4.2, R5.3).

/** A trust policy as the SDK gives it: the JSON text, percent-encoded once. */
function encoded(document: unknown): string {
  return encodeURIComponent(JSON.stringify(document));
}

function trustPolicy(...principals: unknown[]): string {
  return encoded({
    Version: '2012-10-17',
    Statement: principals.map((Principal) => ({ Effect: 'Allow', Principal, Action: 'sts:AssumeRole' })),
  });
}

describe('Trusted entities', () => {
  it('writes a service principal without .amazonaws.com, and one that does not end so whole', () => {
    expect(trustedEntitiesText(trustPolicy({ Service: 'lambda.amazonaws.com' }), '/')).toBe('AWS Service: lambda');
    expect(trustedEntitiesText(trustPolicy({ Service: 'nonsense' }), '/')).toBe('AWS Service: nonsense');
  });

  it('writes every other kind as "<kind>: <value>", and "*" as "*"', () => {
    expect(trustedEntitiesText(trustPolicy({ AWS: 'arn:aws:iam::000000000000:root' }), '/')).toBe(
      'AWS: arn:aws:iam::000000000000:root',
    );
    expect(trustedEntitiesText(trustPolicy({ Federated: 'x' }), '/')).toBe('Federated: x');
    expect(trustedEntitiesText(trustPolicy({ CanonicalUser: 'y' }), '/')).toBe('CanonicalUser: y');
    expect(trustedEntitiesText(trustPolicy('*'), '/')).toBe('*');
  });

  it('writes every principal of two statements in the document’s order, each once', () => {
    const document = trustPolicy(
      { Service: ['b.amazonaws.com', 'a.amazonaws.com'] },
      { AWS: 'z', Service: 'b.amazonaws.com' },
    );

    expect(trustedEntitiesText(document, '/')).toBe('AWS Service: b, AWS Service: a, AWS: z');
  });

  it('ends the cell with " (Service-linked role)" for a role under /aws-service-role/ only', () => {
    const document = trustPolicy({ Service: 'lambda.amazonaws.com' });

    expect(trustedEntitiesText(document, '/aws-service-role/x/')).toBe('AWS Service: lambda (Service-linked role)');
    expect(trustedEntitiesText(document, '/')).not.toContain('Service-linked role');
    expect(trustedEntitiesText(document, '/team/')).not.toContain('Service-linked role');
  });

  it('gives "-" for an empty statement list, a statement without a principal, and a text that is not JSON', () => {
    expect(trustedEntitiesText(encoded({ Version: '2012-10-17', Statement: [] }), '/')).toBe('-');
    expect(
      trustedEntitiesText(encoded({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'x' }] }), '/'),
    ).toBe('-');
    expect(trustedEntitiesText('not json', '/')).toBe('-');
    expect(trustedEntitiesText(undefined, '/')).toBe('-');
  });

  it('reads a trust policy as the SDK gives it, percent-encoded once, as the JSON document it encodes', () => {
    const document = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: 'a+b=c %' } }] };

    expect(readPolicyDocument(encodeURIComponent(JSON.stringify(document)))).toEqual(document);
    expect(trustedEntitiesText(encodeURIComponent(JSON.stringify(document)), '/')).toBe('AWS: a+b=c %');
  });
});

describe('Last activity', () => {
  const now = new Date('2026-11-17T12:00:00.000Z');
  const hoursBefore = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

  it('is "Today" less than a day ago, then "1 day ago" and "<n> days ago"; "-" for no date', () => {
    expect(lastActivityText(hoursBefore(3), now)).toBe('Today');
    expect(lastActivityText(hoursBefore(30), now)).toBe('1 day ago');
    expect(lastActivityText(hoursBefore(5 * 24 + 1), now)).toBe('5 days ago');
    expect(lastActivityText(undefined, now)).toBe('-');
  });
});

describe('Maximum session duration', () => {
  it('writes whole hours as hours and anything else in seconds; "-" when missing', () => {
    expect(maxSessionDurationText(3600)).toBe('1 hour');
    expect(maxSessionDurationText(7200)).toBe('2 hours');
    expect(maxSessionDurationText(43200)).toBe('12 hours');
    expect(maxSessionDurationText(5400)).toBe('5400 seconds');
    expect(maxSessionDurationText(undefined)).toBe('-');
  });
});

describe('Creation date', () => {
  it('writes YYYY-MM-DD HH:MM:SS UTC whatever the machine’s time zone; "-" when missing', () => {
    const date = new Date('2026-11-17T09:05:03.500Z');
    const zone = process.env.TZ;
    try {
      for (const timeZone of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
        process.env.TZ = timeZone;
        expect(utcDateText(date)).toBe('2026-11-17 09:05:03 UTC');
      }
    } finally {
      process.env.TZ = zone;
    }
    expect(utcDateText(undefined)).toBe('-');
  });
});

describe('Policy type', () => {
  it('is "AWS managed" for an ARN of the account aws, "Customer managed" for another, "Customer inline" inline', () => {
    expect(
      policyTypeText({ kind: 'managed', name: 'ReadOnlyAccess', arn: 'arn:aws:iam::aws:policy/ReadOnlyAccess' }),
    ).toBe('AWS managed');
    expect(policyTypeText({ kind: 'managed', name: 'x', arn: 'arn:aws:iam::000000000000:policy/x' })).toBe(
      'Customer managed',
    );
    expect(policyTypeText({ kind: 'inline', name: 'inline-one' })).toBe('Customer inline');
  });
});

describe('Description', () => {
  it('is "-" when empty or missing, and the text as it came otherwise', () => {
    expect(descriptionText('')).toBe('-');
    expect(descriptionText(undefined)).toBe('-');
    expect(descriptionText('  <b>a role</b> ')).toBe('  <b>a role</b> ');
  });
});

describe('routes', () => {
  it('puts a role’s name in one percent-encoded path segment', () => {
    expect(rolePath('a+b=c,.@_-')).toBe('/aws/iam/roles/details/a%2Bb%3Dc%2C.%40_-');
    expect(rolePath('create')).toBe('/aws/iam/roles/details/create');
    expect(roleTabPath('x', 'trust-relationships')).toBe('/aws/iam/roles/details/x/trust-relationships');
  });
});

// Test criteria, "Unit s1 — providers/aws/area/services/iam/format.test.ts" (issue 535).
describe("the tabs of a role's page", () => {
  it('reads the tab of a query value: trust is "Trust relationships", none, empty or any other "Permissions"', () => {
    expect(roleTabLabel(roleTabOf('trust'))).toBe('Trust relationships');
    for (const value of [null, undefined, '', 'permissions', 'tags', 'Trust', 'trust-relationships']) {
      expect(roleTabLabel(roleTabOf(value)), String(value)).toBe('Permissions');
    }
  });

  it('addresses "Permissions" by the role\'s path and the other with ?tab=trust, the name encoded once', () => {
    expect(roleTabHref('my-role', 'permissions')).toBe('/aws/iam/roles/details/my-role');
    expect(roleTabHref('my-role', 'trust')).toBe('/aws/iam/roles/details/my-role?tab=trust');
    expect(roleTabHref('a+b=c,.@_-', 'trust')).toBe('/aws/iam/roles/details/a%2Bb%3Dc%2C.%40_-?tab=trust');
    expect(roleTabHref('a%b', 'permissions')).toBe('/aws/iam/roles/details/a%25b');
  });
});

describe("a policy's address", () => {
  it('holds the ARN encoded once in ?arn=, read back the same, for an ARN with a path', () => {
    const arn = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';
    const address = policyPath(arn);
    expect(address).toBe(
      '/aws/iam/policies/details?arn=arn%3Aaws%3Aiam%3A%3Aaws%3Apolicy%2Fservice-role%2FAWSLambdaBasicExecutionRole',
    );
    const url = new URL(address, 'http://127.0.0.1');
    expect(url.pathname).toBe('/aws/iam/policies/details');
    expect(policyArnOf(url.searchParams)).toBe(arn);
    expect(policyArnOf(url.search)).toBe(arn);
    const plus = 'arn:aws:iam::000000000000:policy/a+b=c,.@_-';
    expect(policyArnOf(new URL(policyPath(plus), 'http://127.0.0.1').searchParams)).toBe(plus);
  });

  it('reads no ARN from an address without one', () => {
    expect(policyArnOf('')).toBeUndefined();
    expect(policyArnOf('?arn=')).toBeUndefined();
  });

  it("names a policy by the ARN's text after its last /", () => {
    expect(policyNameOfArn('arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')).toBe(
      'AWSLambdaBasicExecutionRole',
    );
    expect(policyNameOfArn('arn:aws:iam::000000000000:policy/mine')).toBe('mine');
  });
});
