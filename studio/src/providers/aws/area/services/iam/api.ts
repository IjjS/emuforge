import {
  AttachRolePolicyCommand,
  CreatePolicyCommand,
  CreatePolicyVersionCommand,
  CreateRoleCommand,
  DeletePolicyCommand,
  DeletePolicyVersionCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  DeleteServiceLinkedRoleCommand,
  DetachGroupPolicyCommand,
  DetachRolePolicyCommand,
  DetachUserPolicyCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  GetRoleCommand,
  GetRolePolicyCommand,
  GetUserCommand,
  IAMClient,
  ListAttachedRolePoliciesCommand,
  ListEntitiesForPolicyCommand,
  ListInstanceProfilesForRoleCommand,
  ListPoliciesCommand,
  ListPolicyVersionsCommand,
  ListRolePoliciesCommand,
  ListRolesCommand,
  PutRolePolicyCommand,
  RemoveRoleFromInstanceProfileCommand,
  SetDefaultPolicyVersionCommand,
  UpdateAssumeRolePolicyCommand,
  UpdateRoleCommand,
  type Role as SdkRole,
} from '@aws-sdk/client-iam';

import { createAwsClient, EngineSessionError } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest } from '../../../../../lib/aws/request';
import { decodeDocument } from './document-text';
import { isServiceLinked, managedPolicyType, type PolicyRef, type PolicyType } from './format';
import { accountOfArn } from './trust-policy';

// The IAM calls of the AWS area (issue 82, requirement R2, R4, R5, R6, R7, R10): every operation of the role
// screens through the engine, mapped to plain typed results. Every value in a result comes from the emulator's
// answer, unchanged; each is untrusted text. The client speaks the SDK's own protocol, which the engine relays
// (R2, "The client's protocol and the engine"); the factory sets everything else.

/** A tag of a role, `Key` and `Value`. */
export interface Tag {
  key: string;
  value: string;
}

/** One role. A value the answer did not give is absent. */
export interface Role {
  name: string;
  arn?: string;
  id?: string;
  path?: string;
  createDate?: Date;
  /** `AssumeRolePolicyDocument` as the SDK gives it, percent-encoded once (`format.ts` reads it). */
  trustPolicy?: string;
  /** `Description` as it came; an empty one stays empty. */
  description?: string;
  maxSessionDuration?: number;
  /** `RoleLastUsed.LastUsedDate` of `GetRole`. */
  lastUsed?: Date;
  /** `PermissionsBoundary.PermissionsBoundaryArn`. */
  permissionsBoundary?: string;
  tags: Tag[];
}

/** Where a page of a list starts: the marker of the emulator's page to read, and how many of its entries to pass. */
export interface PageCursor {
  /** `Marker`; none for the emulator's first page. */
  marker?: string;
  /** Entries of that page already shown on an earlier page of the screen. */
  skip: number;
}

/** What one page of a list is asked with (R4.1, R4.7, R6.4). */
export interface PageRequest {
  /** The page size, sent as `MaxItems`. */
  pageSize: number;
  /** Where the page starts; the list's start when absent. */
  from?: PageCursor;
  /** The filter's text: a page holds only names that contain it, upper and lower case alike. Empty for none. */
  filter?: string;
}

/** One page of the role list, in the emulator's order. */
export interface RolePage {
  roles: Role[];
  /** Where the next page starts; absent when no more remain. */
  next?: PageCursor;
}

/** A managed policy the emulator holds (S3's step 2). */
export interface Policy {
  name: string;
  arn: string;
  type: PolicyType;
  /** `AttachmentCount`, when the answer gave it. */
  attachmentCount?: number;
  /** `UpdateDate`, the policy's last change, when the answer gave it. */
  updateDate?: Date;
}

/** `Scope` of `ListPolicies`: the account's own policies, the AWS managed ones, or both. */
export type PolicyScope = 'Local' | 'AWS' | 'All';

/** One page of the policy list. */
export interface PolicyPage {
  policies: Policy[];
  next?: PageCursor;
}

/** A role's permissions policies (R5.3): read, or the failure of one of the two lists. */
export type RolePolicies =
  /** The attached policies in the answer's order, then the inline policy names; `truncated` when a list was. */
  { kind: 'read'; items: PolicyRef[]; truncated: boolean } | { kind: 'failed'; failure: IamFailure };

/** A role's page (R5.1, R5.4). */
export type RoleRead = { kind: 'found'; role: Role; policies: RolePolicies } | { kind: 'not-found' };

/** What "Edit summary" saves (R5.5). */
export interface RoleUpdate {
  name: string;
  description: string;
  maxSessionDuration: number;
}

/** What "Create role" sends (R6.7). */
export interface NewRole {
  name: string;
  /** The trust policy's text (`trust-policy.ts`). */
  trustPolicy: string;
  /** Sent when not empty. */
  description?: string;
  /** Sent when any, in the editor's order. */
  tags?: Tag[];
  /** Attached one after another, in this order, once the role exists. */
  policies?: { name: string; arn: string }[];
}

/** A role that was created; `attachFailures` names each policy whose `AttachRolePolicy` failed. */
export interface CreatedRole {
  name: string;
  attachFailures: { policy: { name: string; arn: string }; failure: IamFailure }[];
}

/** A role to delete: its name, and its path, by which the emulator tells a service-linked role. */
export interface RoleToDelete {
  name: string;
  path?: string;
}

/** What deleting several roles did: the names deleted, and each role that failed with the request that failed. */
export interface DeleteResult {
  deleted: string[];
  failed: { name: string; failure: IamFailure }[];
}

