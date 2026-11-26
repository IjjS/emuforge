// The emulator side and the words of ECS's screens (test-criteria.md, issue 575), for the `ecs-*.spec.ts` checks.
//
// - Direct calls: `directEcs`, `directLogs` and `directEc2` of `support/aws-clients-general.ts`, straight to the
//   emulator, SigV4-signed with the key it wrote for this run, TLS verified against its `ca.pem`, never through the
//   engine.
// - `EcsSeeded`: the clusters, task definitions, tasks, services and log groups a check makes, every one named under
//   the check's prefix `<p>`. When the check ends it removes all of the emulator's under `<p>`, those Studio's
//   actions made included: the services deleted with force, the tasks stopped, the clusters deleted, the revisions
//   deregistered and deleted, the log groups deleted.
// - The screens' words (requirement.md, R3 and R4) and readers of what a screen shows. What is inside a Cloudscape
//   component (a select's options, a table's rows and cells, a flash, a modal, a form field's error) is found with
//   Cloudscape's own test selectors, an option by its value; a reader waits for the settled screen.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { directEc2, directEcs, directLogs, type DirectAnswer } from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION, heading } from '../../support/frame';
import { waitFor } from '../../support/wait';

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/** A JSON value of an answer, read without a schema. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

/** A direct answer: its status, its parsed body and, for a refusal, the emulator's code and message. */
export interface Answer {
  status: number;
  json: Json;
  code: string | null;
  message: string | null;
}

function answered(answer: DirectAnswer, what: string): Answer {
  if ('error' in answer) throw new EnvError(`${what}: ${answer.error}`);
  let json: Json = {};
  try {
    json = answer.body === '' ? {} : JSON.parse(answer.body);
  } catch {
    json = {};
  }
  const type = typeof json.__type === 'string' ? (json.__type as string) : null;
  const code = answer.status === 200 ? null : type === null ? null : type.slice(type.indexOf('#') + 1);
  const message =
    answer.status === 200 ? null : ((json.message as string | undefined) ?? (json.Message as string | undefined) ?? null);
  return { status: answer.status, json, code, message };
}

/** An ECS action with its input, straight to the emulator; logs its status. The body is never logged. */
export async function ecs(ctx: Ctx, port: number, action: string, input: object = {}): Promise<Answer> {
  const answer = answered(await directEcs(ctx, port, action, input), `direct ${action}`);
  ctx.log(`direct ecs ${action}: status ${String(answer.status)}${answer.code ? ` ${answer.code}` : ''}`);
  return answer;
}

/** An ECS action that must answer 200; an `EnvError` otherwise (a check's Given that does not hold). */
async function given(ctx: Ctx, port: number, action: string, input: object): Promise<Json> {
  const answer = await ecs(ctx, port, action, input);
  if (answer.status !== 200) {
    throw new EnvError(`direct ${action} answered ${String(answer.status)} ${answer.code ?? ''} ${answer.message ?? ''}`);
  }
  return answer.json;
}

/** A CloudWatch Logs action with its input, straight to the emulator. */
async function logs(ctx: Ctx, port: number, action: string, input: object): Promise<Answer> {
  const answer = answered(await directLogs(ctx, port, action, input), `direct logs ${action}`);
  ctx.log(`direct logs ${action}: status ${String(answer.status)}${answer.code ? ` ${answer.code}` : ''}`);
  return answer;
}

/** The last part of an ARN (a task's id, a cluster's or a service's name). */
export function lastPart(arn: string): string {
  return arn.slice(arn.lastIndexOf('/') + 1);
}

/** Every page of a list `action`: the strings of its member `member`, following `nextToken`. */
async function everyPage(ctx: Ctx, port: number, action: string, member: string, input: object): Promise<string[]> {
  const found: string[] = [];
  let token: string | undefined;
  for (let i = 0; i < 200; i++) {
    const answer = await ecs(ctx, port, action, { ...input, maxResults: 100, ...(token === undefined ? {} : { nextToken: token }) });
    if (answer.status !== 200) throw new Error(`direct ${action} answered ${String(answer.status)} ${answer.code ?? ''}`);
    const page = (answer.json[member] as string[] | undefined) ?? [];
    found.push(...page);
    token = answer.json.nextToken as string | undefined;
    if (token === undefined || token === '' || page.length === 0) break;
  }
  return found;
}

