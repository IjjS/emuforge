// Support of the API Gateway checks (issue 69): the direct calls that make and read what a check needs ("made
// outside", "the emulator reports"), the requests a check sends to a built API itself ("called from outside"), the
// cleanup, and the locators of the service's screens. Everything a check creates, and everything Studio creates in
// it, carries the check's prefix and is removed when the check ends.

import { APIGateway } from '@aws-sdk/client-api-gateway';
import { ApiGatewayV2 } from '@aws-sdk/client-apigatewayv2';
import { IAM } from '@aws-sdk/client-iam';
import { Lambda, waitUntilFunctionActiveV2 } from '@aws-sdk/client-lambda';
import createWrapper, { type ElementWrapper } from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { EnvError, expect, type Ctx } from '../../support/check';
import { emulatorDir, readEmulatorFiles } from '../../support/emulator';
import { checkPrefix, creationDateText, SEOUL } from '../../support/service-screens';
import { startStack } from '../../support/stack';

// ---------------------------------------------------------------------------------------------------------------
// The check's stack and its direct clients.
// ---------------------------------------------------------------------------------------------------------------

export const REGION = 'us-east-1';
export const ACCOUNT = '000000000000';

/** How long a check waits for the emulator to make a Lambda function ready. */
const FUNCTION_READY_SECONDS = 120;

export type Fixture = Awaited<ReturnType<typeof fixture>>;

/**
 * Starts the check's stack on the run's emulator and gives its prefix `<p>` and the four direct clients. When the
 * check ends, every REST, HTTP and WebSocket API whose name starts with the prefix is deleted, made outside or by
 * Studio, and every function and role the check made, each kind by a disposer of its own.
 */