/** Why a request failed, one kind per state of requirement R10 that the answer alone decides. */
export type IamFailure =
  /** HTTP 501: the emulator does not implement the operation. */
  | { kind: 'not-implemented'; operation: string }
  /** `AccessDenied`, with the message returned. */
  | { kind: 'access-denied'; operation: string; message: string }
  /** The engine's `EmulatorUnavailable` or `EmulatorTimeout`, with the engine's message as it came. */
  | { kind: 'emulator-did-not-answer'; operation: string; message: string }
  /** No answer came from the engine: the request, or the session request before it, failed at the network level. */
  | { kind: 'engine-did-not-answer'; operation: string }
  /** Any other answer: its code without the suffix `Exception`, or its status line when it has none, and its message. */
  | { kind: 'other'; operation: string; code: string; message?: string };

/** A request that failed; carries what the answer said, nothing else. */
export class IamError extends Error {
  readonly failure: IamFailure;

  constructor(failure: IamFailure) {
    super(`${failure.operation} failed: ${failure.kind}.`);
    this.name = 'IamError';
    this.failure = failure;
  }
}

/** The emulator's code for a role, policy or profile it does not hold. */
export const NO_SUCH_ENTITY = 'NoSuchEntity';

/** `MaxItems` of a role's two policy lists on its page (R5.1). */
export const ROLE_POLICIES_PAGE = 100;

/** The engine's two answers for an emulator that cannot be reached or does not answer in time. */
const EMULATOR_SILENT: ReadonlySet<string> = new Set(['EmulatorUnavailable', 'EmulatorTimeout']);

const ACCESS_DENIED = 'AccessDenied';

const EXCEPTION_SUFFIX = 'Exception';

const clients = new Map<string, IAMClient>();

/**
 * The area's IAM client for the engine at `endpoint`, one per endpoint for the life of the page, made by the factory
 * from the SDK's class (issue 386, R6.1). Refuses an endpoint that is not the engine's with `EndpointRefusedError`.
 */