// --- The default world ---

/** What a check runs a task in, read from the emulator: the default VPC and one of its subnets. */
export interface World {
  defaultVpc: string;
  subnet: string;
}

function xmlValues(body: string, element: string): string[] {
  return [...body.matchAll(new RegExp(`<${element}>([^<]*)</${element}>`, 'g'))].map((found) => found[1] ?? '');
}

async function ec2(ctx: Ctx, port: number, action: string, params: Record<string, string>): Promise<string> {
  const answer = await directEc2(ctx, port, action, params);
  if ('error' in answer) throw new EnvError(`direct ${action}: ${answer.error}`);
  if (answer.status !== 200) throw new EnvError(`direct ${action} answered ${String(answer.status)}`);
  return answer.body;
}

/** Reads the default world; an `EnvError` when the emulator lacks a part of it. */
export async function world(ctx: Ctx, port: number): Promise<World> {
  const vpcs = await ec2(ctx, port, 'DescribeVpcs', { 'Filter.1.Name': 'is-default', 'Filter.1.Value.1': 'true' });
  const defaultVpc = xmlValues(vpcs, 'vpcId')[0];
  if (defaultVpc === undefined) throw new EnvError('the emulator has no default VPC');
  const subnets = await ec2(ctx, port, 'DescribeSubnets', { 'Filter.1.Name': 'vpc-id', 'Filter.1.Value.1': defaultVpc });
  const subnet = xmlValues(subnets, 'subnetId').sort()[0];
  if (subnet === undefined) throw new EnvError('the default VPC of the emulator has no subnet');
  return { defaultVpc, subnet };
}

// --- Clusters ---

export interface DirectCluster {
  name: string;
  status: string;
  services: number;
  running: number;
  pending: number;
  tags: Record<string, string>;
}

/** The cluster `name` as `DescribeClusters` gives it; `null` when the emulator answers it as a failure. */
export async function clusterDirect(ctx: Ctx, port: number, name: string): Promise<DirectCluster | null> {
  const json = await given(ctx, port, 'DescribeClusters', { clusters: [name], include: ['TAGS'] });
  const found = (json.clusters as Json[] | undefined)?.[0];
  if (found === undefined) return null;
  const tags: Record<string, string> = {};
  for (const tag of (found.tags as Json[] | undefined) ?? []) tags[tag.key as string] = tag.value as string;
  return {
    name: found.clusterName as string,
    status: found.status as string,
    services: (found.activeServicesCount as number | undefined) ?? 0,
    running: (found.runningTasksCount as number | undefined) ?? 0,
    pending: (found.pendingTasksCount as number | undefined) ?? 0,
    tags,
  };
}

/** The names of the clusters `ListClusters` lists, every page. */
export async function clusterNamesDirect(ctx: Ctx, port: number): Promise<string[]> {
  return (await everyPage(ctx, port, 'ListClusters', 'clusterArns', {})).map(lastPart);
}

// --- Task definitions ---

/** What a definition made outside differs in from the default of test-criteria.md. */
export interface DefinitionOptions {
  /** The container's command; `sh -c "sleep infinity"` when left out, which the emulator keeps running (issue 652). */
  command?: string[];
  /** With `awslogs`: the log group's name (the stream prefix is `ecs`, the group is created). */
  logGroup?: string;
  container?: string;
  image?: string;
  environment?: Record<string, string>;
  port?: number;
}

/** The stream prefix of every definition a check makes with `awslogs`. */
export const STREAM_PREFIX = 'ecs';
/** The execution role ARN a definition with `awslogs` names (R1.1: the emulator accepts one that does not exist). */
export const EXECUTION_ROLE = 'arn:aws:iam::000000000000:role/ecsTaskExecutionRole';

/** A revision as `DescribeTaskDefinition` gives it; `null` when the emulator cannot describe it. */
export async function definitionDirect(ctx: Ctx, port: number, definition: string): Promise<Json | null> {
  const answer = await ecs(ctx, port, 'DescribeTaskDefinition', { taskDefinition: definition });
  if (answer.status !== 200) return null;
  return answer.json.taskDefinition as Json;
}

