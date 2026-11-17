// The emulator's IAM roles as the role screens' checks make and read them (issue 82, test-criteria.md, Flow checks;
// requirement R2). Used by the `iam-role-*.spec.ts` checks and by `iam-seed-structure.ts`.
//
// - Direct calls: IAM (AWS Query, `Version=2010-05-08`) and STS (`Version=2011-06-15`) actions straight to the
//   emulator on loopback, `POST /` with a form body, SigV4-signed for `us-east-1` with the key the emulator wrote for
//   this run (or with the temporary credentials of a role a check assumed), TLS verified against its `ca.pem`, never
//   through the engine. Answers are XML; `xmlTree` reads them, members nested in members included (a role's `Tags`).
// - Readers: every role of a direct `ListRoles` page after page, a role of `GetRole` (its trust policy decoded once
//   from the percent-encoding the emulator sends), the policies attached to and inline in a role, the instance
//   profiles that hold it, an instance profile, a policy and the caller's own user. A read that is not answered 200
//   fails the check (an assertion); `getRoleAnswer` and `iamAnswer` give the refusal (status, code, message) instead
//   for a check that expects one ("the role cannot be found").
// - `IamSeeded`: the roles, customer managed policies and instance profiles a check makes, and the roles Studio made
//   for it (`adopt`). When the check ends each role is taken out of its instance profiles, its managed policies are
//   detached and its inline policies deleted, then it is deleted (`DeleteServiceLinkedRole` for a role under
//   `/aws-service-role/`, as the emulator asks: `DeleteRole` answers 400 `UnmodifiableEntity` there); then the
//   instance profiles, then the policies. A step that fails is logged, never thrown. Making something that does not
//   answer 200 is an environment failure: the check's Given would not hold.
// - `awsCli`: the AWS CLI pointed at the emulator on `port`, with an environment built from nothing but `PATH`, a
//   scratch `HOME` of the run and that emulator's own files (`tests/integration/AGENTS.md`, Safety): no profile, no
//   credentials or config file of the machine, no proxy.
//
// Every value a check compares with comes from the run: names from the check's own prefix, ids, ARNs and dates from
// a direct answer, the account from a direct `GetUser`, the endpoint from the emulator's port.

import { execFile } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

import { EnvError, expect, type Ctx } from "./check";
import { emulatorDir, readEmulatorFiles } from "./emulator";

const REGION = "us-east-1";

/** What a direct call needs of a check: where the emulator's files are, and its log. `Ctx` is one. */
export type Caller = Pick<Ctx, "home" | "log">;

/** Credentials to sign with other than the emulator's own: a role's, from a direct `AssumeRole`. */
export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

/** The AWS managed policy the criteria attach (`ReadOnlyAccess`); the emulator holds it from its start (R2). */
export const READ_ONLY_ACCESS = "arn:aws:iam::aws:policy/ReadOnlyAccess";

/** The path under which the emulator treats a role as service-linked (R2, `DeleteServiceLinkedRole`). */
export const SERVICE_ROLE_PATH = "/aws-service-role/";

// ---------------------------------------------------------------------------------------------------------------
// Trust and permission documents.
// ---------------------------------------------------------------------------------------------------------------

/** A trust policy that allows `sts:AssumeRole` to the principal `principal` (`{ Service: … }`, `{ AWS: … }`). */
export function trustPolicy(
  principal: Record<string, string>,
  condition?: Record<string, unknown>,
): object {
  const statement: Record<string, unknown> = {
    Effect: "Allow",
    Principal: principal,
    Action: "sts:AssumeRole",
  };
  if (condition !== undefined) statement.Condition = condition;
  return { Version: "2012-10-17", Statement: [statement] };
}

/** The trust policy of a role a service assumes: `{ Service: service }`. */
export function serviceTrust(service: string): object {
  return trustPolicy({ Service: service });
}

/** The trust policy of a role the account `account` assumes: `{ AWS: arn:aws:iam::<account>:root }`. */
export function accountTrust(account: string): object {
  return trustPolicy({ AWS: `arn:aws:iam::${account}:root` });
}

/** The trust policy of a "plain role" (test-criteria.md): `lambda.amazonaws.com` and nothing else. */
export const LAMBDA_TRUST = serviceTrust("lambda.amazonaws.com");