export function iamClient(endpoint: string): IAMClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(IAMClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

interface ErrorAnswer {
  name?: unknown;
  Code?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  $response?: { reason?: unknown };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The answer's code without the SDK's suffix `Exception`; `undefined` for an answer whose body gave none. */
function codeOf(answer: ErrorAnswer): string | undefined {
  const code = text(answer.Code);
  if (code !== undefined) {
    return code.endsWith(EXCEPTION_SUFFIX) ? code.slice(0, -EXCEPTION_SUFFIX.length) : code;
  }
  // The SDK names an answer without a code `Unknown`.
  const name = text(answer.name);
  if (name === undefined || name === 'Unknown') {
    return undefined;
  }
  return name.endsWith(EXCEPTION_SUFFIX) ? name.slice(0, -EXCEPTION_SUFFIX.length) : name;
}

function failureOf(error: unknown, operation: string): IamFailure {
  if (error instanceof EngineSessionError) {
    return error.reason === 'unreachable'
      ? { kind: 'engine-did-not-answer', operation }
      : { kind: 'other', operation, code: error.code ?? `HTTP ${String(error.status)}` };
  }
  const answer = (typeof error === 'object' && error !== null ? error : {}) as ErrorAnswer;
  const status = answer.$metadata?.httpStatusCode;
  if (typeof status !== 'number') {
    return { kind: 'engine-did-not-answer', operation };
  }
  if (status === 501) {
    return { kind: 'not-implemented', operation };
  }
  const code = codeOf(answer);
  const message = code === undefined ? undefined : text(answer.message);
  if (code === ACCESS_DENIED) {
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

/** `failure` is the emulator's "it does not hold that". */
export function isNoSuchEntity(failure: IamFailure): boolean {
  return failure.kind === 'other' && failure.code === NO_SUCH_ENTITY;
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

type Send<T> = (client: IAMClient, options: { abortSignal: AbortSignal }) => Promise<T>;

/**
 * One request of `operation`. Rejects with `IamError` for a failed request, and with `signal`'s reason, and nothing
 * else, once it aborts.
 */
async function request<T>(endpoint: string, operation: string, send: Send<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const client = iamClient(endpoint);
  try {
    const sent = send(client, { abortSignal: signal });
    // Its rejection after an abort is the abort's, already given to the caller.
    sent.catch(() => undefined);
    return await untilAborted(sent, signal);
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw new IamError(failureOf(error, operation));
  }
}

function validDate(value: unknown): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}

function toRole(entry: Partial<SdkRole>): Role {
  const role: Role = { name: entry.RoleName ?? '', tags: [] };
  const arn = text(entry.Arn);
  if (arn !== undefined) role.arn = arn;
  const id = text(entry.RoleId);
  if (id !== undefined) role.id = id;
  const path = text(entry.Path);
  if (path !== undefined) role.path = path;
  const created = validDate(entry.CreateDate);
  if (created !== undefined) role.createDate = created;
  const trust = text(entry.AssumeRolePolicyDocument);
  if (trust !== undefined) role.trustPolicy = trust;
  if (typeof entry.Description === 'string') role.description = entry.Description;
  if (typeof entry.MaxSessionDuration === 'number') role.maxSessionDuration = entry.MaxSessionDuration;
  const lastUsed = validDate(entry.RoleLastUsed?.LastUsedDate);
  if (lastUsed !== undefined) role.lastUsed = lastUsed;
  const boundary = text(entry.PermissionsBoundary?.PermissionsBoundaryArn);
  if (boundary !== undefined) role.permissionsBoundary = boundary;
  role.tags = (entry.Tags ?? []).map(({ Key, Value }) => ({ key: Key ?? '', value: Value ?? '' }));
  return role;
}

/** One answer of a list operation: its entries, and its marker while more remain. */
interface ListAnswer<T> {
  items: T[];
  marker?: string;
}

function nextMarker(output: { IsTruncated?: boolean | undefined; Marker?: string | undefined }): string | undefined {
  return output.IsTruncated === true ? text(output.Marker) : undefined;
}

/**
 * One page of a list that pages by `Marker` (R4.4, R4.7). Without a filter, one answer is the page. With one, the
 * emulator's pages are read on, in order, until the page holds `pageSize` matching entries or the list ends; the next
 * page goes on from where this one ended, inside an answer when the page filled before its end.
 */
async function readPage<T>(
  read: (marker: string | undefined) => Promise<ListAnswer<T>>,
  nameOf: (item: T) => string,
  { pageSize, from, filter }: PageRequest,
): Promise<{ items: T[]; next?: PageCursor }> {
  const needle = (filter ?? '').toLowerCase();
  const items: T[] = [];
  let marker = from?.marker;
  let skip = from?.skip ?? 0;
  for (;;) {
    const answer = await read(marker);
    for (let index = skip; index < answer.items.length; index += 1) {
      const item = answer.items[index] as T;
      if (needle !== '' && !nameOf(item).toLowerCase().includes(needle)) {
        continue;
      }
      if (items.length === pageSize) {
        // A further entry of this answer belongs on the next page.
        return { items, next: marker === undefined ? { skip: index } : { marker, skip: index } };
      }
      items.push(item);
    }
    if (answer.marker === undefined) {
      return { items };
    }
    if (needle === '' || items.length === pageSize) {
      return { items, next: { marker: answer.marker, skip: 0 } };
    }
    marker = answer.marker;
    skip = 0;
  }
}

const LIST_ROLES = 'ListRoles';
const GET_ROLE = 'GetRole';

async function lastUsedOf(endpoint: string, role: Role, signal: AbortSignal): Promise<Role | undefined> {
  try {
    const output = await request(
      endpoint,
      GET_ROLE,
      (client, options) => client.send(new GetRoleCommand({ RoleName: role.name }), options),
      signal,
    );
    const lastUsed = validDate(output.Role?.RoleLastUsed?.LastUsedDate);
    return lastUsed === undefined ? role : { ...role, lastUsed };
  } catch (error) {
    // Deleted between the two calls: left out of the page (R4.1).
    if (error instanceof IamError && isNoSuchEntity(error.failure)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * One page of the emulator's roles (R4.1, R4.7): `ListRoles`, read on through the emulator's pages while a filter
 * leaves the page short, then one `GetRole` per role of the page, sent together, for its last use. A role whose
 * `GetRole` answers `NoSuchEntity` is left out; any other failure is the listing's.
 */
export async function listRoles(endpoint: string, page: PageRequest, signal: AbortSignal): Promise<RolePage> {
  const read = await readPage(
    async (marker) => {
      const output = await request(
        endpoint,
        LIST_ROLES,
        (client, options) =>
          client.send(
            new ListRolesCommand({ MaxItems: page.pageSize, ...(marker === undefined ? {} : { Marker: marker }) }),
            options,
          ),
        signal,
      );
      const answer: ListAnswer<Role> = { items: (output.Roles ?? []).map(toRole) };
      const next = nextMarker(output);
      if (next !== undefined) answer.marker = next;
      return answer;
    },
    (role) => role.name,
    page,
  );
  // The page's `GetRole` requests share a controller joined to `signal`: once one fails, the others are no longer
  // wanted and are aborted (R4.9).
  const reads = new AbortController();
  const abort = () => {
    reads.abort(signal.reason);
  };
  signal.addEventListener('abort', abort, { once: true });
  let roles: (Role | undefined)[];
  try {
    roles = await Promise.all(
      read.items.map((role) =>
        lastUsedOf(endpoint, role, reads.signal).catch((error: unknown) => {
          if (!reads.signal.aborted) {
            reads.abort(error);
          }
          throw error;
        }),
      ),
    );
  } finally {
    signal.removeEventListener('abort', abort);
  }
  const result: RolePage = { roles: roles.filter((role): role is Role => role !== undefined) };
  if (read.next !== undefined) result.next = read.next;
  return result;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(pending: Promise<T>): Promise<Settled<T>> {
  return pending.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
}

function policiesFailure(error: unknown, operation: string): IamFailure {
  return error instanceof IamError ? error.failure : { kind: 'other', operation, code: String(error) };
}

/**
 * A role's page (R5.1): `GetRole`, `ListAttachedRolePolicies` and `ListRolePolicies` for `name`, sent together, the
 * two lists with `MaxItems` 100. `NoSuchEntity` from `GetRole` is "not found"; a failure of a list is given beside
 * the role.
 */
export async function getRole(endpoint: string, name: string, signal: AbortSignal): Promise<RoleRead> {
  const role = settle(
    request(
      endpoint,
      GET_ROLE,
      (client, options) => client.send(new GetRoleCommand({ RoleName: name }), options),
      signal,
    ),
  );
  const attached = settle(
    request(
      endpoint,
      'ListAttachedRolePolicies',
      (client, options) =>
        client.send(new ListAttachedRolePoliciesCommand({ RoleName: name, MaxItems: ROLE_POLICIES_PAGE }), options),
      signal,
    ),
  );
  const inline = settle(
    request(
      endpoint,
      'ListRolePolicies',
      (client, options) =>
        client.send(new ListRolePoliciesCommand({ RoleName: name, MaxItems: ROLE_POLICIES_PAGE }), options),
      signal,
    ),
  );
  const [roleAnswer, attachedAnswer, inlineAnswer] = await Promise.all([role, attached, inline]);
  if (signal.aborted) {
    throw signal.reason;
  }
  if (!roleAnswer.ok) {
    if (roleAnswer.error instanceof IamError && isNoSuchEntity(roleAnswer.error.failure)) {
      return { kind: 'not-found' };
    }
    throw roleAnswer.error;
  }
  const found = toRole(roleAnswer.value.Role ?? {});
  let policies: RolePolicies;
  if (!attachedAnswer.ok) {
    policies = { kind: 'failed', failure: policiesFailure(attachedAnswer.error, 'ListAttachedRolePolicies') };
  } else if (!inlineAnswer.ok) {
    policies = { kind: 'failed', failure: policiesFailure(inlineAnswer.error, 'ListRolePolicies') };
  } else {
    const managed: PolicyRef[] = (attachedAnswer.value.AttachedPolicies ?? []).map(({ PolicyName, PolicyArn }) => ({
      kind: 'managed',
      name: PolicyName ?? '',
      arn: PolicyArn ?? '',
    }));
    const named: PolicyRef[] = (inlineAnswer.value.PolicyNames ?? []).map((policy) => ({
      kind: 'inline',
      name: policy,
    }));
    policies = {
      kind: 'read',
      items: [...managed, ...named],
      truncated: attachedAnswer.value.IsTruncated === true || inlineAnswer.value.IsTruncated === true,
    };
  }
  return { kind: 'found', role: found, policies };
}

/** The caller's account (R6.3, "This account"): the account of the ARN `GetUser` without a user name returns. */
export async function getCallerAccount(endpoint: string, signal: AbortSignal): Promise<string | undefined> {
  const output = await request(
    endpoint,
    'GetUser',
    (client, options) => client.send(new GetUserCommand({}), options),
    signal,
  );
  return accountOfArn(output.User?.Arn);
}

/**
 * One page of the emulator's managed policies (R6.4; issue 535, S4): `ListPolicies` with `scope` (`All` unless given),
 * read on as the role list.
 */
export async function listPolicies(
  endpoint: string,
  page: PageRequest,
  signal: AbortSignal,
  scope: PolicyScope = 'All',
): Promise<PolicyPage> {
  const read = await readPage(
    async (marker) => {
      const output = await request(
        endpoint,
        'ListPolicies',
        (client, options) =>
          client.send(
            new ListPoliciesCommand({
              Scope: scope,
              MaxItems: page.pageSize,
              ...(marker === undefined ? {} : { Marker: marker }),
            }),
            options,
          ),
        signal,
      );
      const answer: ListAnswer<Policy> = {
        items: (output.Policies ?? []).map(({ PolicyName, Arn, AttachmentCount, UpdateDate }) => {
          const arn = Arn ?? '';
          const policy: Policy = { name: PolicyName ?? '', arn, type: managedPolicyType(arn) };
          if (typeof AttachmentCount === 'number') policy.attachmentCount = AttachmentCount;
          const updated = validDate(UpdateDate);
          if (updated !== undefined) policy.updateDate = updated;
          return policy;
        }),
      };
      const next = nextMarker(output);
      if (next !== undefined) answer.marker = next;
      return answer;
    },
    (policy) => policy.name,
    page,
  );
  return read.next === undefined ? { policies: read.items } : { policies: read.items, next: read.next };
}

/**
 * "Save changes" of "Edit summary" (R5.5): one `UpdateRole` with `RoleName` and `Description`, and with
 * `MaxSessionDuration` only when it differs from `readMaxSessionDuration`, the value the page read (a service-linked
 * role refuses even its own value, R2).
 */
export async function updateRole(
  endpoint: string,
  { name, description, maxSessionDuration }: RoleUpdate,
  readMaxSessionDuration: number | undefined,
  signal: AbortSignal,
): Promise<void> {
  await request(
    endpoint,
    'UpdateRole',
    (client, options) =>
      client.send(
        new UpdateRoleCommand({
          RoleName: name,
          Description: description,
          ...(maxSessionDuration === readMaxSessionDuration ? {} : { MaxSessionDuration: maxSessionDuration }),
        }),
        options,
      ),
    signal,
  );
}

/**
 * "Create role" (R6.7): one `CreateRole`, then, after its answer, one `AttachRolePolicy` per policy in the order
 * given, each after the previous one's answer; a failed one does not stop the ones after it. Rejects with `IamError`
 * when `CreateRole` fails, and nothing is attached.
 */
export async function createRole(endpoint: string, role: NewRole, signal: AbortSignal): Promise<CreatedRole> {
  const tags = role.tags ?? [];
  const output = await request(
    endpoint,
    'CreateRole',
    (client, options) =>
      client.send(
        new CreateRoleCommand({
          RoleName: role.name,
          AssumeRolePolicyDocument: role.trustPolicy,
          ...(role.description === undefined || role.description === '' ? {} : { Description: role.description }),
          ...(tags.length === 0 ? {} : { Tags: tags.map(({ key, value }) => ({ Key: key, Value: value })) }),
        }),
        options,
      ),
    signal,
  );
  const name = text(output.Role?.RoleName) ?? role.name;
  const attachFailures: CreatedRole['attachFailures'] = [];
  for (const policy of role.policies ?? []) {
    try {
      await request(
        endpoint,
        'AttachRolePolicy',
        (client, options) =>
          client.send(new AttachRolePolicyCommand({ RoleName: name, PolicyArn: policy.arn }), options),
        signal,
      );
    } catch (error) {
      if (!(error instanceof IamError)) {
        throw error;
      }
      attachFailures.push({ policy, failure: error.failure });
    }
  }
  return { name, attachFailures };
}

/** Every entry of a list that pages by `Marker`, read on to its end (R7: the role cannot be deleted otherwise). */
async function readAll<T>(read: (marker: string | undefined) => Promise<ListAnswer<T>>): Promise<T[]> {
  const items: T[] = [];
  let marker: string | undefined;
  do {
    const answer = await read(marker);
    items.push(...answer.items);
    marker = answer.marker;
  } while (marker !== undefined);
  return items;
}

function withMarker(marker: string | undefined): { Marker?: string } {
  return marker === undefined ? {} : { Marker: marker };
}

/** Deletes one role as R7 asks; rejects with `IamError` at its first failed request. */
async function deleteRole(endpoint: string, { name, path }: RoleToDelete, signal: AbortSignal): Promise<void> {
  if (isServiceLinked(path)) {
    await request(
      endpoint,
      'DeleteServiceLinkedRole',
      (client, options) => client.send(new DeleteServiceLinkedRoleCommand({ RoleName: name }), options),
      signal,
    );
    return;
  }
  const profiles = await readAll(async (marker) => {
    const output = await request(
      endpoint,
      'ListInstanceProfilesForRole',
      (client, options) =>
        client.send(new ListInstanceProfilesForRoleCommand({ RoleName: name, ...withMarker(marker) }), options),
      signal,
    );
    const next = nextMarker(output);
    return {
      items: (output.InstanceProfiles ?? []).map((profile) => profile.InstanceProfileName ?? ''),
      ...(next === undefined ? {} : { marker: next }),
    };
  });
  for (const profile of profiles) {
    await request(
      endpoint,
      'RemoveRoleFromInstanceProfile',
      (client, options) =>
        client.send(
          new RemoveRoleFromInstanceProfileCommand({ RoleName: name, InstanceProfileName: profile }),
          options,
        ),
      signal,
    );
  }
  const attached = await readAll(async (marker) => {
    const output = await request(
      endpoint,
      'ListAttachedRolePolicies',
      (client, options) =>
        client.send(new ListAttachedRolePoliciesCommand({ RoleName: name, ...withMarker(marker) }), options),
      signal,
    );
    const next = nextMarker(output);
    return {
      items: (output.AttachedPolicies ?? []).map((policy) => policy.PolicyArn ?? ''),
      ...(next === undefined ? {} : { marker: next }),
    };
  });
  for (const arn of attached) {
    await request(
      endpoint,
      'DetachRolePolicy',
      (client, options) => client.send(new DetachRolePolicyCommand({ RoleName: name, PolicyArn: arn }), options),
      signal,
    );
  }
  const inline = await readAll(async (marker) => {
    const output = await request(
      endpoint,
      'ListRolePolicies',
      (client, options) => client.send(new ListRolePoliciesCommand({ RoleName: name, ...withMarker(marker) }), options),
      signal,
    );
    const next = nextMarker(output);
    return { items: output.PolicyNames ?? [], ...(next === undefined ? {} : { marker: next }) };
  });
  for (const policy of inline) {
    await request(
      endpoint,
      'DeleteRolePolicy',
      (client, options) => client.send(new DeleteRolePolicyCommand({ RoleName: name, PolicyName: policy }), options),
      signal,
    );
  }
  await request(
    endpoint,
    'DeleteRole',
    (client, options) => client.send(new DeleteRoleCommand({ RoleName: name }), options),
    signal,
  );
}

/**
 * "Delete" of the role list (R7): the roles in the order given, each after the previous one is finished. A
 * service-linked role (by its path) is one `DeleteServiceLinkedRole`; any other has its instance profiles, managed
 * and inline policies removed first, each list read to its end, then `DeleteRole`. The first failed request of a
 * role ends that role, and the roles after it are still handled.
 */
export async function deleteRoles(
  endpoint: string,
  roles: readonly RoleToDelete[],
  signal: AbortSignal,
): Promise<DeleteResult> {
  const result: DeleteResult = { deleted: [], failed: [] };
  for (const role of roles) {
    try {
      await deleteRole(endpoint, role, signal);
      result.deleted.push(role.name);
    } catch (error) {
      if (!(error instanceof IamError)) {
        throw error;
      }
      result.failed.push({ name: role.name, failure: error.failure });
    }
  }
  return result;
}

// The calls of issue 535 (design, "The calls"): a role's documents and permission changes, its trust policy, and the
// customer managed policies with their versions. Each request goes through the area's `sendRequest` with its
// operation's name, on IAM's one client: a failure rejects with its `RequestError`, whose failure has the kinds of
// `IamFailure`, and an aborted signal ends the call at once with its reason. Every value comes from the emulator's
// answer, unchanged but for a document's one percent-decoding; each is untrusted text.

/** One request of `operation` on IAM's client for `endpoint`, through the area's `sendRequest`. */
function send<T>(
  endpoint: string,
  operation: string,
  call: (client: IAMClient, abortSignal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abortSignal) => call(iamClient(endpoint), abortSignal), signal);
}

/** The failure of a request that failed; anything else (the signal's reason) is not a failure and is thrown on. */
function requestFailureOf(error: unknown): IamFailure {
  if (error instanceof RequestError) {
    return error.failure;
  }
  throw error;
}

/** A document that was read: its text, percent-decoded once; or the emulator holds no such policy. */
export type InlineDocumentRead = { kind: 'found'; text: string } | { kind: 'not-found' };

/** A managed policy's document: its text, the version's id and whether it is the default; or no such policy. */
export type ManagedDocumentRead =
  | { kind: 'found'; text: string; versionId: string; isDefault: boolean }
  | { kind: 'not-found' };

/** `NoSuchEntity` as "not found"; any other failure rejects as it came. */
async function orNotFound<T>(read: Promise<T>): Promise<T | { kind: 'not-found' }> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof RequestError && isNoSuchEntity(error.failure)) {
      return { kind: 'not-found' };
    }
    throw error;
  }
}

/** An inline policy's document: `GetRolePolicy`; `NoSuchEntity` is "not found". */
export function getRolePolicyDocument(
  endpoint: string,
  role: string,
  policy: string,
  signal: AbortSignal,
): Promise<InlineDocumentRead> {
  return orNotFound(
    (async (): Promise<InlineDocumentRead> => {
      const output = await send(
        endpoint,
        'GetRolePolicy',
        (client, abortSignal) =>
          client.send(new GetRolePolicyCommand({ RoleName: role, PolicyName: policy }), { abortSignal }),
        signal,
      );
      return { kind: 'found', text: decodeDocument(output.PolicyDocument) };
    })(),
  );
}

/**
 * A managed policy's document: `GetPolicy` first when no version is named, for its `DefaultVersionId`, then
 * `GetPolicyVersion`; `NoSuchEntity` of either call is "not found".
 */
export function getPolicyDocument(
  endpoint: string,
  arn: string,
  versionId: string | undefined,
  signal: AbortSignal,
): Promise<ManagedDocumentRead> {
  return orNotFound(
    (async (): Promise<ManagedDocumentRead> => {
      let version = versionId;
      if (version === undefined) {
        const policy = await send(
          endpoint,
          'GetPolicy',
          (client, abortSignal) => client.send(new GetPolicyCommand({ PolicyArn: arn }), { abortSignal }),
          signal,
        );
        version = policy.Policy?.DefaultVersionId ?? '';
      }
      const asked = version;
      const output = await send(
        endpoint,
        'GetPolicyVersion',
        (client, abortSignal) =>
          client.send(new GetPolicyVersionCommand({ PolicyArn: arn, VersionId: asked }), { abortSignal }),
        signal,
      );
      return {
        kind: 'found',
        text: decodeDocument(output.PolicyVersion?.Document),
        versionId: text(output.PolicyVersion?.VersionId) ?? asked,
        isDefault: output.PolicyVersion?.IsDefaultVersion === true,
      };
    })(),
  );
}

/** A managed policy to attach: its name, for the result's words, and its ARN. */
export interface PolicyToAttach {
  name: string;
  arn: string;
}

/** What "Attach policies" did: the policies attached, in order, and the one refused, when one was. */
export interface AttachResult {
  attached: PolicyToAttach[];
  failed?: { policy: PolicyToAttach; failure: IamFailure };
}

/**
 * "Attach policies": one `AttachRolePolicy` per policy in the order given, each after the previous answer; the first
 * refusal ends it, and the policies after it are not sent.
 */
export async function attachRolePolicies(
  endpoint: string,
  role: string,
  policies: readonly PolicyToAttach[],
  signal: AbortSignal,
): Promise<AttachResult> {
  const attached: PolicyToAttach[] = [];
  for (const policy of policies) {
    try {
      await send(
        endpoint,
        'AttachRolePolicy',
        (client, abortSignal) =>
          client.send(new AttachRolePolicyCommand({ RoleName: role, PolicyArn: policy.arn }), { abortSignal }),
        signal,
      );
    } catch (error) {
      return { attached, failed: { policy, failure: requestFailureOf(error) } };
    }
    attached.push(policy);
  }
  return { attached };
}

/** "Detach": `DetachRolePolicy`. */
export async function detachRolePolicy(endpoint: string, role: string, arn: string, signal: AbortSignal): Promise<void> {
  await send(
    endpoint,
    'DetachRolePolicy',
    (client, abortSignal) =>
      client.send(new DetachRolePolicyCommand({ RoleName: role, PolicyArn: arn }), { abortSignal }),
    signal,
  );
}

/** "Add inline policy" and an inline policy's "Edit": `PutRolePolicy` with the text as given. */
export async function putRolePolicy(
  endpoint: string,
  role: string,
  policy: string,
  document: string,
  signal: AbortSignal,
): Promise<void> {
  await send(
    endpoint,
    'PutRolePolicy',
    (client, abortSignal) =>
      client.send(new PutRolePolicyCommand({ RoleName: role, PolicyName: policy, PolicyDocument: document }), {
        abortSignal,
      }),
    signal,
  );
}

/** An inline policy's "Delete": `DeleteRolePolicy`. */
export async function deleteRolePolicy(
  endpoint: string,
  role: string,
  policy: string,
  signal: AbortSignal,
): Promise<void> {
  await send(
    endpoint,
    'DeleteRolePolicy',
    (client, abortSignal) =>
      client.send(new DeleteRolePolicyCommand({ RoleName: role, PolicyName: policy }), { abortSignal }),
    signal,
  );
}

/** "Edit trust policy": `UpdateAssumeRolePolicy` with the text as given. */
export async function updateTrustPolicy(
  endpoint: string,
  role: string,
  document: string,
  signal: AbortSignal,
): Promise<void> {
  await send(
    endpoint,
    'UpdateAssumeRolePolicy',
    (client, abortSignal) =>
      client.send(new UpdateAssumeRolePolicyCommand({ RoleName: role, PolicyDocument: document }), { abortSignal }),
    signal,
  );
}

/** A managed policy as `GetPolicy` gives it. A value the answer did not give is absent. */
export interface PolicyDetail {
  name: string;
  arn: string;
  type: PolicyType;
  id?: string;
  path?: string;
  description?: string;
  createDate?: Date;
  updateDate?: Date;
  defaultVersionId?: string;
  attachmentCount?: number;
}

/** One version of a managed policy, in the emulator's order (newest first). */
export interface PolicyVersion {
  id: string;
  isDefault: boolean;
  createDate?: Date;
}

/** What a managed policy is attached to. */
export interface PolicyEntity {
  kind: 'role' | 'user' | 'group';
  name: string;
}

/** A part of a policy's page read with its own list: read, or that list's failure. */
export type PolicyPart<T> = { kind: 'read'; items: T[] } | { kind: 'failed'; failure: IamFailure };

/** A policy's page (S5). */
export type PolicyRead =
  | { kind: 'found'; policy: PolicyDetail; versions: PolicyPart<PolicyVersion>; entities: PolicyPart<PolicyEntity> }
  | { kind: 'not-found' };

/** Every version of `arn`: `ListPolicyVersions`, read to its end by `Marker`. */
function readVersions(endpoint: string, arn: string, signal: AbortSignal): Promise<PolicyVersion[]> {
  return readAll(async (marker) => {
    const output = await send(
      endpoint,
      'ListPolicyVersions',
      (client, abortSignal) =>
        client.send(new ListPolicyVersionsCommand({ PolicyArn: arn, ...withMarker(marker) }), { abortSignal }),
      signal,
    );
    const next = nextMarker(output);
    return {
      items: (output.Versions ?? []).map((version) => {
        const item: PolicyVersion = { id: version.VersionId ?? '', isDefault: version.IsDefaultVersion === true };
        const created = validDate(version.CreateDate);
        if (created !== undefined) item.createDate = created;
        return item;
      }),
      ...(next === undefined ? {} : { marker: next }),
    };
  });
}

/** Every role, user and group `arn` is attached to: `ListEntitiesForPolicy`, read to its end by `Marker`. */
function readEntities(endpoint: string, arn: string, signal: AbortSignal): Promise<PolicyEntity[]> {
  return readAll(async (marker) => {
    const output = await send(
      endpoint,
      'ListEntitiesForPolicy',
      (client, abortSignal) =>
        client.send(new ListEntitiesForPolicyCommand({ PolicyArn: arn, ...withMarker(marker) }), { abortSignal }),
      signal,
    );
    const next = nextMarker(output);
    const entities: PolicyEntity[] = [
      ...(output.PolicyRoles ?? []).map((role) => ({ kind: 'role' as const, name: role.RoleName ?? '' })),
      ...(output.PolicyUsers ?? []).map((user) => ({ kind: 'user' as const, name: user.UserName ?? '' })),
      ...(output.PolicyGroups ?? []).map((group) => ({ kind: 'group' as const, name: group.GroupName ?? '' })),
    ];
    return { items: entities, ...(next === undefined ? {} : { marker: next }) };
  });
}

/** A list read as one part of a page: its items, or its failure; an abort is thrown on. */
async function part<T>(read: Promise<T[]>): Promise<PolicyPart<T>> {
  try {
    return { kind: 'read', items: await read };
  } catch (error) {
    return { kind: 'failed', failure: requestFailureOf(error) };
  }
}

/**
 * A policy's page (S5): `GetPolicy`; then `ListPolicyVersions` and `ListEntitiesForPolicy`, one after the other, each
 * read to its end. `NoSuchEntity` of `GetPolicy` is "not found"; a failed list is that part's failure.
 */
export function getPolicy(endpoint: string, arn: string, signal: AbortSignal): Promise<PolicyRead> {
  return orNotFound(
    (async (): Promise<PolicyRead> => {
      const output = await send(
        endpoint,
        'GetPolicy',
        (client, abortSignal) => client.send(new GetPolicyCommand({ PolicyArn: arn }), { abortSignal }),
        signal,
      );
      const entry = output.Policy ?? {};
      const policyArn = text(entry.Arn) ?? arn;
      const policy: PolicyDetail = {
        name: entry.PolicyName ?? '',
        arn: policyArn,
        type: managedPolicyType(policyArn),
      };
      const id = text(entry.PolicyId);
      if (id !== undefined) policy.id = id;
      const path = text(entry.Path);
      if (path !== undefined) policy.path = path;
      if (typeof entry.Description === 'string') policy.description = entry.Description;
      const created = validDate(entry.CreateDate);
      if (created !== undefined) policy.createDate = created;
      const updated = validDate(entry.UpdateDate);
      if (updated !== undefined) policy.updateDate = updated;
      const defaultVersion = text(entry.DefaultVersionId);
      if (defaultVersion !== undefined) policy.defaultVersionId = defaultVersion;
      if (typeof entry.AttachmentCount === 'number') policy.attachmentCount = entry.AttachmentCount;
      const versions = await part(readVersions(endpoint, arn, signal));
      const entities = await part(readEntities(endpoint, arn, signal));
      return { kind: 'found', policy, versions, entities };
    })(),
  );
}

/** What "Create policy" sends. */
export interface NewPolicy {
  name: string;
  /** Sent when not empty. */
  description?: string;
  /** The document's text, sent as given. */
  document: string;
}

/** "Create policy": `CreatePolicy`; resolves with the new policy's ARN. */
export async function createPolicy(endpoint: string, policy: NewPolicy, signal: AbortSignal): Promise<string> {
  const output = await send(
    endpoint,
    'CreatePolicy',
    (client, abortSignal) =>
      client.send(
        new CreatePolicyCommand({
          PolicyName: policy.name,
          PolicyDocument: policy.document,
          ...(policy.description === undefined || policy.description === ''
            ? {}
            : { Description: policy.description }),
        }),
        { abortSignal },
      ),
    signal,
  );
  return output.Policy?.Arn ?? '';
}

/** A policy's "Edit": `CreatePolicyVersion` with `SetAsDefault`; resolves with the new version's id. */
export async function createPolicyVersion(
  endpoint: string,
  arn: string,
  document: string,
  signal: AbortSignal,
): Promise<string> {
  const output = await send(
    endpoint,
    'CreatePolicyVersion',
    (client, abortSignal) =>
      client.send(new CreatePolicyVersionCommand({ PolicyArn: arn, PolicyDocument: document, SetAsDefault: true }), {
        abortSignal,
      }),
    signal,
  );
  return output.PolicyVersion?.VersionId ?? '';
}

/** "Set as default": `SetDefaultPolicyVersion`. */
export async function setDefaultPolicyVersion(
  endpoint: string,
  arn: string,
  versionId: string,
  signal: AbortSignal,
): Promise<void> {
  await send(
    endpoint,
    'SetDefaultPolicyVersion',
    (client, abortSignal) =>
      client.send(new SetDefaultPolicyVersionCommand({ PolicyArn: arn, VersionId: versionId }), { abortSignal }),
    signal,
  );
}

/** A version's "Delete": `DeletePolicyVersion`. */
export async function deletePolicyVersion(
  endpoint: string,
  arn: string,
  versionId: string,
  signal: AbortSignal,
): Promise<void> {
  await send(
    endpoint,
    'DeletePolicyVersion',
    (client, abortSignal) =>
      client.send(new DeletePolicyVersionCommand({ PolicyArn: arn, VersionId: versionId }), { abortSignal }),
    signal,
  );
}

/** The step of deleting a policy that was refused. */
export type DeletePolicyStep =
  | { kind: 'read-entities' }
  | { kind: 'read-versions' }
  | { kind: 'detach'; entity: PolicyEntity }
  | { kind: 'delete-version'; versionId: string }
  | { kind: 'delete-policy' };

/** What deleting a policy did; `detachedRoles` names the roles it was detached from before it ended. */
export type DeletePolicyResult =
  | { kind: 'deleted'; detachedRoles: string[] }
  | { kind: 'failed'; step: DeletePolicyStep; failure: IamFailure; detachedRoles: string[] };

/**
 * A policy's "Delete": `ListEntitiesForPolicy` to its end, then a detach per role, user and group; `ListPolicyVersions`,
 * then `DeletePolicyVersion` per version that is not the default; then `DeletePolicy`. Each request after the previous
 * answer; the first refusal ends it, named with its step, and nothing after it is sent.
 */
export async function deletePolicy(endpoint: string, arn: string, signal: AbortSignal): Promise<DeletePolicyResult> {
  const detachedRoles: string[] = [];
  let step: DeletePolicyStep = { kind: 'read-entities' };
  try {
    const entities = await readEntities(endpoint, arn, signal);
    for (const entity of entities) {
      step = { kind: 'detach', entity };
      switch (entity.kind) {
        case 'role':
          await send(
            endpoint,
            'DetachRolePolicy',
            (client, abortSignal) =>
              client.send(new DetachRolePolicyCommand({ RoleName: entity.name, PolicyArn: arn }), { abortSignal }),
            signal,
          );
          detachedRoles.push(entity.name);
          break;
        case 'user':
          await send(
            endpoint,
            'DetachUserPolicy',
            (client, abortSignal) =>
              client.send(new DetachUserPolicyCommand({ UserName: entity.name, PolicyArn: arn }), { abortSignal }),
            signal,
          );
          break;
        case 'group':
          await send(
            endpoint,
            'DetachGroupPolicy',
            (client, abortSignal) =>
              client.send(new DetachGroupPolicyCommand({ GroupName: entity.name, PolicyArn: arn }), { abortSignal }),
            signal,
          );
          break;
      }
    }
    step = { kind: 'read-versions' };
    const versions = await readVersions(endpoint, arn, signal);
    for (const version of versions) {
      if (version.isDefault) {
        continue;
      }
      step = { kind: 'delete-version', versionId: version.id };
      await deletePolicyVersion(endpoint, arn, version.id, signal);
    }
    step = { kind: 'delete-policy' };
    await send(
      endpoint,
      'DeletePolicy',
      (client, abortSignal) => client.send(new DeletePolicyCommand({ PolicyArn: arn }), { abortSignal }),
      signal,
    );
  } catch (error) {
    return { kind: 'failed', step, failure: requestFailureOf(error), detachedRoles };
  }
  return { kind: 'deleted', detachedRoles };
}
