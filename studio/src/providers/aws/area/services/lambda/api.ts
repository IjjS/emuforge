import {
  AttachRolePolicyCommand,
  CreateRoleCommand,
  IAMClient,
  ListRolesCommand,
  type ListRolesCommandOutput,
} from '@aws-sdk/client-iam';
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  type GetFunctionCommandOutput,
  GetFunctionUrlConfigCommand,
  type GetFunctionUrlConfigCommandOutput,
  LambdaClient,
  ListFunctionsCommand,
  type ListFunctionsCommandOutput,
} from '@aws-sdk/client-lambda';

import { createAwsClient, EngineSessionError } from '../../../../../lib/aws/client-factory';
import { cutAtText, firstPageMarker } from './marker';
import { starterCode } from './starter-code';
import { storedZip } from './zip';

// The Lambda calls of the AWS area (issue 84, requirement R2, R4, R5, R6, R7, R10), and the three IAM calls of the
// create form (question 10: made here, through an IAM client of the factory, until the IAM screens' issue moves what
// is shared). Every call goes through the engine; each answer is mapped to plain typed results, every value as the
// emulator returned it and each one untrusted text.

// ---------------------------------------------------------------------------------------------------------------
// Results

/** One function of a `ListFunctions` answer. A value the answer did not give is absent. */
export interface FunctionSummary {
  name: string;
  /** `Description`; absent when empty (the emulator answers `""` for none). */
  description?: string;
  /** `PackageType`, as it came ("Zip", "Image"). */
  packageType?: string;
  /** `Runtime`, the API's identifier; an image function has none. */
  runtime?: string;
  /** `LastModified`: the instant it names, or the text as it came when it names none. */
  lastModified?: Date | string;
  /** The answer carried `DurableConfig`. */
  durable: boolean;
}

/** One page of the function list, in the answer's order. */
export interface FunctionPage {
  functions: FunctionSummary[];
  /** The marker of the next page: more functions remain after this page. */
  nextMarker?: string;
}

/** What one page is asked with. */
export interface FunctionPageRequest {
  /** `MaxItems`. */
  pageSize: number;
  /** `Marker`, the `NextMarker` of the page before; absent for a first page. */
  marker?: string;
  /**
   * The filter's text (R4.7): a first page is asked with the marker just below it, and every page is cut at the
   * first name that does not start with it. Absent or `''` for no filter.
   */
  filter?: string;
}

/** "Function URL" of a function's page (R5.3). */
export type FunctionUrl =
  | { kind: 'url'; url: string }
  /** `GetFunctionUrlConfig` answered `ResourceNotFoundException`: the function has no URL. */
  | { kind: 'none' }
  /** `GetFunctionUrlConfig` answered 501. */
  | { kind: 'not-implemented' }
  /** `GetFunctionUrlConfig` failed in any other way. */
  | { kind: 'not-read' };

/** A function as its page shows it. Holds neither `Code.Location` nor the environment variables (R11). */
export interface LambdaFunction extends FunctionSummary {
  arn?: string;
  handler?: string;
  architectures?: string[];
  /** `State`: `Pending`, `Active`, `Inactive`, `Failed`. */
  state?: string;
  stateReason?: string;
  /** `LastUpdateStatus`: `Successful`, `InProgress`, `Failed`. */
  lastUpdateStatus?: string;
  lastUpdateStatusReason?: string;
  url: FunctionUrl;
}

/** A function's page read: the function, or "not found" (`ResourceNotFoundException` of `GetFunction`, R5.6). */
export type FunctionRead = { found: true; function: LambdaFunction } | { found: false };

/** One role of an IAM `ListRoles` answer. */
export interface Role {
  name: string;
  arn: string;
  path?: string;
}

export interface RolePage {
  roles: Role[];
  /** The answer's `Marker`, only when it said `IsTruncated`. */
  nextMarker?: string;
}

