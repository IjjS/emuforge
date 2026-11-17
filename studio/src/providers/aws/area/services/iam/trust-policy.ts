// The trust policy "Create role" sends (issue 82, requirement R6.3), built from what step 1 holds.

const POLICY_VERSION = '2012-10-17';
const ASSUME_ROLE = 'sts:AssumeRole';

/** What step 1, "Trusted entity type", holds for the type chosen. */
export type TrustedEntity =
  /** "AWS service": the service's principal, as typed. */
  | { type: 'aws-service'; principal: string }
  /** "AWS account": the account, and the two boxes; `externalId` only while "Require external ID" is checked. */
  | { type: 'aws-account'; account: string; externalId?: string; requireMfa: boolean }
  /** "Custom trust policy": the document as typed. */
  | { type: 'custom'; document: string };

interface Statement {
  Effect: 'Allow';
  Principal: Record<string, string>;
  Action: string;
  Condition?: Record<string, Record<string, string>>;
}

interface PolicyDocument {
  Version: string;
  Statement: Statement[];
}

function statementOf(entity: Exclude<TrustedEntity, { type: 'custom' }>): Statement {
  if (entity.type === 'aws-service') {
    return { Effect: 'Allow', Principal: { Service: entity.principal }, Action: ASSUME_ROLE };
  }
  const statement: Statement = {
    Effect: 'Allow',
    Principal: { AWS: `arn:aws:iam::${entity.account}:root` },
    Action: ASSUME_ROLE,
  };
  const condition: Record<string, Record<string, string>> = {};
  if (entity.externalId !== undefined) {
    condition.StringEquals = { 'sts:ExternalId': entity.externalId };
  }
  if (entity.requireMfa) {
    condition.Bool = { 'aws:MultiFactorAuthPresent': 'true' };
  }
  if (Object.keys(condition).length > 0) {
    statement.Condition = condition;
  }
  return statement;
}

function formatted(document: unknown): string {
  return JSON.stringify(document, null, 2);
}

/**
 * The trust policy as the text `CreateRole` sends and step 3 shows: for "AWS service" and "AWS account" one statement
 * that allows `sts:AssumeRole`, formatted on several lines; for "Custom trust policy" the document exactly as typed.
 */
export function trustPolicyText(entity: TrustedEntity): string {
  if (entity.type === 'custom') {
    return entity.document;
  }
  const document: PolicyDocument = { Version: POLICY_VERSION, Statement: [statementOf(entity)] };
  return formatted(document);
}

/** "Custom trust policy" at start: a document that allows nothing, on several lines. */
export const INITIAL_CUSTOM_TRUST_POLICY = formatted({ Version: POLICY_VERSION, Statement: [] });

/** The account of an ARN (its fifth field), as "This account" takes it from `GetUser`; `undefined` when it has none. */
export function accountOfArn(arn: string | undefined): string | undefined {
  const parts = arn?.split(':');
  if (parts === undefined || parts.length < 6 || parts[0] !== 'arn') {
    return undefined;
  }
  const account = parts[4];
  return account === undefined || account === '' ? undefined : account;
}