/** The revisions of `family` under `status` (`ACTIVE`, `INACTIVE`), as `family:revision`, oldest first. */
export async function revisionsDirect(ctx: Ctx, port: number, family: string, status: string): Promise<string[]> {
  const arns = await everyPage(ctx, port, 'ListTaskDefinitions', 'taskDefinitionArns', {
    familyPrefix: family,
    status,
    sort: 'ASC',
  });
  return arns.map(lastPart);
}

// --- Tasks ---

export interface DirectTask {
  id: string;
  lastStatus: string;
  desiredStatus: string;
  launchType: string | undefined;
  stopCode: string | undefined;
  exitCode: number | undefined;
  definition: string;
}

/** The task `id` of `cluster` as `DescribeTasks` gives it; `null` when the emulator answers it as a failure. */
export async function taskDirect(ctx: Ctx, port: number, cluster: string, id: string): Promise<DirectTask | null> {
  const json = await given(ctx, port, 'DescribeTasks', { cluster, tasks: [id] });
  const found = (json.tasks as Json[] | undefined)?.[0];
  if (found === undefined) return null;
  return {
    id: lastPart(found.taskArn as string),
    lastStatus: found.lastStatus as string,
    desiredStatus: found.desiredStatus as string,
    launchType: found.launchType as string | undefined,
    stopCode: found.stopCode as string | undefined,
    exitCode: (found.containers as Json[] | undefined)?.[0]?.exitCode as number | undefined,
    definition: lastPart(found.taskDefinitionArn as string),
  };
}

/** The ids of the tasks `ListTasks` lists for `cluster` under `desiredStatus`, of `service` when given. */
export async function taskIdsDirect(
  ctx: Ctx,
  port: number,
  cluster: string,
  desiredStatus: 'RUNNING' | 'STOPPED',
  service?: string,
): Promise<string[]> {
  const input = { cluster, desiredStatus, ...(service === undefined ? {} : { serviceName: service }) };
  return (await everyPage(ctx, port, 'ListTasks', 'taskArns', input)).map(lastPart);
}

/** How long a check waits for a state the emulator moves by itself (a task played, a service settled). */
export const STATE_BOUND_MS = 60_000;

/** Waits, with a bound, until the emulator describes the task with the last status `status`; whether it did. */
export async function taskReaches(ctx: Ctx, port: number, cluster: string, id: string, status: string): Promise<boolean> {
  const found = await waitFor(STATE_BOUND_MS, async () =>
    (await taskDirect(ctx, port, cluster, id))?.lastStatus === status ? true : undefined,
  );
  ctx.log(`the emulator ${found ? 'describes' : 'does not describe'} task ${id} as ${status}`);
  return found === true;
}

// --- Services ---

export interface DirectService {
  name: string;
  status: string;
  desired: number;
  running: number;
  definition: string;
  rollouts: string[];
}

/** The service `name` of `cluster` as `DescribeServices` gives it; `null` when the emulator answers it as a failure. */
export async function serviceDirect(ctx: Ctx, port: number, cluster: string, name: string): Promise<DirectService | null> {
  const json = await given(ctx, port, 'DescribeServices', { cluster, services: [name] });
  const found = (json.services as Json[] | undefined)?.[0];
  if (found === undefined) return null;
  return {
    name: found.serviceName as string,
    status: found.status as string,
    desired: found.desiredCount as number,
    running: found.runningCount as number,
    definition: lastPart(found.taskDefinition as string),
    rollouts: ((found.deployments as Json[] | undefined) ?? []).map((each) => each.rolloutState as string),
  };
}

/** The names of the services `ListServices` lists for `cluster`. */
export async function serviceNamesDirect(ctx: Ctx, port: number, cluster: string): Promise<string[]> {
  return (await everyPage(ctx, port, 'ListServices', 'serviceArns', { cluster })).map(lastPart);
}

// ---------------------------------------------------------------------------------------------------------------
// What a check makes, and its cleanup.
// ---------------------------------------------------------------------------------------------------------------

