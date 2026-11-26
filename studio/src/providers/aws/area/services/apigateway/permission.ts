import { RequestError, refusalMessage, type RequestFailure } from '../../../../../lib/aws/request';
import { ADD_PERMISSION, GET_POLICY, addPermission, readPolicy } from './lambda-api';

const action = 'lambda:InvokeFunction';
const principal = 'apigateway.amazonaws.com';

export function permissionInput(apiId: string, functionArn: string) {
  const [, , , region, account] = functionArn.split(':');
  return {
    FunctionName: functionArn,
    Action: action,
    Principal: principal,
    SourceArn: `arn:aws:execute-api:${region}:${account}:${apiId}/*/*/*`,
    StatementId: `emuforge-apigateway-${apiId}`,
  };
}

function fields(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function allowsApi(value: unknown, statementId: string, sourceArn: string) {
  const statement = fields(value);
  const condition = fields(statement.Condition);
  const operator = Object.keys(condition)[0];
  const check = operator === undefined ? {} : fields(condition[operator]);
  return (
    statement.Sid === statementId &&
    statement.Effect === 'Allow' &&
    statement.Action === action &&
    fields(statement.Principal).Service === principal &&
    (operator === 'ArnLike' || operator === 'ArnEquals') &&
    Object.keys(condition).length === 1 &&
    Object.keys(check).length === 1 &&
    check['AWS:SourceArn'] === sourceArn
  );
}

export function operationReason(failure: RequestFailure): string {
  const message = refusalMessage(failure);
  switch (failure.kind) {
    case 'other':
      return message ? `${failure.code}: ${message}` : failure.code;
    case 'not-implemented':
      return '501 Not Implemented';
    case 'access-denied':
      return message || 'Access denied';
    case 'emulator-did-not-answer':
      return message || 'The emulator did not answer.';
    case 'engine-did-not-answer':
      return 'The EmuForge engine did not answer.';
  }
}

export type PermissionOutcome = { kind: 'given' } | { kind: 'not-given'; reason: string; failure?: RequestFailure };

export async function allowApiInvocation(
  endpoint: string,
  apiId: string,
  functionArn: string,
  signal: AbortSignal,
): Promise<PermissionOutcome> {
  const input = permissionInput(apiId, functionArn);
  try {
    await addPermission(endpoint, input, signal);
    return { kind: 'given' };
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    const { failure } = error;
    if (failure.kind !== 'other' || failure.code !== 'ResourceConflictException') {
      return { kind: 'not-given', reason: `${ADD_PERMISSION}: ${operationReason(failure)}`, failure };
    }
  }

  try {
    const statements = await readPolicy(endpoint, functionArn, signal);
    return statements?.some((statement) => allowsApi(statement, input.StatementId, input.SourceArn))
      ? { kind: 'given' }
      : { kind: 'not-given', reason: `a statement named ${input.StatementId} exists and does not allow this API` };
  } catch (error) {
    if (error instanceof RequestError) {
      return { kind: 'not-given', reason: `${GET_POLICY}: ${operationReason(error.failure)}`, failure: error.failure };
    }
    if (signal.aborted) throw error;
    return { kind: 'not-given', reason: `${GET_POLICY}: the function's policy could not be parsed` };
  }
}