export async function fixture(ctx: Ctx) {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const dir = emulatorDir(ctx.home, port);
  const files = readEmulatorFiles(dir);
  if (!files) throw new EnvError('the emulator wrote no keys for this run');
  const ca = readFileSync(path.join(dir, 'ca.pem'));
  const config = {
    endpoint: `https://127.0.0.1:${String(port)}`,
    region: REGION,
    credentials: { accessKeyId: files.accessKeyId, secretAccessKey: files.secretAccessKey },
    requestHandler: { httpsAgent: { ca } },
    maxAttempts: 1,
  };
  const rest = new APIGateway(config);
  const v2 = new ApiGatewayV2(config);
  const lambda = new Lambda(config);
  const iam = new IAM(config);
  // The tag is short and of one length for every check: a name made of `<p>` and a suffix stays inside the 64
  // characters a role's or a function's name may have, and no check's prefix starts another's.
  const prefix = checkPrefix(ctx, `ag${createHash('sha1').update(ctx.id).digest('hex').slice(0, 8)}`);
  const functions: string[] = [];
  const roles: string[] = [];

  // What the check owns is disposed of last registered first, and each on its own: a list or a deletion that fails
  // stops none of the others. So the APIs go first, then the functions, then their roles, and the clients last.
  const logged = (e: unknown) => ctx.log(`cleanup: ${String(e)}`);
  ctx.own({
    dispose: async () => {
      for (const client of [rest, v2, lambda, iam]) client.destroy();
    },
  });
  ctx.own({
    dispose: async () => {
      for (const name of roles) await iam.deleteRole({ RoleName: name }).catch(logged);
    },
  });
  ctx.own({
    dispose: async () => {
      for (const name of functions) await lambda.deleteFunction({ FunctionName: name }).catch(logged);
    },
  });
  ctx.own({
    dispose: async () => {
      for (const api of await v2ApisNamed(v2, prefix)) await v2.deleteApi({ ApiId: api.ApiId }).catch(logged);
    },
  });
  ctx.own({
    dispose: async () => {
      for (const api of await restApisNamed(rest, prefix)) await rest.deleteRestApi({ restApiId: api.id }).catch(logged);
    },
  });

  /**
   * A small Lambda function `<p>-<suffix>` made outside, ready to be invoked; its answer names the function
   * (`answerOf`). Its policy holds no statement.
   */
  async function makeFunction(suffix: string): Promise<{ name: string; arn: string; answer: string }> {
    const name = `${prefix}-${suffix}`;
    const role = await iam.createRole({
      RoleName: name,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      }),
    });
    roles.push(name);
    const answer = answerOf(name);
    const code = `def handler(event, context):\n    return {"statusCode": 200, "body": ${JSON.stringify(answer)}}\n`;
    functions.push(name);
    const made = await lambda.createFunction({
      FunctionName: name,
      Runtime: 'python3.12',
      Handler: 'index.handler',
      Role: role.Role?.Arn ?? `arn:aws:iam::${ACCOUNT}:role/${name}`,
      Code: { ZipFile: storedZip('index.py', code) },
    });
    await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: FUNCTION_READY_SECONDS }, { FunctionName: name });
    if (!made.FunctionArn) throw new Error(`CreateFunction gave no ARN for ${name}`);
    ctx.log(`made outside: function ${name}`);
    return { name, arn: made.FunctionArn, answer };
  }

  /** A request the check itself sends to the emulator on loopback, with the run's CA; redirects are not followed. */
  function callOutside(pathname: string, options: { host?: string; method?: string } = {}): Promise<Outside> {
    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          host: '127.0.0.1',
          port,
          path: pathname,
          method: options.method ?? 'GET',
          ca,
          // The certificate names `localhost` and the loopback addresses; without this Node would look for the
          // `Host` header's name in it.
          servername: 'localhost',
          headers: options.host === undefined ? {} : { Host: options.host },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const answer = {
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
              location: response.headers.location,
            };
            ctx.log(`called from outside: ${options.method ?? 'GET'} ${options.host ?? ''}${pathname} -> ${String(answer.status)}`);
            resolve(answer);
          });
        },
      );
      request.setTimeout(30_000, () => request.destroy(new Error(`no answer to ${pathname} in 30s`)));
      request.on('error', reject);
      request.end();
    });
  }

  return {
    ...stack,
    port,
    prefix,
    rest,
    v2,
    lambda,
    iam,
    makeFunction,
    callOutside,
    /** A REST stage's path on the emulator: `/_aws/execute-api/<id>/<stage><resource path>`. */
    restStagePath: (apiId: string, stage: string, resourcePath: string) =>
      `/_aws/execute-api/${apiId}/${stage}${resourcePath}`,
    /** A REST stage's address on the emulator, as Studio shows and sends it. */
    restStageAddress: (apiId: string, stage: string) =>
      `https://127.0.0.1:${String(port)}/_aws/execute-api/${apiId}/${stage}`,
    /** An HTTP API called by its host name on the emulator's port. */
    callHttpApi: (apiId: string, pathname: string) => callOutside(pathname, { host: v2Host(apiId) }),
  };
}

export interface Outside {
  status: number;
  body: string;
  location: string | undefined;
}

/** The body a function made by `makeFunction` answers with. */
export function answerOf(functionName: string): string {
  return `answer of ${functionName}`;
}

/** The host name an HTTP API answers to on the emulator's port. */
export function v2Host(apiId: string): string {
  return `${apiId}.execute-api.${REGION}.amazonaws.com`;
}

/** The source ARN Studio's permission names for an API: every stage, method and path of it. */
export function sourceArn(apiId: string): string {
  return `arn:aws:execute-api:${REGION}:${ACCOUNT}:${apiId}/*/*/*`;
}

/** The integration URI of a REST Lambda proxy integration to the function `arn`. */
export function lambdaUri(arn: string): string {
  return `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${arn}/invocations`;
}

/** Every REST API the emulator holds whose name starts with `prefix`, read through every page. */
export async function restApisNamed(rest: APIGateway, prefix: string) {
  const found: { id: string; name: string }[] = [];
  let position: string | undefined;
  do {
    const page = await rest.getRestApis({ limit: 500, ...(position === undefined ? {} : { position }) });
    for (const api of page.items ?? []) {
      if (api.id && api.name?.startsWith(prefix)) found.push({ id: api.id, name: api.name });
    }
    position = page.position;
  } while (position !== undefined);
  return found;
}