export class EcsSeeded {
  constructor(
    private readonly ctx: Ctx,
    private readonly port: number,
    /** The check's prefix: every cluster, family and log group of the check starts with it. */
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  /** A cluster made outside. */
  async cluster(name: string, tags: Record<string, string> = {}): Promise<string> {
    await given(this.ctx, this.port, 'CreateCluster', {
      clusterName: name,
      ...(Object.keys(tags).length === 0 ? {} : { tags: Object.entries(tags).map(([key, value]) => ({ key, value })) }),
    });
    return name;
  }

  /** A cluster deleted outside. */
  async deleteCluster(name: string): Promise<void> {
    await given(this.ctx, this.port, 'DeleteCluster', { cluster: name });
  }

  /** A revision of `family` registered outside (Fargate, `awsvpc`, CPU 256, memory 512, one essential container); its `family:revision`. */
  async definition(family: string, options: DefinitionOptions = {}): Promise<string> {
    const container: Json = {
      name: options.container ?? 'app',
      image: options.image ?? 'busybox',
      essential: true,
      command: options.command ?? ['sh', '-c', 'sleep infinity'],
    };
    if (options.environment !== undefined) {
      container.environment = Object.entries(options.environment).map(([name, value]) => ({ name, value }));
    }
    if (options.port !== undefined) container.portMappings = [{ containerPort: options.port, protocol: 'tcp' }];
    if (options.logGroup !== undefined) {
      container.logConfiguration = {
        logDriver: 'awslogs',
        options: {
          'awslogs-group': options.logGroup,
          'awslogs-region': 'us-east-1',
          'awslogs-stream-prefix': STREAM_PREFIX,
          'awslogs-create-group': 'true',
        },
      };
    }
    const json = await given(this.ctx, this.port, 'RegisterTaskDefinition', {
      family,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: '256',
      memory: '512',
      ...(options.logGroup === undefined ? {} : { executionRoleArn: EXECUTION_ROLE }),
      containerDefinitions: [container],
    });
    return `${family}:${String(json.taskDefinition.revision)}`;
  }

  /** A revision deregistered outside. */
  async deregister(definition: string): Promise<void> {
    await given(this.ctx, this.port, 'DeregisterTaskDefinition', { taskDefinition: definition });
  }

  /** A task run outside, in the world's subnet with a public IP; its id. */
  async task(cluster: string, definition: string, w: World): Promise<string> {
    const json = await given(this.ctx, this.port, 'RunTask', {
      cluster,
      taskDefinition: definition,
      count: 1,
      launchType: 'FARGATE',
      networkConfiguration: { awsvpcConfiguration: { subnets: [w.subnet], assignPublicIp: 'ENABLED' } },
    });
    const arn = (json.tasks as Json[] | undefined)?.[0]?.taskArn as string | undefined;
    if (arn === undefined) throw new EnvError(`direct RunTask started no task of ${definition}`);
    return lastPart(arn);
  }

  /** A task run outside and waited for until the emulator describes it as `RUNNING`; its id. */
  async runningTask(cluster: string, definition: string, w: World): Promise<string> {
    const id = await this.task(cluster, definition, w);
    if (!(await taskReaches(this.ctx, this.port, cluster, id, 'RUNNING'))) {
      throw new EnvError(`task ${id} of ${definition} did not reach RUNNING`);
    }
    return id;
  }

  /** A service made outside with `count` tasks of `definition`. */
  async service(cluster: string, name: string, definition: string, count: number, w: World): Promise<string> {
    await given(this.ctx, this.port, 'CreateService', {
      cluster,
      serviceName: name,
      taskDefinition: definition,
      desiredCount: count,
      launchType: 'FARGATE',
      networkConfiguration: { awsvpcConfiguration: { subnets: [w.subnet], assignPublicIp: 'ENABLED' } },
    });
    return name;
  }

  /** Waits until the emulator describes the service as `ACTIVE` with `running` tasks running and no deployment in progress. */
  async settled(cluster: string, name: string, running: number): Promise<void> {
    const found = await waitFor(STATE_BOUND_MS, async () => {
      const service = await serviceDirect(this.ctx, this.port, cluster, name);
      return service !== null &&
        service.status === 'ACTIVE' &&
        service.running === running &&
        service.rollouts.every((each) => each !== 'IN_PROGRESS')
        ? true
        : undefined;
    });
    if (!found) throw new EnvError(`service ${name} did not settle at ${String(running)} running`);
  }

  /** A service deleted outside, with force. */
  async deleteService(cluster: string, name: string): Promise<void> {
    await given(this.ctx, this.port, 'DeleteService', { cluster, service: name, force: true });
  }

  /** Removes everything of the emulator under the prefix. A step that fails is logged and the next still runs. */
  async dispose(): Promise<void> {
    const { ctx, port, prefix } = this;
    const step = async (what: string, body: () => Promise<void>) => {
      try {
        await body();
      } catch (e) {
        ctx.log(`cleanup: ${what} failed: ${(e as Error).message}`);
      }
    };
    let clusters: string[] = [];
    await step('listing clusters', async () => {
      clusters = (await clusterNamesDirect(ctx, port)).filter((name) => name.startsWith(prefix));
    });
    for (const cluster of clusters) {
      await step(`cluster ${cluster}`, async () => {
        for (const service of await serviceNamesDirect(ctx, port, cluster)) {
          await ecs(ctx, port, 'DeleteService', { cluster, service, force: true });
        }
        for (const task of await taskIdsDirect(ctx, port, cluster, 'RUNNING')) {
          await ecs(ctx, port, 'StopTask', { cluster, task });
        }
        // The emulator refuses the delete while a task is not stopped or a service drains; both end by themselves.
        const deleted = await waitFor(STATE_BOUND_MS, async () => {
          for (const task of await taskIdsDirect(ctx, port, cluster, 'RUNNING')) {
            await ecs(ctx, port, 'StopTask', { cluster, task });
          }
          return (await ecs(ctx, port, 'DeleteCluster', { cluster })).status === 200 ? true : undefined;
        });
        if (!deleted) ctx.log(`cleanup: cluster ${cluster} was not deleted within the bound`);
      });
    }
    await step('task definitions', async () => {
      const families = new Set<string>();
      for (const status of ['ACTIVE', 'INACTIVE']) {
        for (const family of await everyPage(ctx, port, 'ListTaskDefinitionFamilies', 'families', {
          familyPrefix: prefix,
          status,
        })) {
          families.add(family);
        }
      }
      for (const family of families) {
        for (const revision of await revisionsDirect(ctx, port, family, 'ACTIVE')) {
          await ecs(ctx, port, 'DeregisterTaskDefinition', { taskDefinition: revision });
        }
        const inactive = await revisionsDirect(ctx, port, family, 'INACTIVE');
        for (let i = 0; i < inactive.length; i += 10) {
          await ecs(ctx, port, 'DeleteTaskDefinitions', { taskDefinitions: inactive.slice(i, i + 10) });
        }
      }
    });
    await step('log groups', async () => {
      const answer = await logs(ctx, port, 'DescribeLogGroups', { logGroupNamePrefix: prefix });
      for (const group of (answer.json.logGroups as Json[] | undefined) ?? []) {
        await logs(ctx, port, 'DeleteLogGroup', { logGroupName: group.logGroupName as string });
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The screens: paths and words (requirement.md, R3 and R4).
// ---------------------------------------------------------------------------------------------------------------

export const CLUSTERS_PATH = '/aws/ecs/clusters';
export const CREATE_CLUSTER_PATH = '/aws/ecs/clusters/create';
export const DEFINITIONS_PATH = '/aws/ecs/task-definitions';
export const REGISTER_PATH = '/aws/ecs/task-definitions/register';
const segment = (value: string) => encodeURIComponent(value);
export function clusterPath(cluster: string): string {
  return `/aws/ecs/clusters/cluster/${segment(cluster)}`;
}
export function servicePath(cluster: string, service: string): string {
  return `${clusterPath(cluster)}/services/service/${segment(service)}`;
}
export function taskPath(cluster: string, task: string): string {
  return `${clusterPath(cluster)}/tasks/task/${segment(task)}`;
}
export function runTaskPath(cluster: string): string {
  return `${clusterPath(cluster)}/tasks/run`;
}
export function familyPath(family: string): string {
  return `/aws/ecs/task-definitions/family/${segment(family)}`;
}
export function revisionPath(family: string, revision: number | string): string {
  return `${familyPath(family)}/revision/${String(revision)}`;
}

export const CLUSTERS_H1 = 'Clusters';
export const CREATE_CLUSTER = 'Create cluster';
export const DELETE = 'Delete';
export const DELETE_CLUSTER = 'Delete cluster';
export const RUN_TASK = 'Run task';
export const STOP_TASK = 'Stop task';
export const UPDATE_SERVICE = 'Update service';
export const UPDATE = 'Update';
export const DELETE_SERVICE = 'Delete service';
export const DEFINITIONS_H1 = 'Task definitions';
export const REGISTER_H1 = 'Register task definition';
export const REGISTER = 'Register';
export const REGISTER_NEW_REVISION = 'Register new revision';
export const REFRESH = 'Refresh';
export const NO_CLUSTERS = 'No clusters';
export const NOT_DELETED_CLUSTER = 'The emulator did not delete the cluster.';
export const NOT_RUN = 'The emulator did not run the task.';
export const NOT_REGISTERED = 'The emulator did not register the task definition.';
export const NOT_UPDATED = 'The emulator did not update the service.';
export const NO_LOG_YET = 'No log yet';
export const JSON_FIELD = 'Task definition JSON';
export const FAMILY_FILTER = 'Family name starts with';
/** The line the starter of S10 echoes (requirement.md, S10). */
export const STARTER_LINE = 'hello from EmuForge Studio';

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
/** A selector of Cloudscape's, usable inside a scoped locator (no leading `body`). */
function rel(selector: { toSelector(): string }): string {
  return selector.toSelector().replace(/^body /, '');
}
/** The part of a selector below its component's root, for a locator that is that root. */
function inside(selector: { toSelector(): string }): string {
  return rel(selector).replace(/^\[class\*="awsui_root_\w+"\] /, '');
}

export const TABLE = rel(wrapper.findTable());
const TABLE_ROWS = inside(wrapper.findTable().findRows());
const TABLE_HEADERS = inside(wrapper.findTable().findColumnHeaders());
const TABLE_EMPTY = inside(wrapper.findTable().findEmptySlot());
const NEXT_PAGE = rel(wrapper.findPagination().findNextPageButton());
const ALERT = rel(wrapper.findAlert());
const CONTAINER = rel(wrapper.findContainer());
const MODAL = rel(wrapper.findModal());
const FORM_FIELD = rel(wrapper.findFormField());
const FORM_FIELD_LABEL = inside(wrapper.findFormField().findLabel());
const FORM_FIELD_ERROR = inside(wrapper.findFormField().findError());
const SELECT = rel(wrapper.findSelect());
const SELECT_TRIGGER = inside(wrapper.findSelect().findTrigger());
const SELECT_OPEN = inside(wrapper.findSelect().findDropdown().findOpenDropdown());
const MULTISELECT = rel(wrapper.findMultiselect());
const MULTISELECT_TRIGGER = inside(wrapper.findMultiselect().findTrigger());
const MULTISELECT_OPEN = inside(wrapper.findMultiselect().findDropdown().findOpenDropdown());
const MULTISELECT_TOKENS = inside(wrapper.findMultiselect().findTokens());
const HEADER_TEXT = rel(wrapper.findHeader().findHeadingText());
/** An option of a select or a multiselect by its value. */
function optionByValue(value: string): string {
  return inside(wrapper.findSelect().findDropdown().findOptionByValue(value));
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opens `path` and waits for its `h1` `name`. */
export async function open(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await expect(heading(page, h1), `the h1 "${h1}" at ${path}`).toBeVisible({ timeout: 20_000 });
}

/**
 * The data rows of the Cloudscape table `table` as shown, each a record of its column headings' texts to its cells'
 * texts; a column whose heading has no text (the selection column) is left out.
 */
export async function rowsOf(table: Locator): Promise<Record<string, string>[]> {
  return table.evaluate(
    (root, sel) => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const headers = [...root.querySelectorAll(sel.headers)].map((th) => norm(th.textContent));
      const rows: Record<string, string>[] = [];
      for (const tr of root.querySelectorAll(sel.rows)) {
        const row: Record<string, string> = {};
        [...tr.children].forEach((cell, i) => {
          const header = headers[i] ?? '';
          if (header !== '') row[header] = norm(cell.textContent);
        });
        rows.push(row);
      }
      return rows;
    },
    { headers: TABLE_HEADERS, rows: TABLE_ROWS },
  );
}

/** The table of `main` whose header's heading text is `name`. */
export function tableOf(main: Locator, name: string): Locator {
  return main.locator(TABLE).filter({
    has: main.page().locator(HEADER_TEXT).filter({ hasText: new RegExp(`^\\s*${escaped(name)}\\s*$`) }),
  });
}

/** The table's empty slot (its "No …" words and their action). */
export function emptyOf(table: Locator): Locator {
  return table.locator(TABLE_EMPTY);
}

/** Waits until `table` shows a row whose `column` is `value`; the row. */
export async function expectRow(table: Locator, column: string, value: string): Promise<Record<string, string>> {
  let row: Record<string, string> | undefined;
  await expect
    .poll(
      async () => {
        row = (await rowsOf(table)).find((each) => each[column] === value);
        return row !== undefined;
      },
      { message: `a row whose "${column}" is ${value}`, timeout: 30_000 },
    )
    .toBe(true);
  return row!;
}

/** Waits until the row whose `column` is `value` shows `want` under `other`, without anything pressed. */
export async function expectCell(table: Locator, column: string, value: string, other: string, want: string): Promise<void> {
  await expect
    .poll(async () => (await rowsOf(table)).find((row) => row[column] === value)?.[other], {
      message: `"${other}" of the row ${value} reads "${want}"`,
      timeout: STATE_BOUND_MS,
    })
    .toBe(want);
}

/** Waits until `table` has settled (rows or its empty slot) and shows no row whose `column` is `value`. */
export async function expectNoRow(table: Locator, column: string, value: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const rows = await rowsOf(table);
        if (rows.length === 0 && (await emptyOf(table).count()) === 0) return 'loading';
        return rows.some((row) => row[column] === value) ? 'shown' : 'absent';
      },
      { message: `no row whose "${column}" is ${value} on the page shown`, timeout: 30_000 },
    )
    .toBe('absent');
}

/**
 * On "Clusters", which has no filter and shows 25 a page while the checks of one run share an emulator: pages on
 * until the row of `name` is shown; the row.
 */
export async function findClusterRow(page: Page, name: string): Promise<Record<string, string>> {
  const table = page.getByRole('main').locator(TABLE).first();
  for (let i = 0; i < 40; i++) {
    let rows: Record<string, string>[] = [];
    await expect
      .poll(
        async () => {
          rows = await rowsOf(table);
          return rows.length > 0 || (await emptyOf(table).count()) > 0;
        },
        { message: 'the clusters table has settled', timeout: 30_000 },
      )
      .toBe(true);
    const row = rows.find((each) => each.Name === name);
    if (row !== undefined) return row;
    const next = page.getByRole('main').locator(NEXT_PAGE);
    if ((await next.count()) === 0 || (await next.isDisabled())) break;
    const before = rows.map((each) => each.Name).join('\n');
    await next.click(ACTION);
    await expect
      .poll(async () => (await rowsOf(table)).map((each) => each.Name).join('\n'), {
        message: 'the next page of clusters',
        timeout: 30_000,
      })
      .not.toBe(before);
  }
  throw new Error(`"Clusters" shows no row named ${name} on any page`);
}

/** Selects the row of `table` whose `column` is `value`, by its selection control. */
export async function selectRow(table: Locator, column: string, value: string): Promise<void> {
  const index = (await rowsOf(table)).findIndex((row) => row[column] === value);
  if (index < 0) throw new Error(`the table shows no row whose "${column}" is ${value}`);
  await table.locator(inside(wrapper.findTable().findRowSelectionArea(index + 1))).click(ACTION);
}

/** The text of the value of `label` in the key-value pairs inside `scope`; `null` when it has no such label. */
export async function valueOf(scope: Locator, label: string): Promise<string | null> {
  return scope.evaluate((root, wanted) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    for (const dt of root.querySelectorAll('dt')) {
      if (norm(dt.textContent) !== wanted) continue;
      const dd = dt.nextElementSibling;
      return dd === null ? null : norm(dd.textContent);
    }
    return null;
  }, label);
}

/** Waits until the value of `label` on the page is exactly `want`, without anything pressed. */
export async function expectValue(page: Page, label: string, want: string): Promise<void> {
  await expect
    .poll(() => valueOf(page.getByRole('main'), label), { message: `"${label}" is "${want}"`, timeout: STATE_BOUND_MS })
    .toBe(want);
}

type FlashType = 'success' | 'error' | 'info' | 'warning';

/** Waits until one flash item of `type` holds every text of `texts`; the items' texts are read and compared. */
export async function expectFlash(page: Page, type: FlashType, ...texts: string[]): Promise<void> {
  const items = page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector());
  await expect
    .poll(async () => (await items.allTextContents()).filter((text) => texts.every((each) => text.includes(each))).length, {
      message: `one ${type} flash holding ${texts.map((t) => `"${t}"`).join(', ')}`,
      timeout: 30_000,
    })
    .toBe(1);
}

/** The open dialog. */
export function dialogOf(page: Page): Locator {
  return page.locator(MODAL).filter({ visible: true });
}

/** Confirms the open dialog by typing `word` and choosing `action`. */
export async function confirmWith(page: Page, word: string, action: string): Promise<void> {
  const dialog = dialogOf(page);
  await expect(dialog, 'the confirmation dialog').toBeVisible();
  await dialog.getByRole('textbox').fill(word, ACTION);
  await dialog.getByRole('button', { name: action, exact: true }).click(ACTION);
}

/** A button of `scope` by its name. */
export function button(scope: Locator | Page, name: string): Locator {
  return scope.getByRole('button', { name, exact: true });
}

/** An action of `scope` by its name, whether the screen draws it as a button or as a link to another screen. */
export function action(scope: Locator | Page, name: string): Locator {
  return scope.getByRole('button', { name, exact: true }).or(scope.getByRole('link', { name, exact: true })).first();
}

/** The form field of `scope` whose label is exactly `label`. */
export function field(scope: Locator, label: string): Locator {
  return scope
    .locator(FORM_FIELD)
    .filter({ has: scope.page().locator(FORM_FIELD_LABEL).filter({ hasText: new RegExp(`^${escaped(label)}$`) }) })
    .last();
}

/** The error a form field shows. */
export function errorOf(formField: Locator): Locator {
  return formField.locator(FORM_FIELD_ERROR);
}

/** In the one select inside `scope`: opens it and chooses the option whose value is `value`. */
export async function chooseOption(scope: Locator, value: string): Promise<void> {
  const select = scope.locator(SELECT).first();
  await select.locator(SELECT_TRIGGER).click(ACTION);
  const option = select.locator(optionByValue(value));
  await expect(option, `the option ${value}`).toBeVisible({ timeout: 20_000 });
  await option.click(ACTION);
  await expect(select.locator(SELECT_OPEN), 'the list after the choice').toHaveCount(0);
}

/** The select inside `scope`, for what it shows as chosen. */
export function selectOf(scope: Locator): Locator {
  return scope.locator(SELECT).first().locator(SELECT_TRIGGER);
}

/** In the multiselect of `formField`: opens it, chooses the option of `value` and closes the list. */
export async function chooseInMultiselect(formField: Locator, value: string): Promise<void> {
  const root = formField.locator(MULTISELECT).first();
  if ((await root.locator(MULTISELECT_OPEN).count()) === 0) await root.locator(MULTISELECT_TRIGGER).click(ACTION);
  const option = root.locator(optionByValue(value));
  await expect(option, `the option ${value}`).toBeVisible({ timeout: 20_000 });
  await option.click(ACTION);
  await expect(root.locator(MULTISELECT_TOKENS), 'the chosen options').toHaveCount(1, { timeout: 10_000 });
  await formField.page().keyboard.press('Escape');
  await expect(root.locator(MULTISELECT_OPEN), 'the list after Escape').toHaveCount(0);
}

/** The alert of `scope` that holds `text` (a refusal kept on a form or in a dialog). */
export function alertWith(scope: Locator, text: string): Locator {
  return scope.locator(ALERT).or(scope.getByRole('alert')).filter({ hasText: text }).first();
}

/** The links of the not-found state whose heading is `heading`: the state's own, not the navigation's or the crumbs'. */
export function notFoundLinks(main: Locator, heading: string): Locator {
  return main
    .locator(CONTAINER)
    .filter({ has: main.page().getByText(heading, { exact: true }) })
    .getByRole('link');
}

/** The part of a revision's page that shows its JSON: the container headed "JSON". */
export function jsonOf(main: Locator): Locator {
  return main.locator(CONTAINER).filter({ has: main.page().getByRole('heading', { name: 'JSON', exact: true }) });
}

/** The log part of the container `container` on a task's page: the container headed "Log of {container}". */
export function logPartOf(main: Locator, container: string): Locator {
  return main
    .locator(CONTAINER)
    .filter({ has: main.page().getByRole('heading', { name: `Log of ${container}`, exact: true }) });
}

/** The log of the container `container` on a task's page. */
export function logOf(page: Page, container: string): Locator {
  return page.getByRole('main').getByRole('log', { name: `Log of ${container}`, exact: true });
}