/** Why a request failed, one kind per state of R10.1 and R10.3 that the answer alone decides. */
export type LambdaFailure =
  /** HTTP 501: the emulator does not implement the operation. */
  | { kind: 'not-implemented'; operation: string }
  /** `AccessDenied`, with the message returned. */
  | { kind: 'access-denied'; operation: string; message: string }
  /** The engine's `EmulatorUnavailable` or `EmulatorTimeout`, with the engine's message as it came. */
  | { kind: 'emulator-did-not-answer'; operation: string; message: string }
  /** No answer came from the engine: the request, or the session request before it, failed at the network level. */
  | { kind: 'engine-did-not-answer'; operation: string }
  /** Any other answer: its code, or its status line when it has none, and its message when it has one. */
  | { kind: 'other'; operation: string; code: string; message?: string };

/** A request that failed; carries what the answer said, nothing else. */
export class LambdaRequestError extends Error {
  readonly failure: LambdaFailure;

  constructor(failure: LambdaFailure) {
    super(`${failure.operation} failed: ${failure.kind}.`);
    this.name = 'LambdaRequestError';
    this.failure = failure;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Operations, as a failure names them

export const LIST_FUNCTIONS = 'ListFunctions';
export const GET_FUNCTION = 'GetFunction';
export const GET_FUNCTION_URL_CONFIG = 'GetFunctionUrlConfig';
export const CREATE_FUNCTION = 'CreateFunction';
export const DELETE_FUNCTION = 'DeleteFunction';
export const LIST_ROLES = 'ListRoles';
export const CREATE_ROLE = 'CreateRole';
export const ATTACH_ROLE_POLICY = 'AttachRolePolicy';

// ---------------------------------------------------------------------------------------------------------------
// Clients

const lambdaClients = new Map<string, LambdaClient>();
const iamClients = new Map<string, IAMClient>();

/**
 * The area's Lambda client for the engine at `endpoint`, one per endpoint for the life of the page. It sets no
 * protocol: the engine relays the client's own (R2, "The client's protocol and the engine").
 */
export function lambdaClient(endpoint: string): LambdaClient {
  let client = lambdaClients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(LambdaClient, { endpoint });
    lambdaClients.set(endpoint, client);
  }
  return client;
}

/** The area's IAM client for the engine at `endpoint`, one per endpoint for the life of the page. */
export function iamClient(endpoint: string): IAMClient {
  let client = iamClients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(IAMClient, { endpoint });
    iamClients.set(endpoint, client);
  }
  return client;
}

// ---------------------------------------------------------------------------------------------------------------
// Failures

/** The engine's two answers for an emulator that cannot be reached or does not answer in time. */
const EMULATOR_SILENT: ReadonlySet<string> = new Set(['EmulatorUnavailable', 'EmulatorTimeout']);

/** IAM's code, and Lambda's own for the same refusal. */
const ACCESS_DENIED: ReadonlySet<string> = new Set(['AccessDenied', 'AccessDeniedException']);

const NOT_FOUND = 'ResourceNotFoundException';

// What the SDK names an error answer that carried no code: the status as text, or one of these.
const NO_CODE = /^(\d+|Unknown|UnknownError)$/;