/** Every HTTP and WebSocket API the emulator holds whose name starts with `prefix`, read through every page. */
export async function v2ApisNamed(v2: ApiGatewayV2, prefix: string) {
  const found: { ApiId: string; Name: string }[] = [];
  let token: string | undefined;
  do {
    const page = await v2.getApis({ MaxResults: '100', ...(token === undefined ? {} : { NextToken: token }) });
    for (const api of page.Items ?? []) {
      if (api.ApiId && api.Name?.startsWith(prefix)) found.push({ ApiId: api.ApiId, Name: api.Name });
    }
    token = page.NextToken;
  } while (token !== undefined);
  return found;
}

/** The statements of a function's policy, as the emulator reports them; none when it has no policy. */
export async function policyStatements(lambda: Lambda, functionName: string): Promise<PolicyStatement[]> {
  try {
    const answer = await lambda.getPolicy({ FunctionName: functionName });
    const policy = JSON.parse(answer.Policy ?? '{}') as { Statement?: PolicyStatement[] };
    return policy.Statement ?? [];
  } catch (e) {
    if ((e as { name?: string }).name === 'ResourceNotFoundException') return [];
    throw e;
  }
}

export interface PolicyStatement {
  Sid?: string;
  Effect?: string;
  Principal?: { Service?: string };
  Action?: string;
  Resource?: string;
  Condition?: { ArnLike?: Record<string, string> };
}

/** Whether `statement` allows API Gateway to invoke the function for the API's source ARN. */
export function allowsApi(statement: PolicyStatement, apiId: string): boolean {
  return (
    statement.Effect === 'Allow' &&
    statement.Principal?.Service === 'apigateway.amazonaws.com' &&
    statement.Action === 'lambda:InvokeFunction' &&
    statement.Condition?.ArnLike?.['AWS:SourceArn'] === sourceArn(apiId)
  );
}

/** The root resource's ID of a REST API. */
export async function rootId(rest: APIGateway, apiId: string): Promise<string> {
  const resources = await rest.getResources({ restApiId: apiId, limit: 500 });
  const root = resources.items?.find((resource) => resource.path === '/');
  if (!root?.id) throw new Error(`the REST API ${apiId} reports no root resource`);
  return root.id;
}

/** A REST method with a mock integration answering 200 with `body`, made outside. */
export async function putMockMethod(
  rest: APIGateway,
  apiId: string,
  resourceId: string,
  httpMethod: string,
  body: string,
): Promise<void> {
  const at = { restApiId: apiId, resourceId, httpMethod };
  await rest.putMethod({ ...at, authorizationType: 'NONE' });
  await rest.putIntegration({ ...at, type: 'MOCK', requestTemplates: { 'application/json': '{"statusCode": 200}' } });
  await rest.putMethodResponse({ ...at, statusCode: '200' });
  await rest.putIntegrationResponse({ ...at, statusCode: '200', responseTemplates: { 'application/json': body } });
}

/**
 * A zip archive of one stored (uncompressed) file `name` holding `text`: one local file header, the data, one central
 * directory header and the end record (PKWARE APPNOTE 6.3). The check's own; it shares no code with Studio.
 */
function storedZip(name: string, text: string): Buffer {
  const fileName = Buffer.from(name, 'utf8');
  const data = Buffer.from(text, 'utf8');
  const crc = crc32(data);
  const dosDate = (1 << 5) | 1; // 1980-01-01, so the same input gives the same archive
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(local.length + fileName.length + data.length, 16);
  return Buffer.concat([local, fileName, data, central, fileName, end]);
}

/** CRC-32 (the polynomial 0xEDB88320 reflected), as a zip archive records it. */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Paths.
// ---------------------------------------------------------------------------------------------------------------