/** A small permission document, for an inline or a customer managed policy a check makes. */
export const LIST_BUCKETS_POLICY = {
  Version: "2012-10-17",
  Statement: [
    { Effect: "Allow", Action: "s3:ListAllMyBuckets", Resource: "*" },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Signed requests.
// ---------------------------------------------------------------------------------------------------------------

/** An answer of a direct call, or the error that kept it from arriving. */
export type DirectAnswer = { status: number; body: string } | { error: string };

/** `status` of a direct answer, or its error, for the log. */
export function shown(answer: DirectAnswer): string {
  return "error" in answer
    ? `error ${answer.error}`
    : `status ${String(answer.status)}`;
}

const sha256Hex = (data: string) =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

/**
 * `POST /` with the form `body` straight to the emulator on `port` for `service`, header-signed with `credentials`
 * (the emulator's own key when none are given) over `content-type`, `host`, `x-amz-content-sha256`, `x-amz-date` and,
 * with a session, `x-amz-security-token`; TLS verified against the emulator's `ca.pem`.
 */
async function signedQuery(
  caller: Caller,
  port: number,
  service: "iam" | "sts",
  body: string,
  credentials?: Credentials,
): Promise<DirectAnswer> {
  const dir = emulatorDir(caller.home, port);
  const own = readEmulatorFiles(dir);
  if (!own) return { error: `the emulator files under ${dir} are incomplete` };
  const key = credentials ?? {
    accessKeyId: own.accessKeyId,
    secretAccessKey: own.secretAccessKey,
    sessionToken: "",
  };
  const ca = fs.readFileSync(path.join(dir, "ca.pem"));
  const amzDate = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    host: `127.0.0.1:${String(port)}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (key.sessionToken !== "")
    headers["x-amz-security-token"] = key.sessionToken;
  const names = Object.keys(headers).sort();
  const canonical = [
    "POST",
    "/",
    "",
    ...names.map((n) => `${n}:${headers[n]}`),
    "",
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${REGION}/${service}/aws4_request`;
  const toSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonical),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${key.secretAccessKey}`, day), REGION), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(toSign)
    .digest("hex");
  const sent: Record<string, string> = { ...headers };
  delete sent.host;
  sent.authorization =
    `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, ` +
    `Signature=${signature}`;
  sent["content-length"] = String(Buffer.byteLength(body));
  return new Promise((resolve) => {
    const request = https.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/",
        ca,
        agent: false,
        timeout: 5_000,
        headers: sent,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (text += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: text }),
        );
        response.on("error", (e) => resolve({ error: e.message }));
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("no answer within 5 s")),
    );
    request.on("error", (e) => resolve({ error: e.message }));
    request.end(body);
  });
}

/** An IAM action with its parameters (`Tags.member.1.Key` and so on, as the Query protocol writes them). */
export function directIam(
  caller: Caller,
  port: number,
  action: string,
  params: Record<string, string> = {},
  credentials?: Credentials,
): Promise<DirectAnswer> {
  const body = new URLSearchParams({
    Action: action,
    Version: "2010-05-08",
    ...params,
  }).toString();
  return signedQuery(caller, port, "iam", body, credentials);
}

/** An STS action with its parameters. */
export function directSts(
  caller: Caller,
  port: number,
  action: string,
  params: Record<string, string> = {},
  credentials?: Credentials,
): Promise<DirectAnswer> {
  const body = new URLSearchParams({
    Action: action,
    Version: "2011-06-15",
    ...params,
  }).toString();
  return signedQuery(caller, port, "sts", body, credentials);
}

// ---------------------------------------------------------------------------------------------------------------
// Answers.
// ---------------------------------------------------------------------------------------------------------------

/** An element of an XML answer: its name without a namespace prefix, its children, and its text when it has none. */
export interface XmlNode {
  name: string;
  children: XmlNode[];
  text: string;
}

const xmlText = (s: string) =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** The tree of an XML answer (declarations, comments and attributes left out); `null` when it is not well formed. */
export function xmlTree(xml: string): XmlNode | null {
  const root: XmlNode = { name: "", children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tag =
    /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^>]*?)?)(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  let last = 0;
  for (let m = tag.exec(xml); m !== null; m = tag.exec(xml)) {
    const between = xml.slice(last, m.index);
    last = tag.lastIndex;
    if (m[2] === undefined) continue;
    const top = stack[stack.length - 1];
    if (top.children.length === 0) top.text += between;
    const name = m[2].includes(":") ? m[2].slice(m[2].indexOf(":") + 1) : m[2];
    if (m[1] === "/") {
      if (stack.length < 2 || top.name !== name) return null;
      top.text = top.children.length === 0 ? xmlText(top.text) : "";
      stack.pop();
    } else {
      const node: XmlNode = { name, children: [], text: "" };
      top.children.push(node);
      if (m[4] !== "/") stack.push(node);
    }
  }
  return stack.length === 1 ? root : null;
}

/** The first child of `node` named `name`. */
export function child(
  node: XmlNode | null | undefined,
  name: string,
): XmlNode | null {
  return node?.children.find((c) => c.name === name) ?? null;
}

/** The node at `names` below `node`, one child after another. */
export function at(
  node: XmlNode | null | undefined,
  ...names: string[]
): XmlNode | null {
  let here: XmlNode | null = node ?? null;
  for (const name of names) here = child(here, name);
  return here;
}

/** The text of the node at `names`; `null` when there is no such node. */
export function textAt(
  node: XmlNode | null | undefined,
  ...names: string[]
): string | null {
  const found = at(node, ...names);
  return found === null ? null : found.text;
}

/** The `member` children of the node at `names`. */
export function members(
  node: XmlNode | null | undefined,
  ...names: string[]
): XmlNode[] {
  return (at(node, ...names)?.children ?? []).filter(
    (c) => c.name === "member",
  );
}

/** An answer read: its tree, or the refusal it carried (`code` and `message` of its `ErrorResponse`). */
export type Read =
  | { ok: true; status: number; xml: XmlNode }
  | { ok: false; status: number; code: string; message: string };

/** Reads `answer`: 200 with a well-formed body is `ok`; anything else a refusal (a transport error has status 0). */
export function readAnswer(answer: DirectAnswer): Read {
  if ("error" in answer)
    return { ok: false, status: 0, code: "NoAnswer", message: answer.error };
  const xml = xmlTree(answer.body);
  if (answer.status === 200 && xml !== null)
    return { ok: true, status: 200, xml };
  return {
    ok: false,
    status: answer.status,
    code: textAt(xml, "ErrorResponse", "Error", "Code") ?? "",
    message: textAt(xml, "ErrorResponse", "Error", "Message") ?? "",
  };
}

/** `status code message` of a refusal, or `status 200`, for the log and an assertion's message. */
export function shownRead(read: Read): string {
  return read.ok
    ? "status 200"
    : `status ${String(read.status)} ${read.code} ${read.message}`.trim();
}

/** An IAM action read (`readAnswer`), logged as `direct <action> <what>: <outcome>`. */
export async function iamAnswer(
  caller: Caller,
  port: number,
  action: string,
  params: Record<string, string> = {},
  what = "",
  credentials?: Credentials,
): Promise<Read> {
  const read = readAnswer(
    await directIam(caller, port, action, params, credentials),
  );
  caller.log(
    `direct ${action}${what === "" ? "" : ` ${what}`}: ${shownRead(read)}`,
  );
  return read;
}

/** The `<Action>Result` of an IAM action answered 200; fails the check (an assertion) otherwise. */
async function iamResult(
  caller: Caller,
  port: number,
  action: string,
  params: Record<string, string>,
  what: string,
): Promise<XmlNode> {
  const read = await iamAnswer(caller, port, action, params, what);
  expect(read.ok, `direct ${action} ${what}: ${shownRead(read)}`).toBe(true);
  if (!read.ok) throw new Error("unreachable");
  return (
    at(read.xml, `${action}Response`, `${action}Result`) ?? {
      name: `${action}Result`,
      children: [],
      text: "",
    }
  );
}

/** The `<Action>Result` of an IAM action answered 200; an environment failure otherwise (a check's Given). */
async function iamMade(
  caller: Caller,
  port: number,
  action: string,
  params: Record<string, string>,
  what: string,
): Promise<XmlNode> {
  const read = await iamAnswer(caller, port, action, params, what);
  if (!read.ok)
    throw new EnvError(`direct ${action} ${what} answered ${shownRead(read)}`);
  return (
    at(read.xml, `${action}Response`, `${action}Result`) ?? {
      name: `${action}Result`,
      children: [],
      text: "",
    }
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Roles and what they hold.
// ---------------------------------------------------------------------------------------------------------------

/** A tag of a role. */
export interface Tag {
  key: string;
  value: string;
}

/** A role as a direct `ListRoles`, `GetRole` or `CreateRole` returns it; each value as the emulator wrote it. */
export interface DirectRole {
  name: string;
  path: string;
  id: string;
  arn: string;
  /** The ISO date the emulator wrote. */
  createDate: string;
  /** `null` when the answer holds no `Description`; `''` when it holds an empty one. */
  description: string | null;
  maxSessionDuration: number | null;
  /** The trust policy's text, decoded once from the percent-encoding the emulator sends (R2). */
  trustPolicyText: string;
  /** The trust policy parsed; `null` when its text is not JSON. */
  trustPolicy: unknown;
  /** Only in a `GetRole` answer (R2); `null` elsewhere and when none is set. */
  permissionsBoundaryArn: string | null;
  /** Only in a `GetRole` answer (R2). */
  tags: Tag[];
  /** `RoleLastUsed.LastUsedDate` of a `GetRole` answer; `null` while the emulator reports none (R2). */
  lastUsedDate: string | null;
  lastUsedRegion: string | null;
}

function decodedOnce(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const nonEmpty = (text: string | null) =>
  text === null || text === "" ? null : text;

function tagsOf(node: XmlNode | null): Tag[] {
  return members(node, "Tags").map((m) => ({
    key: textAt(m, "Key") ?? "",
    value: textAt(m, "Value") ?? "",
  }));
}

/** A `Role` element (or a `member` of `Roles`) read. */
export function roleOf(node: XmlNode): DirectRole {
  const trustPolicyText = decodedOnce(
    textAt(node, "AssumeRolePolicyDocument") ?? "",
  );
  const duration = textAt(node, "MaxSessionDuration");
  return {
    name: textAt(node, "RoleName") ?? "",
    path: textAt(node, "Path") ?? "",
    id: textAt(node, "RoleId") ?? "",
    arn: textAt(node, "Arn") ?? "",
    createDate: textAt(node, "CreateDate") ?? "",
    description: textAt(node, "Description"),
    maxSessionDuration:
      duration === null || duration === "" ? null : Number(duration),
    trustPolicyText,
    trustPolicy: parsedJson(trustPolicyText),
    permissionsBoundaryArn: textAt(
      node,
      "PermissionsBoundary",
      "PermissionsBoundaryArn",
    ),
    tags: tagsOf(node),
    lastUsedDate: nonEmpty(textAt(node, "RoleLastUsed", "LastUsedDate")),
    lastUsedRegion: nonEmpty(textAt(node, "RoleLastUsed", "Region")),
  };
}

/** How many entries one page of a direct list asks for: the most the emulator takes (R2, 1001 is refused). */
const DIRECT_PAGE = "1000";

/** Pages of a list action, each `<Action>Result` in order, following `Marker` while `IsTruncated` is true. */
async function pages(
  caller: Caller,
  port: number,
  action: string,
  params: Record<string, string>,
  what: string,
): Promise<XmlNode[]> {
  const results: XmlNode[] = [];
  let marker: string | null = null;
  for (let page = 0; page < 100; page++) {
    const query: Record<string, string> = { ...params, MaxItems: DIRECT_PAGE };
    if (marker !== null) query.Marker = marker;
    const result = await iamResult(caller, port, action, query, what);
    results.push(result);
    if (textAt(result, "IsTruncated") !== "true") return results;
    marker = textAt(result, "Marker");
    expect(
      marker,
      `direct ${action} ${what}: truncated without a Marker`,
    ).not.toBeNull();
  }
  throw new Error(`direct ${action} ${what}: more than 100 pages`);
}

/** Every role of a direct `ListRoles`, in its order, page after page; under `pathPrefix` when given. */
export async function listRolesDirect(
  caller: Caller,
  port: number,
  pathPrefix?: string,
): Promise<DirectRole[]> {
  const params: Record<string, string> =
    pathPrefix === undefined ? {} : { PathPrefix: pathPrefix };
  const results = await pages(
    caller,
    port,
    "ListRoles",
    params,
    pathPrefix ?? "",
  );
  return results.flatMap((r) => members(r, "Roles").map(roleOf));
}

/** The names of a direct `ListRoles`, in its order. */
export async function roleNamesDirect(
  caller: Caller,
  port: number,
): Promise<string[]> {
  return (await listRolesDirect(caller, port)).map((r) => r.name);
}

/** The names of `names` that contain `text`, upper and lower case alike, in their order. */
export function containing(names: string[], text: string): string[] {
  const wanted = text.toLowerCase();
  return names.filter((n) => n.toLowerCase().includes(wanted));
}

/** A direct `GetRole` of `name`: the role, or the refusal (404 `NoSuchEntity` for a role the emulator lacks). */
export async function getRoleAnswer(
  caller: Caller,
  port: number,
  name: string,
): Promise<
  | { ok: true; role: DirectRole }
  | { ok: false; status: number; code: string; message: string }
> {
  const read = await iamAnswer(
    caller,
    port,
    "GetRole",
    { RoleName: name },
    name,
  );
  if (!read.ok) return read;
  const role = at(read.xml, "GetRoleResponse", "GetRoleResult", "Role");
  expect(role, `direct GetRole ${name}: no Role in the answer`).not.toBeNull();
  return { ok: true, role: roleOf(role as XmlNode) };
}

/** A direct `GetRole` of `name`; fails the check unless it is answered 200. */
export async function getRoleDirect(
  caller: Caller,
  port: number,
  name: string,
): Promise<DirectRole> {
  const answer = await getRoleAnswer(caller, port, name);
  expect(
    answer.ok,
    `direct GetRole ${name}: ${answer.ok ? "" : `${answer.code} ${answer.message}`}`,
  ).toBe(true);
  if (!answer.ok) throw new Error("unreachable");
  return answer.role;
}

/** Whether a direct `GetRole` of `name` answers that the role cannot be found (404 `NoSuchEntity`). */
export async function roleIsGone(
  caller: Caller,
  port: number,
  name: string,
): Promise<boolean> {
  const answer = await getRoleAnswer(caller, port, name);
  return !answer.ok && answer.status === 404 && answer.code === "NoSuchEntity";
}

/** A policy attached to a role. */
export interface AttachedPolicy {
  name: string;
  arn: string;
}

/** The managed policies of a direct `ListAttachedRolePolicies` of `role`, in its order. */
export async function attachedPoliciesDirect(
  caller: Caller,
  port: number,
  role: string,
): Promise<AttachedPolicy[]> {
  const results = await pages(
    caller,
    port,
    "ListAttachedRolePolicies",
    { RoleName: role },
    role,
  );
  return results.flatMap((r) =>
    members(r, "AttachedPolicies").map((m) => ({
      name: textAt(m, "PolicyName") ?? "",
      arn: textAt(m, "PolicyArn") ?? "",
    })),
  );
}

/** The inline policy names of a direct `ListRolePolicies` of `role`, in its order. */
export async function inlinePolicyNamesDirect(
  caller: Caller,
  port: number,
  role: string,
): Promise<string[]> {
  const results = await pages(
    caller,
    port,
    "ListRolePolicies",
    { RoleName: role },
    role,
  );
  return results.flatMap((r) => members(r, "PolicyNames").map((m) => m.text));
}

/** The names of the instance profiles of a direct `ListInstanceProfilesForRole` of `role`, in its order. */
export async function instanceProfilesForRoleDirect(
  caller: Caller,
  port: number,
  role: string,
): Promise<string[]> {
  const results = await pages(
    caller,
    port,
    "ListInstanceProfilesForRole",
    { RoleName: role },
    role,
  );
  return results.flatMap((r) =>
    members(r, "InstanceProfiles").map(
      (m) => textAt(m, "InstanceProfileName") ?? "",
    ),
  );
}

/** An instance profile of a direct `GetInstanceProfile`: its name, ARN and the names of the roles it holds. */
export interface DirectInstanceProfile {
  name: string;
  arn: string;
  roles: string[];
}

/** A direct `GetInstanceProfile` of `name`; fails the check unless it is answered 200. */
export async function getInstanceProfileDirect(
  caller: Caller,
  port: number,
  name: string,
): Promise<DirectInstanceProfile> {
  const result = await iamResult(
    caller,
    port,
    "GetInstanceProfile",
    { InstanceProfileName: name },
    name,
  );
  const profile = child(result, "InstanceProfile");
  return {
    name: textAt(profile, "InstanceProfileName") ?? "",
    arn: textAt(profile, "Arn") ?? "",
    roles: members(profile, "Roles").map((m) => textAt(m, "RoleName") ?? ""),
  };
}

/** A direct `GetPolicy` of `arn`: the policy's name and ARN, or the refusal. */
export async function getPolicyAnswer(
  caller: Caller,
  port: number,
  arn: string,
): Promise<
  | { ok: true; name: string; arn: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const read = await iamAnswer(
    caller,
    port,
    "GetPolicy",
    { PolicyArn: arn },
    arn,
  );
  if (!read.ok) return read;
  const policy = at(read.xml, "GetPolicyResponse", "GetPolicyResult", "Policy");
  return {
    ok: true,
    name: textAt(policy, "PolicyName") ?? "",
    arn: textAt(policy, "Arn") ?? "",
  };
}

/** The caller's own user of a direct `GetUser` without a user name, and the account of its ARN (R2). */
export interface CallerUser {
  name: string;
  arn: string;
  /** The account of `arn` (`arn:aws:iam::<account>:user/…`). */
  account: string;
}

/** A direct `GetUser` without a user name; fails the check unless it is answered 200. */
export async function callerUserDirect(
  caller: Caller,
  port: number,
): Promise<CallerUser> {
  const result = await iamResult(caller, port, "GetUser", {}, "of the caller");
  const arn = textAt(result, "User", "Arn") ?? "";
  const account = /^arn:aws:iam::(\d{12}):/.exec(arn)?.[1] ?? "";
  expect(account, `direct GetUser: the ARN ${arn} holds no account`).not.toBe(
    "",
  );
  return { name: textAt(result, "User", "UserName") ?? "", arn, account };
}

/** The `Tags.member.<n>.Key` and `…Value` parameters of `tags`. */
function tagParams(tags: Tag[]): Record<string, string> {
  const params: Record<string, string> = {};
  tags.forEach((t, i) => {
    params[`Tags.member.${String(i + 1)}.Key`] = t.key;
    params[`Tags.member.${String(i + 1)}.Value`] = t.value;
  });
  return params;
}

/** What a role a check makes holds besides its name. */
export interface RoleOptions {
  /** The trust policy, as an object or as the text sent; `LAMBDA_TRUST` (a plain role) when not given. */
  trust?: object | string;
  path?: string;
  description?: string;
  maxSessionDuration?: number;
  tags?: Tag[];
  /** The ARN of a managed policy set as the role's permissions boundary. */
  boundary?: string;
}

/** `CreateRole`'s parameters for `name` with `options`. */
export function createRoleParams(
  name: string,
  options: RoleOptions = {},
): Record<string, string> {
  const trust = options.trust ?? LAMBDA_TRUST;
  const params: Record<string, string> = {
    RoleName: name,
    AssumeRolePolicyDocument:
      typeof trust === "string" ? trust : JSON.stringify(trust),
  };
  if (options.path !== undefined) params.Path = options.path;
  if (options.description !== undefined)
    params.Description = options.description;
  if (options.maxSessionDuration !== undefined)
    params.MaxSessionDuration = String(options.maxSessionDuration);
  if (options.boundary !== undefined)
    params.PermissionsBoundary = options.boundary;
  return { ...params, ...tagParams(options.tags ?? []) };
}

/**
 * Takes `role` apart and deletes it straight through the emulator, in the order the emulator asks (R2, `DeleteRole`):
 * out of every instance profile, its managed policies detached, its inline policies deleted, then `DeleteRole`, or
 * `DeleteServiceLinkedRole` for a role under `/aws-service-role/`. Returns the last step's read; a role the emulator
 * does not hold is answered 404 `NoSuchEntity` by the first step and nothing else is sent.
 */
export async function deleteRoleDirect(
  caller: Caller,
  port: number,
  role: string,
): Promise<Read> {
  const got = await iamAnswer(
    caller,
    port,
    "GetRole",
    { RoleName: role },
    role,
  );
  if (!got.ok) return got;
  const rolePath =
    textAt(got.xml, "GetRoleResponse", "GetRoleResult", "Role", "Path") ?? "/";
  const list = async (
    action: string,
    field: string,
    pick: (m: XmlNode) => string,
  ) => {
    const read = await iamAnswer(
      caller,
      port,
      action,
      { RoleName: role, MaxItems: DIRECT_PAGE },
      role,
    );
    return read.ok
      ? members(
          at(read.xml, `${action}Response`, `${action}Result`),
          field,
        ).map(pick)
      : [];
  };
  for (const profile of await list(
    "ListInstanceProfilesForRole",
    "InstanceProfiles",
    (m) => textAt(m, "InstanceProfileName") ?? "",
  )) {
    await iamAnswer(
      caller,
      port,
      "RemoveRoleFromInstanceProfile",
      { InstanceProfileName: profile, RoleName: role },
      `${role} from ${profile}`,
    );
  }
  for (const arn of await list(
    "ListAttachedRolePolicies",
    "AttachedPolicies",
    (m) => textAt(m, "PolicyArn") ?? "",
  )) {
    await iamAnswer(
      caller,
      port,
      "DetachRolePolicy",
      { RoleName: role, PolicyArn: arn },
      `${arn} from ${role}`,
    );
  }
  for (const policy of await list(
    "ListRolePolicies",
    "PolicyNames",
    (m) => m.text,
  )) {
    await iamAnswer(
      caller,
      port,
      "DeleteRolePolicy",
      { RoleName: role, PolicyName: policy },
      `${policy} of ${role}`,
    );
  }
  return rolePath.startsWith(SERVICE_ROLE_PATH)
    ? iamAnswer(
        caller,
        port,
        "DeleteServiceLinkedRole",
        { RoleName: role },
        role,
      )
    : iamAnswer(caller, port, "DeleteRole", { RoleName: role }, role);
}

/** Who owns what a seed makes: a check's `Ctx`, or nothing for a seed that stays (`iam-seed-structure.ts`). */
type Owner = Caller & Partial<Pick<Ctx, "own">>;

/**
 * The roles, customer managed policies and instance profiles made directly on the emulator on `port`, and the roles
 * Studio made that a check `adopt`s. Given a `Ctx`, it is owned by the check and takes everything apart when the check
 * ends (the file's header); given only a caller, nothing is removed.
 */
export class IamSeeded {
  private readonly roles: string[] = [];
  private readonly policies: string[] = [];
  private readonly profiles: string[] = [];

  constructor(
    private readonly owner: Owner,
    readonly port: number,
  ) {
    owner.own?.(this);
  }

  /** `CreateRole name` with `options` (a plain role without any); returns the role the emulator answered. */
  async role(name: string, options: RoleOptions = {}): Promise<DirectRole> {
    this.roles.push(name);
    const result = await iamMade(
      this.owner,
      this.port,
      "CreateRole",
      createRoleParams(name, options),
      name,
    );
    const role = child(result, "Role");
    if (role === null)
      throw new EnvError(`direct CreateRole ${name}: no Role in the answer`);
    return roleOf(role);
  }

  /** `CreatePolicy name` with `document` (a customer managed policy); returns its ARN. */
  async policy(
    name: string,
    document: object = LIST_BUCKETS_POLICY,
  ): Promise<string> {
    const result = await iamMade(
      this.owner,
      this.port,
      "CreatePolicy",
      { PolicyName: name, PolicyDocument: JSON.stringify(document) },
      name,
    );
    const arn = textAt(result, "Policy", "Arn");
    if (arn === null || arn === "")
      throw new EnvError(`direct CreatePolicy ${name}: no Arn in the answer`);
    this.policies.push(arn);
    return arn;
  }

  /** `AttachRolePolicy` of the managed policy `arn` to `role`. */
  async attach(role: string, arn: string): Promise<void> {
    await iamMade(
      this.owner,
      this.port,
      "AttachRolePolicy",
      { RoleName: role, PolicyArn: arn },
      `${arn} to ${role}`,
    );
  }

  /** `PutRolePolicy`: the inline policy `name` of `role` with `document`. */
  async inline(
    role: string,
    name: string,
    document: object = LIST_BUCKETS_POLICY,
  ): Promise<void> {
    await iamMade(
      this.owner,
      this.port,
      "PutRolePolicy",
      {
        RoleName: role,
        PolicyName: name,
        PolicyDocument: JSON.stringify(document),
      },
      `${name} of ${role}`,
    );
  }

  /** `CreateInstanceProfile name`. */
  async profile(name: string): Promise<void> {
    this.profiles.push(name);
    await iamMade(
      this.owner,
      this.port,
      "CreateInstanceProfile",
      { InstanceProfileName: name },
      name,
    );
  }

  /** `AddRoleToInstanceProfile`: `role` into the instance profile `profile`. */
  async addToProfile(profile: string, role: string): Promise<void> {
    await iamMade(
      this.owner,
      this.port,
      "AddRoleToInstanceProfile",
      { InstanceProfileName: profile, RoleName: role },
      `${role} to ${profile}`,
    );
  }

  /** `TagRole`: `tags` on `role`. */
  async tag(role: string, tags: Tag[]): Promise<void> {
    await iamMade(
      this.owner,
      this.port,
      "TagRole",
      { RoleName: role, ...tagParams(tags) },
      role,
    );
  }

  /** `PutRolePermissionsBoundary`: the managed policy `arn` as the boundary of `role`. */
  async boundary(role: string, arn: string): Promise<void> {
    await iamMade(
      this.owner,
      this.port,
      "PutRolePermissionsBoundary",
      { RoleName: role, PermissionsBoundary: arn },
      `${arn} on ${role}`,
    );
  }

  /** `UpdateRole` of `role` with `Description` and/or `MaxSessionDuration`, as a check's own step. */
  async update(
    role: string,
    change: { description?: string; maxSessionDuration?: number },
  ): Promise<void> {
    const params: Record<string, string> = { RoleName: role };
    if (change.description !== undefined)
      params.Description = change.description;
    if (change.maxSessionDuration !== undefined)
      params.MaxSessionDuration = String(change.maxSessionDuration);
    await iamMade(this.owner, this.port, "UpdateRole", params, role);
  }

  /** `sts:AssumeRole` of the role `arn`, signed with the emulator's key; returns the role's credentials. */
  async assume(
    arn: string,
    sessionName = "emuforge-check",
  ): Promise<Credentials> {
    const read = readAnswer(
      await directSts(this.owner, this.port, "AssumeRole", {
        RoleArn: arn,
        RoleSessionName: sessionName,
      }),
    );
    this.owner.log(`direct AssumeRole ${arn}: ${shownRead(read)}`);
    if (!read.ok)
      throw new EnvError(
        `direct AssumeRole ${arn} answered ${shownRead(read)}`,
      );
    const credentials = at(
      read.xml,
      "AssumeRoleResponse",
      "AssumeRoleResult",
      "Credentials",
    );
    const made = {
      accessKeyId: textAt(credentials, "AccessKeyId") ?? "",
      secretAccessKey: textAt(credentials, "SecretAccessKey") ?? "",
      sessionToken: textAt(credentials, "SessionToken") ?? "",
    };
    if (
      made.accessKeyId === "" ||
      made.secretAccessKey === "" ||
      made.sessionToken === ""
    ) {
      throw new EnvError(
        `direct AssumeRole ${arn}: the answer holds no complete credentials`,
      );
    }
    return made;
  }

  /** A role Studio made for the check: it is taken apart and deleted when the check ends, if it is still there. */
  adopt(name: string): void {
    if (!this.roles.includes(name)) this.roles.push(name);
  }

  /** Whether `name` was made or adopted by this check and is not removed yet. */
  has(name: string): boolean {
    return this.roles.includes(name);
  }

  /** Takes `role` apart and deletes it now (a check's step); an environment failure unless the deletion is 200. */
  async remove(role: string): Promise<void> {
    const read = await deleteRoleDirect(this.owner, this.port, role);
    if (!read.ok)
      throw new EnvError(
        `direct deletion of ${role} answered ${shownRead(read)}`,
      );
    this.forget(role);
  }

  /** `role` is gone (Studio deleted it): it is no longer removed at the end. */
  forget(role: string): void {
    const index = this.roles.indexOf(role);
    if (index >= 0) this.roles.splice(index, 1);
  }

  async dispose(): Promise<void> {
    const caller: Caller = {
      home: this.owner.home,
      log: (line) => this.owner.log(`cleanup ${line}`),
    };
    for (const role of [...this.roles].reverse())
      await deleteRoleDirect(caller, this.port, role);
    for (const profile of [...this.profiles].reverse()) {
      const read = await iamAnswer(
        caller,
        this.port,
        "GetInstanceProfile",
        { InstanceProfileName: profile },
        profile,
      );
      if (!read.ok) continue;
      const held = members(
        at(
          read.xml,
          "GetInstanceProfileResponse",
          "GetInstanceProfileResult",
          "InstanceProfile",
        ),
        "Roles",
      );
      for (const m of held) {
        const role = textAt(m, "RoleName") ?? "";
        await iamAnswer(
          caller,
          this.port,
          "RemoveRoleFromInstanceProfile",
          { InstanceProfileName: profile, RoleName: role },
          `${role} from ${profile}`,
        );
      }
      await iamAnswer(
        caller,
        this.port,
        "DeleteInstanceProfile",
        { InstanceProfileName: profile },
        profile,
      );
    }
    for (const arn of [...this.policies].reverse()) {
      await iamAnswer(
        caller,
        this.port,
        "DeletePolicy",
        { PolicyArn: arn },
        arn,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The AWS CLI.
// ---------------------------------------------------------------------------------------------------------------

/** How long one AWS CLI command may take (the CLI's own start included). */
const CLI_BOUND_MS = 60_000;

/** What an AWS CLI command printed and how it ended. */
export interface CliRun {
  /** The exit code; `null` when the command could not be started or ran out of time. */
  exit: number | null;
  stdout: string;
  stderr: string;
}

/**
 * The environment of an AWS CLI command for the emulator on `port`: `PATH`, a scratch `HOME` under the run's `tmp`
 * (so the CLI finds no file of the machine's `~/.aws`), and that emulator's endpoint on loopback, credentials file,
 * config path and `ca.pem`. Nothing else of the process's environment is passed: no profile, no key, no proxy.
 */
export function cliEnvironment(
  ctx: Pick<Ctx, "home" | "tmp">,
  port: number,
): NodeJS.ProcessEnv {
  const dir = emulatorDir(ctx.home, port);
  const home = path.join(ctx.tmp, "aws-cli-home");
  fs.mkdirSync(home, { recursive: true });
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    AWS_ENDPOINT_URL: `https://127.0.0.1:${String(port)}`,
    AWS_SHARED_CREDENTIALS_FILE: path.join(dir, "emulator_credentials"),
    AWS_CONFIG_FILE: path.join(dir, "config"),
    AWS_CA_BUNDLE: path.join(dir, "ca.pem"),
    AWS_REGION: REGION,
    AWS_DEFAULT_REGION: REGION,
    AWS_PAGER: "",
    AWS_CLI_AUTO_PROMPT: "off",
    AWS_MAX_ATTEMPTS: "1",
    AWS_EC2_METADATA_DISABLED: "true",
  };
}