interface ErrorAnswer {
  name?: unknown;
  /** The code as the answer wrote it, for the query protocol: the SDK names a modeled error by its class instead. */
  Code?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  $response?: { reason?: unknown };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function errorAnswer(error: unknown): ErrorAnswer {
  return (typeof error === 'object' && error !== null ? error : {}) as ErrorAnswer;
}

/** The answer's code as it came; `undefined` for an answer without one. */
function answerCode(answer: ErrorAnswer): string | undefined {
  const name = text(answer.Code) ?? text(answer.name);
  return name === undefined || NO_CODE.test(name) ? undefined : name;
}

function failureOf(operation: string, error: unknown): LambdaFailure {
  if (error instanceof EngineSessionError) {
    return error.reason === 'unreachable'
      ? { kind: 'engine-did-not-answer', operation }
      : { kind: 'other', operation, code: error.code ?? `HTTP ${String(error.status)}` };
  }
  const answer = errorAnswer(error);
  const status = answer.$metadata?.httpStatusCode;
  if (typeof status !== 'number') {
    return { kind: 'engine-did-not-answer', operation };
  }
  if (status === 501) {
    return { kind: 'not-implemented', operation };
  }
  const code = answerCode(answer);
  const message = code === undefined ? undefined : text(answer.message);
  if (code !== undefined && ACCESS_DENIED.has(code)) {
    return { kind: 'access-denied', operation, message: message ?? '' };
  }
  if (code !== undefined && EMULATOR_SILENT.has(code)) {
    return { kind: 'emulator-did-not-answer', operation, message: message ?? '' };
  }
  if (code === undefined) {
    const reason = text(answer.$response?.reason);
    return {
      kind: 'other',
      operation,
      code: reason === undefined ? `HTTP ${String(status)}` : `HTTP ${String(status)} ${reason}`,
    };
  }
  return message === undefined ? { kind: 'other', operation, code } : { kind: 'other', operation, code, message };
}

function isNotFound(error: unknown): boolean {
  const answer = errorAnswer(error);
  return typeof answer.$metadata?.httpStatusCode === 'number' && answerCode(answer) === NOT_FOUND;
}

/** `pending`, unless `signal` aborts first: then its reason, at once. */
function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

/**
 * Sends one command and gives its answer, its rejection as the SDK gave it, or `signal`'s reason once it aborts.
 * Nothing after an abort reaches the caller.
 */
async function sent<T>(send: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const pending = send(signal);
  // Its rejection after an abort is the abort's, already given to the caller.
  pending.catch(() => undefined);
  try {
    return await untilAborted(pending, signal);
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw error;
  }
}

/** As `sent`, with a failure of the answer mapped to `LambdaRequestError` for `operation`. */
async function request<T>(operation: string, send: (signal: AbortSignal) => Promise<T>, signal: AbortSignal) {
  try {
    return await sent(send, signal);
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw new LambdaRequestError(failureOf(operation, error));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The function list (R4.1, R4.2, R4.4, R4.7)

// `2026-11-17T02:22:16.474+0000`, as the emulator writes `LastModified`; a `Z` or `+hh:mm` offset is taken as well.
const LAST_MODIFIED = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)(Z|[+-]\d{2}:?\d{2})$/;

function lastModified(value: unknown): Date | string | undefined {
  const given = text(value);
  if (given === undefined) {
    return undefined;
  }
  const parts = LAST_MODIFIED.exec(given);
  if (parts === null) {
    return given;
  }
  const [, local = '', zone = ''] = parts;
  const offset = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const date = new Date(`${local}${offset}`);
  return Number.isNaN(date.getTime()) ? given : date;
}

type ListedFunction = NonNullable<ListFunctionsCommandOutput['Functions']>[number];

function toSummary(item: ListedFunction): FunctionSummary {
  const summary: FunctionSummary = { name: item.FunctionName ?? '', durable: item.DurableConfig !== undefined };
  const description = text(item.Description);
  if (description !== undefined) {
    summary.description = description;
  }
  const packageType = text(item.PackageType);
  if (packageType !== undefined) {
    summary.packageType = packageType;
  }
  const runtime = text(item.Runtime);
  if (runtime !== undefined) {
    summary.runtime = runtime;
  }
  const modified = lastModified(item.LastModified);
  if (modified !== undefined) {
    summary.lastModified = modified;
  }
  return summary;
}

/**
 * One page of the emulator's functions, read through the engine at `endpoint` with `ListFunctions`. With a filter,
 * a first page starts at the marker just below the text and every page ends at the first name that does not start
 * with it; a text that matches nothing by its form gives an empty page and sends nothing. Rejects with
 * `LambdaRequestError` for a failed read, and with `signal`'s reason, and nothing else, once it aborts.
 */
export async function listFunctions(
  endpoint: string,
  { pageSize, marker, filter }: FunctionPageRequest,
  signal: AbortSignal,
): Promise<FunctionPage> {
  signal.throwIfAborted();
  const text_ = filter ?? '';
  let start = marker;
  if (text_ !== '') {
    const below = firstPageMarker(text_);
    if (below === undefined) {
      return { functions: [] };
    }
    start ??= below;
  }
  const client = lambdaClient(endpoint);
  const command = new ListFunctionsCommand({
    MaxItems: pageSize,
    ...(start === undefined ? {} : { Marker: start }),
  });
  const output = await request(LIST_FUNCTIONS, (abortSignal) => client.send(command, { abortSignal }), signal);
  const all = (output.Functions ?? []).map(toSummary);
  const { kept, cut } = text_ === '' ? { kept: all, cut: false } : cutAtText(all, text_);
  const page: FunctionPage = { functions: kept };
  const next = text(output.NextMarker);
  if (next !== undefined && !cut) {
    page.nextMarker = next;
  }
  return page;
}

// ---------------------------------------------------------------------------------------------------------------
// A function's page (R5.1, R5.3, R5.5)

function toFunction(output: GetFunctionCommandOutput, url: FunctionUrl): LambdaFunction {
  const configuration = output.Configuration ?? {};
  const fn: LambdaFunction = { ...toSummary(configuration as ListedFunction), url };
  const optional: [keyof LambdaFunction, unknown][] = [
    ['arn', configuration.FunctionArn],
    ['handler', configuration.Handler],
    ['state', configuration.State],
    ['stateReason', configuration.StateReason],
    ['lastUpdateStatus', configuration.LastUpdateStatus],
    ['lastUpdateStatusReason', configuration.LastUpdateStatusReason],
  ];
  for (const [key, value] of optional) {
    const given = text(value);
    if (given !== undefined) {
      Object.assign(fn, { [key]: given });
    }
  }
  const architectures = (configuration.Architectures ?? []).flatMap((value: unknown) => {
    const given = text(value);
    return given === undefined ? [] : [given];
  });
  if (architectures.length > 0) {
    fn.architectures = architectures;
  }
  return fn;
}

function toUrl(output: GetFunctionUrlConfigCommandOutput): FunctionUrl {
  const url = text(output.FunctionUrl);
  return url === undefined ? { kind: 'none' } : { kind: 'url', url };
}

function urlFailure(error: unknown): FunctionUrl {
  if (isNotFound(error)) {
    return { kind: 'none' };
  }
  return errorAnswer(error).$metadata?.httpStatusCode === 501 ? { kind: 'not-implemented' } : { kind: 'not-read' };
}

/**
 * The function named `name`, read through the engine at `endpoint` with `GetFunction` and, beside it,
 * `GetFunctionUrlConfig`. "Not found" when `GetFunction` answers `ResourceNotFoundException`; a failure of
 * `GetFunctionUrlConfig` only marks the URL. Rejects with `LambdaRequestError` for any other failure of
 * `GetFunction`, and with `signal`'s reason, and nothing else, once it aborts.
 */
export async function readFunction(endpoint: string, name: string, signal: AbortSignal): Promise<FunctionRead> {
  signal.throwIfAborted();
  const client = lambdaClient(endpoint);
  const get = sent(
    (abortSignal) => client.send(new GetFunctionCommand({ FunctionName: name }), { abortSignal }),
    signal,
  );
  const url = sent(
    (abortSignal) => client.send(new GetFunctionUrlConfigCommand({ FunctionName: name }), { abortSignal }),
    signal,
  ).then(toUrl, urlFailure);
  // Each settles before the answer is given, so neither rejects unseen.
  const [read, urlRead] = await Promise.allSettled([get, url]);
  if (signal.aborted) {
    throw signal.reason;
  }
  if (read.status === 'rejected') {
    if (isNotFound(read.reason)) {
      return { found: false };
    }
    throw new LambdaRequestError(failureOf(GET_FUNCTION, read.reason));
  }
  return {
    found: true,
    function: toFunction(read.value, urlRead.status === 'fulfilled' ? urlRead.value : { kind: 'not-read' }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The roles of "Existing role" (R6.2)

/** The size of one page of roles. */
export const ROLE_PAGE_SIZE = 50;

/**
 * One page of the emulator's IAM roles, through the engine at `endpoint` with `ListRoles`, from `marker` when given.
 * Rejects with `LambdaRequestError` for a failed read, and with `signal`'s reason once it aborts.
 */
export async function listRoles(endpoint: string, marker: string | undefined, signal: AbortSignal): Promise<RolePage> {
  signal.throwIfAborted();
  const client = iamClient(endpoint);
  const command = new ListRolesCommand({
    MaxItems: ROLE_PAGE_SIZE,
    ...(marker === undefined ? {} : { Marker: marker }),
  });
  const output: ListRolesCommandOutput = await request(
    LIST_ROLES,
    (abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  const roles = (output.Roles ?? []).map(({ RoleName, Arn, Path }) => {
    const role: Role = { name: RoleName ?? '', arn: Arn ?? '' };
    const path = text(Path);
    if (path !== undefined) {
      role.path = path;
    }
    return role;
  });
  const page: RolePage = { roles };
  const next = text(output.Marker);
  if (output.IsTruncated === true && next !== undefined) {
    page.nextMarker = next;
  }
  return page;
}

// ---------------------------------------------------------------------------------------------------------------
// "Create Event Function" (R6.5)

/** The managed policy the user guide names for the default role (`lambda-intro-execution-role`). */
export const BASIC_EXECUTION_POLICY = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';

/** The path of a default role. */
export const SERVICE_ROLE_PATH = '/service-role/';

/** The trust policy of a default role: Lambda may assume it. */
export const LAMBDA_TRUST_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
});

const ROLE_NAME_MAX = 64;
const ROLE_SUFFIX = '-role-';
const ROLE_RANDOM_LENGTH = 8;
const ROLE_RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `<function name>-role-<8 of a-z0-9>`, the function name cut at its start's end so the whole has at most 64. */
export function defaultRoleName(functionName: string): string {
  const random = crypto.getRandomValues(new Uint8Array(ROLE_RANDOM_LENGTH));
  // 252 is the largest multiple of 36 below 256: a byte of 252 or more would weigh the first letters; it is drawn
  // again, so every character is equally likely.
  const characters: string[] = [];
  let bytes = random;
  while (characters.length < ROLE_RANDOM_LENGTH) {
    for (const byte of bytes) {
      if (byte < 252 && characters.length < ROLE_RANDOM_LENGTH) {
        characters.push(ROLE_RANDOM_ALPHABET[byte % ROLE_RANDOM_ALPHABET.length] ?? 'a');
      }
    }
    bytes = crypto.getRandomValues(new Uint8Array(ROLE_RANDOM_LENGTH));
  }
  const keep = ROLE_NAME_MAX - ROLE_SUFFIX.length - ROLE_RANDOM_LENGTH;
  return `${functionName.slice(0, keep)}${ROLE_SUFFIX}${characters.join('')}`;
}

/** A role "Create default role" made in the emulator for a function, and how far its creation got. */
export interface CreatedRole {
  /** The function name it was made for; it is reused only for that name. */
  functionName: string;
  name: string;
  arn: string;
  /** `AttachRolePolicy` succeeded for it. */
  policyAttached: boolean;
}

export type ExecutionRole =
  /** "Create default role"; `created` is the role an earlier attempt left, if any. */
  | { kind: 'default'; created?: CreatedRole | undefined }
  /** "Use another role": the chosen role's ARN. */
  | { kind: 'existing'; arn: string };

export interface CreateFunctionRequest {
  name: string;
  /** One of the runtimes the form offers (`starter-code.ts`). */
  runtime: string;
  /** `x86_64` or `arm64`. */
  architecture: string;
  role: ExecutionRole;
}

export interface CreatedFunction {
  name: string;
  /** The name of the role "Create default role" made or reused; absent with an existing role. */
  roleName?: string;
}

/** What failed: the words R10.3 gives the action ("{what} failed"). */
export type CreateStep = 'Creating the role' | 'Creating the function';

/** "Create Event Function" failed; names the step, and the role left in the emulator when one was created. */
export class CreateFunctionError extends Error {
  readonly step: CreateStep;
  readonly failure: LambdaFailure;
  /** The role the emulator holds for this function name although the function was not created. */
  readonly createdRole: CreatedRole | undefined;

  constructor(step: CreateStep, failure: LambdaFailure, createdRole: CreatedRole | undefined) {
    super(`${step} failed: ${failure.kind}.`);
    this.name = 'CreateFunctionError';
    this.step = step;
    this.failure = failure;
    this.createdRole = createdRole;
  }
}

async function step<T>(
  what: CreateStep,
  createdRole: CreatedRole | undefined,
  run: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    const failure = error instanceof LambdaRequestError ? error.failure : failureOf(what, error);
    throw new CreateFunctionError(what, failure, createdRole);
  }
}

/**
 * Creates a function with the starter code of its runtime through the engine at `endpoint` (R6.5). With "Create
 * default role": `CreateRole`, then `AttachRolePolicy`, then `CreateFunction`, each after the previous one's answer;
 * a role an earlier attempt created for the same function name is reused, and its policy attached again unless that
 * already succeeded. Rejects with `CreateFunctionError` naming the step that failed and any role left, and with
 * `signal`'s reason once it aborts.
 */
export async function createFunction(
  endpoint: string,
  { name, runtime, architecture, role }: CreateFunctionRequest,
  signal: AbortSignal,
): Promise<CreatedFunction> {
  signal.throwIfAborted();
  const code = starterCode(runtime);
  if (code === undefined) {
    throw new Error(`Studio has no starter code for the runtime "${runtime}".`);
  }
  const lambda = lambdaClient(endpoint);

  let roleArn: string;
  let createdRole: CreatedRole | undefined;
  if (role.kind === 'existing') {
    roleArn = role.arn;
  } else {
    const iam = iamClient(endpoint);
    createdRole = role.created?.functionName === name ? role.created : undefined;
    if (createdRole === undefined) {
      const roleName = defaultRoleName(name);
      const output = await step(
        'Creating the role',
        undefined,
        () =>
          request(
            CREATE_ROLE,
            (abortSignal) =>
              iam.send(
                new CreateRoleCommand({
                  RoleName: roleName,
                  Path: SERVICE_ROLE_PATH,
                  AssumeRolePolicyDocument: LAMBDA_TRUST_POLICY,
                }),
                { abortSignal },
              ),
            signal,
          ),
        signal,
      );
      createdRole = {
        functionName: name,
        name: text(output.Role?.RoleName) ?? roleName,
        arn: output.Role?.Arn ?? '',
        policyAttached: false,
      };
    }
    if (!createdRole.policyAttached) {
      const toAttach: CreatedRole = createdRole;
      await step(
        'Creating the role',
        toAttach,
        () =>
          request(
            ATTACH_ROLE_POLICY,
            (abortSignal) =>
              iam.send(new AttachRolePolicyCommand({ RoleName: toAttach.name, PolicyArn: BASIC_EXECUTION_POLICY }), {
                abortSignal,
              }),
            signal,
          ),
        signal,
      );
      createdRole = { ...toAttach, policyAttached: true };
    }
    roleArn = createdRole.arn;
  }

  const command = new CreateFunctionCommand({
    FunctionName: name,
    Runtime: runtime as NonNullable<CreateFunctionCommand['input']['Runtime']>,
    Architectures: [architecture as NonNullable<CreateFunctionCommand['input']['Architectures']>[number]],
    Role: roleArn,
    Handler: code.handler,
    Code: { ZipFile: storedZip(code.fileName, code.text) },
  });
  await step(
    'Creating the function',
    createdRole,
    () => request(CREATE_FUNCTION, (abortSignal) => lambda.send(command, { abortSignal }), signal),
    signal,
  );
  return createdRole === undefined ? { name } : { name, roleName: createdRole.name };
}

// ---------------------------------------------------------------------------------------------------------------
// Delete (R7)

export interface DeleteResult {
  /** The names deleted, in the order of the request. */
  deleted: string[];
  /** The names whose `DeleteFunction` failed, each with its failure. */
  failed: { name: string; failure: LambdaFailure }[];
}

/**
 * Deletes `names` through the engine at `endpoint`: one `DeleteFunction` per name, in their order, each after the
 * previous one's answer; a failure does not stop the ones after it. Rejects only with `signal`'s reason once it
 * aborts.
 */
export async function deleteFunctions(
  endpoint: string,
  names: readonly string[],
  signal: AbortSignal,
): Promise<DeleteResult> {
  signal.throwIfAborted();
  const client = lambdaClient(endpoint);
  const result: DeleteResult = { deleted: [], failed: [] };
  for (const name of names) {
    try {
      await request(
        DELETE_FUNCTION,
        (abortSignal) => client.send(new DeleteFunctionCommand({ FunctionName: name }), { abortSignal }),
        signal,
      );
      result.deleted.push(name);
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason;
      }
      const failure = error instanceof LambdaRequestError ? error.failure : failureOf(DELETE_FUNCTION, error);
      result.failed.push({ name, failure });
    }
  }
  return result;
}