export const SERVICE = '/aws/apigateway';
export const APIS = `${SERVICE}/apis`;
export const CREATE_API = `${APIS}/create`;
export const restApiPath = (id: string) => `${APIS}/rest/${id}`;
export const v2ApiPath = (id: string) => `${APIS}/v2/${id}`;
export const createMethodPath = (id: string) => `${restApiPath(id)}/methods/create`;
export const createRoutePath = (id: string) => `${v2ApiPath(id)}/routes/create`;

/** The pattern of a page's address: `pathname` with any query the scenario does not name. */
export function at(pathname: string): RegExp {
  return new RegExp(`${pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

// ---------------------------------------------------------------------------------------------------------------
// Locators. What is inside a Cloudscape component is found with Cloudscape's selectors (`ui`); everything else by
// role and accessible name.
// ---------------------------------------------------------------------------------------------------------------

export const ui = createWrapper();

/** A Cloudscape wrapper's selector for use below a locator: without the wrapper root's `body`. */
export function sel(wrapper: ElementWrapper): string {
  return wrapper.toSelector().replace(/^body /, '');
}

/** `inner`'s selector below an element `outer` already found: the part of it after `outer`'s own. */
function below(outer: ElementWrapper, inner: ElementWrapper): string {
  return inner.toSelector().slice(outer.toSelector().length).trim();
}

export const button = (root: Page | Locator, name: string) => root.getByRole('button', { name, exact: true });
export const link = (root: Page | Locator, name: string) => root.getByRole('link', { name, exact: true });
export const textbox = (root: Page | Locator, name: string) => root.getByRole('textbox', { name, exact: true });

/** The "Creation time" text for a date of a direct answer, in the zone the checks' browser is set to. */
export const dateText = (date: Date) => creationDateText(date.toISOString(), SEOUL);

/** The page's `h1` text. */
export function pageHeading(page: Page): Locator {
  return page.locator('h1').locator(sel(ui.findHeader().findHeadingText()).replace(/^\S+ /, ''));
}

/** The success results the page shows, as Cloudscape's flash items. */
export const successes = (page: Page) => page.locator(sel(ui.findFlashbar().findItemsByType('success')));
/** The warnings the page shows, as Cloudscape's flash items. */
export const warnings = (page: Page) => page.locator(sel(ui.findFlashbar().findItemsByType('warning')));

/** The page shows exactly the success `message` (and no other success). */
export async function expectResult(page: Page, message: string): Promise<void> {
  await expect(successes(page)).toHaveText([message]);
}

// -- tables --------------------------------------------------------------------------------------------------------

const table = ui.findTable();

/** The Cloudscape table whose own header reads `title`; the page's only table when `title` is left out. */
export function tableOf(page: Page, title?: string): Locator {
  const tables = page.locator(sel(table));
  if (title === undefined) return tables;
  const heading = below(table, table.findHeaderSlot().findHeader().findHeadingText());
  return tables.filter({ has: page.locator(heading).filter({ hasText: new RegExp(`^${title}$`) }) });
}

/** The body rows of a table. */
export const rowsOf = (tableRoot: Locator) => tableRoot.locator(below(table, table.findRows()));
/** What a table shows in place of rows. */
export const emptyOf = (tableRoot: Locator) => tableRoot.locator(below(table, table.findEmptySlot()));
/** The table's loading text, gone once the list is read. */
export const loadingOf = (tableRoot: Locator) => tableRoot.locator(below(table, table.findLoadingText()));

/** Whether the table's rows begin with a selection control, which Cloudscape counts as the first column. */
async function selectionColumns(tableRoot: Locator): Promise<number> {
  return (await tableRoot.locator(below(table, table.findRowSelectionArea(1))).count()) > 0 ? 1 : 0;
}

/**
 * The body cell of the row `row` in the data column `column`, both counted from 1; a selection column is not a
 * data column, so column 1 is the row's name in every table of the service.
 */
async function cellAt(tableRoot: Locator, row: number, column: number): Promise<Locator> {
  return tableRoot.locator(below(table, table.findBodyCell(row, column + (await selectionColumns(tableRoot)))));
}

/** The text of the data column `column` in every row now, top to bottom. */
export async function columnTexts(tableRoot: Locator, column: number): Promise<string[]> {
  const offset = await selectionColumns(tableRoot);
  const count = await rowsOf(tableRoot).count();
  const texts: string[] = [];
  for (let row = 1; row <= count; row++) {
    const cell = tableRoot.locator(below(table, table.findBodyCell(row, column + offset)));
    texts.push(((await cell.textContent()) ?? '').trim());
  }
  return texts;
}

/** The place, from 1, of the one row whose name is exactly `name`; waits until the table shows it. */
async function rowIndexOf(tableRoot: Locator, name: string): Promise<number> {
  let places: number[] = [];
  await expect
    .poll(async () => {
      const names = await columnTexts(tableRoot, 1);
      places = names.flatMap((shown, at) => (shown === name ? [at + 1] : []));
      return places.length;
    }, `the rows named "${name}"`)
    .toBe(1);
  return places[0]!;
}

/** The table shows `count` rows whose name is exactly `name`. */
export async function expectNamed(tableRoot: Locator, name: string, count: number): Promise<void> {
  await expect
    .poll(async () => (await columnTexts(tableRoot, 1)).filter((shown) => shown === name).length, `rows named "${name}"`)
    .toBe(count);
}

/** The cell of the row named `name` in the data column `column` (1 is the name). */
export async function cellOf(tableRoot: Locator, name: string, column: number): Promise<Locator> {
  return cellAt(tableRoot, await rowIndexOf(tableRoot, name), column);
}

/** The text of every data cell of the row named `name`, in the columns' order; `null` for a cell left unread. */
export async function expectRow(tableRoot: Locator, name: string, cells: (string | RegExp | null)[]): Promise<void> {
  const row = await rowIndexOf(tableRoot, name);
  for (const [at, text] of cells.entries()) {
    if (text !== null) await expect(await cellAt(tableRoot, row, at + 1), `column ${String(at + 1)} of "${name}"`).toHaveText(text);
  }
  // The row has no further data cell.
  await expect(await cellAt(tableRoot, row, cells.length + 1)).toHaveCount(0);
}

/** Selects the row named `name` with the table's own selection control. */
export async function selectRow(tableRoot: Locator, name: string): Promise<void> {
  const row = await rowIndexOf(tableRoot, name);
  await tableRoot.locator(below(table, table.findRowSelectionArea(row))).click();
}

/** `text` as a pattern that matches it literally. */
export function escapeText(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// -- key and value pairs ---------------------------------------------------------------------------------------------

const pairs = ui.findKeyValuePairs().findItems();
const firstPair = pairs.get(1);

/** The labels of the key and value pairs drawn below `scope`, in order; a collapsed section's are left out. */
export const pairLabels = (scope: Locator) =>
  scope.locator(sel(pairs)).locator(below(firstPair, firstPair.findLabel())).filter({ visible: true });
/** The values of the key and value pairs drawn below `scope`, in order. */
export const pairValues = (scope: Locator) =>
  scope.locator(sel(pairs)).locator(below(firstPair, firstPair.findValue())).filter({ visible: true });

/** The pairs drawn below `scope` are exactly `expected`, label by label in order. */
export async function expectPairs(scope: Locator, expected: [string, string | RegExp][]): Promise<void> {
  await expect(pairLabels(scope)).toHaveText(expected.map(([label]) => label));
  await expect(pairValues(scope)).toHaveText(expected.map(([, value]) => value));
}

/** The value drawn beside the first label `label` below `scope`, read now; `null` when no such pair is drawn. */
export async function pairValue(scope: Locator, label: string): Promise<string | null> {
  const labels = (await pairLabels(scope).allTextContents()).map((text) => text.trim());
  const values = (await pairValues(scope).allTextContents()).map((text) => text.trim());
  const index = labels.indexOf(label);
  return index < 0 ? null : (values[index] ?? null);
}

// -- containers and dialogs ------------------------------------------------------------------------------------------

const container = ui.findContainer();

/** The Cloudscape container whose own header reads `title`. */
export function containerOf(scope: Page | Locator, title: string): Locator {
  const heading = below(container, container.findHeader().findHeader().findHeadingText());
  const page = 'page' in scope ? scope.page() : scope;
  return scope
    .locator(sel(container))
    .filter({ has: page.locator(heading).filter({ hasText: new RegExp(`^${escapeText(title)}$`) }) });
}

const modal = ui.findModal();
/** The open dialog. */
export const dialog = (page: Page) => page.locator(sel(modal));
export const dialogHeader = (page: Page) => page.locator(sel(modal.findHeader()));
export const dialogContent = (page: Page) => page.locator(sel(modal.findContent()));
export const dialogFooter = (page: Page) => page.locator(sel(modal.findFooter()));

/** A form field's error text, by the field's label. */
export function fieldError(scope: Page | Locator, label: string): Locator {
  const field = ui.findFormField();
  const page = 'page' in scope ? scope.page() : scope;
  return scope
    .locator(sel(field))
    .filter({ has: page.locator(below(field, field.findLabel())).filter({ hasText: new RegExp(`^${escapeText(label)}$`) }) })
    .locator(below(field, field.findError()));
}

// -- the APIs list -----------------------------------------------------------------------------------------------------

/** The APIs list's rows are read: its loading text is gone. */
export async function apisRead(page: Page): Promise<Locator> {
  const list = tableOf(page);
  await expect(loadingOf(list)).toHaveCount(0);
  return list;
}

/** Deletes the selected API through the confirmation, typing `name`. */
export async function confirmDeleteApi(page: Page, name: string): Promise<void> {
  await button(page, 'Delete').click();
  await expect(dialogHeader(page)).toHaveText(`Delete API ${name}?`);
  await dialogContent(page).getByRole('textbox').fill(name);
  await button(dialogFooter(page), 'Delete').click();
}

// -- form fields and choices -----------------------------------------------------------------------------------------

const formField = ui.findFormField();

/** The Cloudscape form field whose label reads `label`. */
export function fieldOf(scope: Page | Locator, label: string): Locator {
  const page = 'page' in scope ? scope.page() : scope;
  return scope.locator(sel(formField)).filter({
    has: page.locator(below(formField, formField.findLabel())).filter({ hasText: new RegExp(`^${escapeText(label)}$`) }),
  });
}

const select = ui.findSelect();

/** Opens the one Cloudscape select below `scope` and gives its option of `value`, found by the value. */
export async function openChoice(scope: Page | Locator, value: string): Promise<Locator> {
  const trigger = scope.locator(sel(select.findTrigger()));
  const option = scope.locator(sel(select.findDropdown().findOptionByValue(value)));
  if ((await option.count()) === 0) await trigger.click();
  await expect(option).toBeVisible();
  return option;
}

/** Chooses the option of `value` in the one Cloudscape select below `scope`. */
export async function choose(scope: Page | Locator, value: string): Promise<void> {
  await (await openChoice(scope, value)).click();
}

/** The radio of `value` in the one Cloudscape radio group below `scope`. */
export const radioOf = (scope: Page | Locator, value: string) =>
  scope.locator(sel(ui.findRadioGroup().findInputByValue(value)));
/** The tile of `value` in the one Cloudscape tiles group below `scope`. */
export const tileOf = (scope: Page | Locator, value: string) => scope.locator(sel(ui.findTiles().findInputByValue(value)));

/** The `h2` that holds the focus, as its Cloudscape heading text. */
export function focusedPartHeading(page: Page): Locator {
  return page.locator('h2:focus').locator(sel(ui.findHeader().findHeadingText()).replace(/^\S+ /, ''));
}

// ---------------------------------------------------------------------------------------------------------------
// The service's entries (`amendment-650.md` of issue 69): two groups, 33 entries. `screen` names the entries with a
// screen of their own; `inside` is the label of the entry a scoped kind is listed inside.
// ---------------------------------------------------------------------------------------------------------------

export interface Entry {
  label: string;
  path: string;
  listedBy: string;
  inside: string | null;
  screen: boolean;
}

const entry = (label: string, segment: string, listedBy: string, inside: string | null = null, screen = false): Entry => ({
  label,
  path: `${SERVICE}/${segment}`,
  listedBy,
  inside,
  screen,
});

export const SUB_SERVICE = { name: 'HTTP and WebSocket APIs', path: `${SERVICE}/v2` };

export const ENTRY_GROUPS: { name: string; entries: Entry[] }[] = [
  {
    name: 'API Gateway',
    entries: [
      entry('REST APIs', 'rest-apis', 'GetRestApis', null, true),
      entry('Resources', 'resources', 'GetResources', 'REST APIs', true),
      entry('Stages', 'stages', 'GetStages', 'REST APIs', true),
      entry('API keys', 'api-keys', 'GetApiKeys'),
      entry('Authorizers', 'authorizers', 'GetAuthorizers', 'REST APIs'),
      entry('Base path mappings', 'base-path-mappings', 'GetBasePathMappings', 'Domain names'),
      entry('Client certificates', 'client-certificates', 'GetClientCertificates'),
      entry('Deployments', 'deployments', 'GetDeployments', 'REST APIs'),
      entry('Documentation parts', 'documentation-parts', 'GetDocumentationParts', 'REST APIs'),
      entry('Documentation versions', 'documentation-versions', 'GetDocumentationVersions', 'REST APIs'),
      entry('Domain name access associations', 'domain-name-access-associations', 'GetDomainNameAccessAssociations'),
      entry('Domain names', 'domain-names', 'GetDomainNames'),
      entry('Gateway responses', 'gateway-responses', 'GetGatewayResponses', 'REST APIs'),
      entry('Models', 'models', 'GetModels', 'REST APIs'),
      entry('Request validators', 'request-validators', 'GetRequestValidators', 'REST APIs'),
      entry('Usage plan keys', 'usage-plan-keys', 'GetUsagePlanKeys', 'Usage plans'),
      entry('Usage plans', 'usage-plans', 'GetUsagePlans'),
      entry('VPC links', 'vpc-links', 'GetVpcLinks'),
    ],
  },
  {
    name: SUB_SERVICE.name,
    entries: [
      entry('APIs', 'apis', 'GetApis', null, true),
      entry('Routes', 'routes', 'GetRoutes', 'APIs', true),
      entry('Integrations', 'integrations', 'GetIntegrations', 'APIs', true),
      entry('V2 stages', 'v2-stages', 'GetStages', 'APIs', true),
      entry('API mappings', 'api-mappings', 'GetApiMappings', 'V2 domain names'),
      entry('Integration responses', 'integration-responses', 'GetIntegrationResponses', 'Integrations'),
      entry('Portal products', 'portal-products', 'ListPortalProducts'),
      entry('Portals', 'portals', 'ListPortals'),
      entry('Route responses', 'route-responses', 'GetRouteResponses', 'Routes'),
      entry('Routing rules', 'routing-rules', 'ListRoutingRules', 'V2 domain names'),
      entry('V2 authorizers', 'v2-authorizers', 'GetAuthorizers', 'APIs'),
      entry('V2 deployments', 'v2-deployments', 'GetDeployments', 'APIs'),
      entry('V2 domain names', 'v2-domain-names', 'GetDomainNames'),
      entry('V2 models', 'v2-models', 'GetModels', 'APIs'),
      entry('V2 VPC links', 'v2-vpc-links', 'GetVpcLinks'),
    ],
  },
];

export const ENTRIES = ENTRY_GROUPS.flatMap((group) => group.entries);

/** The entry labelled `label`. */
export function entryOf(label: string): Entry {
  const found = ENTRIES.find((candidate) => candidate.label === label);
  if (found === undefined) throw new Error(`the service has no entry "${label}"`);
  return found;
}

// -- a REST API's screen -----------------------------------------------------------------------------------------------

/** The "Resources" part of a REST API's screen. */
export const resourcesPart = (page: Page) => page.getByRole('region', { name: 'Resources', exact: true });

/** The resource at `resourcePath`: its container in the "Resources" part. */
export const resourceOf = (page: Page, resourcePath: string) => containerOf(resourcesPart(page), resourcePath);

/** The method `verb` of a resource: the part of the resource's container that holds its heading and its values. */
export function methodOf(resource: Locator, verb: string): Locator {
  const page = resource.page();
  return resource
    .locator('div')
    .filter({ has: page.getByRole('heading', { level: 4, name: verb, exact: true }) })
    .filter({ has: page.locator(sel(ui.findKeyValuePairs())) })
    .last();
}

/** The expand control of the one Cloudscape expandable section below `scope`. */
export const expandControl = (scope: Locator) => scope.locator(sel(ui.findExpandableSection().findExpandButton()));

/** The open "Test method" panel. */
export const testPanel = (page: Page) => page.getByRole('region', { name: 'Test method', exact: true });

/** A Cloudscape alert below `scope`. */
export const alertIn = (scope: Page | Locator) => scope.locator(sel(ui.findAlert()));

/** A control shown as unavailable says why: it is disabled for assistive technology and described by `reason`. */
export async function expectUnavailable(control: Locator, reason: string): Promise<void> {
  await expect(control).toHaveAttribute('aria-disabled', 'true');
  await expect(control).toHaveAccessibleDescription(reason);
}

/** Types `word` into the open confirmation and confirms with "Delete". */
export async function confirmDelete(page: Page, header: string, word: string): Promise<void> {
  await expect(dialogHeader(page)).toHaveText(header);
  await dialogContent(page).getByRole('textbox').fill(word);
  await button(dialogFooter(page), 'Delete').click();
}

/** The invoke address the emulator's export of a REST stage gives: its server's URL with the base path's default. */
export async function exportedAddress(rest: APIGateway, apiId: string, stageName: string): Promise<string> {
  const answer = await rest.getExport({ restApiId: apiId, stageName, exportType: 'oas30' });
  const document = JSON.parse(Buffer.from(answer.body ?? new Uint8Array()).toString('utf8')) as {
    servers?: { url?: string; variables?: Record<string, { default?: string }> }[];
  };
  const server = document.servers?.[0];
  if (!server?.url) throw new Error(`the export of stage ${stageName} names no server`);
  return server.url.replace(/\{(\w+)\}/g, (_, name: string) => server.variables?.[name]?.default ?? '');
}

// -- Create method and Create route --------------------------------------------------------------------------------------

/** The statement ID Studio gives the permission it adds to a function for the API `apiId`. */
export const studioStatementId = (apiId: string) => `emuforge-apigateway-${apiId}`;

/** What the one Cloudscape select below `scope` shows as chosen. */
export const chosenIn = (scope: Page | Locator) => scope.locator(sel(select.findTrigger()));

/** The checkbox "Allow API Gateway to invoke this function". */
export const allowCheckbox = (page: Page) =>
  page.getByRole('checkbox', { name: 'Allow API Gateway to invoke this function', exact: true });

/** The message of the refusal a direct call ends with; the check fails when the emulator accepts the call. */
export function refusalOf(call: Promise<unknown>, accepted: string): Promise<string> {
  return call.then(
    () => {
      throw new Error(accepted);
    },
    (e: Error) => e.message,
  );
}

/**
 * The opened "Responses" of a method: the content of its one expandable section while it is expanded. A collapsed
 * section keeps its content mounted, and this does not find it.
 */
export const responsesOf = (method: Locator) => method.locator(sel(ui.findExpandableSection().findExpandedContent()));
/** The header of a method's one expandable section. */
export const expandHeader = (method: Locator) => method.locator(sel(ui.findExpandableSection().findHeader()));
/** The key and value groups drawn below `scope`, in order. */
export const pairGroups = (scope: Locator) => scope.locator(sel(ui.findKeyValuePairs()));