/**
 * `aws <args> --output json` against the emulator on `port`, in the environment of `cliEnvironment`. The command and
 * its exit code are logged, its output too (redacted by the log). The emulator files must be there: their absence
 * is an environment failure.
 */
export async function awsCli(
  ctx: Pick<Ctx, "home" | "tmp" | "log">,
  port: number,
  args: string[],
): Promise<CliRun> {
  if (!readEmulatorFiles(emulatorDir(ctx.home, port))) {
    throw new EnvError(
      `the emulator files under ${emulatorDir(ctx.home, port)} are incomplete`,
    );
  }
  const argv = [...args, "--output", "json"];
  const run = await new Promise<CliRun>((resolve) => {
    execFile(
      "aws",
      argv,
      {
        env: cliEnvironment(ctx, port),
        timeout: CLI_BOUND_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof error.code === "number"
              ? error.code
              : null;
        if (error !== null && code === null) {
          resolve({ exit: null, stdout, stderr: `${stderr}${error.message}` });
        } else {
          resolve({ exit: code, stdout, stderr });
        }
      },
    );
  });
  ctx.log(`aws ${argv.join(" ")}: exit ${String(run.exit)}`);
  if (run.stdout !== "") ctx.log(`  stdout: ${run.stdout.trim()}`);
  if (run.stderr !== "") ctx.log(`  stderr: ${run.stderr.trim()}`);
  if (run.exit === null)
    throw new EnvError(
      `aws ${args.join(" ")} did not run: ${run.stderr.trim()}`,
    );
  return run;
}
