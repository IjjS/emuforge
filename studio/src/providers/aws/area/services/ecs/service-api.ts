import {
  DescribeServicesCommand,
  ListServicesCommand,
  type Deployment as SdkDeployment,
  type Service as SdkService,
  type ServiceEvent as SdkEvent,
} from '@aws-sdk/client-ecs';

import { count, sendEcs, text } from './api';
import { definitionOf, type Definition } from './task-format';

// The reads of a cluster's services (issue 575, design task 1): a page of S3's services table and one service for S4,
// each through `api.ts`'s `sendEcs`, mapped to plain typed results. Every value is the emulator's, as it came; a value
// the answer lacks is absent.

/** The operations of the service reads, as a failure names them. */
export const SERVICE_OPERATIONS = {
  listServices: 'ListServices',
  describeServices: 'DescribeServices',
} as const;

/** How many services one page of the services table asks for: `DescribeServices` takes at most 10 names. */
export const SERVICES_PAGE_SIZE = 10;

/** A deployment of a service, as S4's table shows it. */
export interface ServiceDeployment {
  id: string;
  status?: string;
  rolloutState?: string;
  definitionArn?: string;
  definition?: Definition;
  desired?: number;
  running?: number;
  pending?: number;
  failed?: number;
  updatedAt?: Date;
}

/** An event of a service. */
export interface ServiceEvent {
  id?: string;
  createdAt?: Date;
  message?: string;
}

/** A service as S3's table and S4 show it. */
export interface Service {
  name: string;
  arn?: string;
  /** `status` as the API names it; empty when the answer gave none. */
  status: string;
  desired?: number;
  running?: number;
  pending?: number;
  /** `taskDefinition` as answered. */
  definitionArn?: string;
  /** Its revision, read from `definitionArn`. */
  definition?: Definition;
  launchType?: string;
  createdAt?: Date;
  /** The network configuration; absent when the service has none. */
  network?: {
    subnets: string[];
    securityGroups: string[];
    assignPublicIp?: string;
  };
  deployments: ServiceDeployment[];
  /** Newest first. */
  events: ServiceEvent[];
}

function date(value: unknown): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}

function texts(values: readonly unknown[] | undefined): string[] {
  return (values ?? []).flatMap((value) => {
    const read = text(value);
    return read === undefined ? [] : [read];
  });
}

function deploymentOf(raw: SdkDeployment): ServiceDeployment | undefined {
  const id = text(raw.id);
  if (id === undefined) {
    return undefined;
  }
  const deployment: ServiceDeployment = { id };
  const status = text(raw.status);
  if (status !== undefined) deployment.status = status;
  const rollout = text(raw.rolloutState);
  if (rollout !== undefined) deployment.rolloutState = rollout;
  const definitionArn = text(raw.taskDefinition);
  if (definitionArn !== undefined) {
    deployment.definitionArn = definitionArn;
    const definition = definitionOf(definitionArn);
    if (definition !== undefined) deployment.definition = definition;
  }
  const desired = count(raw.desiredCount);
  if (desired !== undefined) deployment.desired = desired;
  const running = count(raw.runningCount);
  if (running !== undefined) deployment.running = running;
  const pending = count(raw.pendingCount);
  if (pending !== undefined) deployment.pending = pending;
  const failed = count(raw.failedTasks);
  if (failed !== undefined) deployment.failed = failed;
  const updatedAt = date(raw.updatedAt);
  if (updatedAt !== undefined) deployment.updatedAt = updatedAt;
  return deployment;
}

function eventOf(raw: SdkEvent): ServiceEvent {
  const event: ServiceEvent = {};
  const id = text(raw.id);
  if (id !== undefined) event.id = id;
  const createdAt = date(raw.createdAt);
  if (createdAt !== undefined) event.createdAt = createdAt;
  const message = text(raw.message);
  if (message !== undefined) event.message = message;
  return event;
}

/** Newest first; an event without a time keeps its place after those with one. */
function newestFirst(events: ServiceEvent[]): ServiceEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const at = a.event.createdAt?.getTime();
      const bt = b.event.createdAt?.getTime();
      if (at === undefined || bt === undefined) {
        return at === bt ? a.index - b.index : at === undefined ? 1 : -1;
      }
      return bt - at || a.index - b.index;
    })
    .map(({ event }) => event);
}

/** A service of an answer; one without a name is none. */
export function serviceOf(raw: SdkService): Service | undefined {
  const name = text(raw.serviceName);
  if (name === undefined) {
    return undefined;
  }
  const service: Service = { name, status: text(raw.status) ?? '', deployments: [], events: [] };
  const arn = text(raw.serviceArn);
  if (arn !== undefined) service.arn = arn;
  const desired = count(raw.desiredCount);
  if (desired !== undefined) service.desired = desired;
  const running = count(raw.runningCount);
  if (running !== undefined) service.running = running;
  const pending = count(raw.pendingCount);
  if (pending !== undefined) service.pending = pending;
  const definitionArn = text(raw.taskDefinition);
  if (definitionArn !== undefined) {
    service.definitionArn = definitionArn;
    const definition = definitionOf(definitionArn);
    if (definition !== undefined) service.definition = definition;
  }
  const launchType = text(raw.launchType);
  if (launchType !== undefined) service.launchType = launchType;
  const createdAt = date(raw.createdAt);
  if (createdAt !== undefined) service.createdAt = createdAt;
  const vpc = raw.networkConfiguration?.awsvpcConfiguration;
  if (vpc !== undefined) {
    const network: NonNullable<Service['network']> = {
      subnets: texts(vpc.subnets),
      securityGroups: texts(vpc.securityGroups),
    };
    const publicIp = text(vpc.assignPublicIp);
    if (publicIp !== undefined) network.assignPublicIp = publicIp;
    service.network = network;
  }
  service.deployments = (raw.deployments ?? []).flatMap((deployment) => {
    const read = deploymentOf(deployment);
    return read === undefined ? [] : [read];
  });
  service.events = newestFirst((raw.events ?? []).map(eventOf));
  return service;
}

/** One page of the services table: its services in the order `ListServices` gave their ARNs, and its token. */
export interface ServicePage {
  services: Service[];
  nextToken?: string;
}

/**
 * A page of the cluster's services: `ListServices` with the cluster, `maxResults` 10 and the page's token, then one
 * `DescribeServices` of the ARNs it answered; no ARN sends no `DescribeServices`.
 */
export async function listServices(
  endpoint: string,
  cluster: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ServicePage> {
  const listed = await sendEcs(
    endpoint,
    SERVICE_OPERATIONS.listServices,
    (client, abortSignal) =>
      client.send(
        new ListServicesCommand({
          cluster,
          maxResults: SERVICES_PAGE_SIZE,
          ...(token === undefined ? {} : { nextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const arns = texts(listed.serviceArns).slice(0, SERVICES_PAGE_SIZE);
  const page: ServicePage = { services: [] };
  const next = text(listed.nextToken);
  if (next !== undefined) {
    page.nextToken = next;
  }
  if (arns.length === 0) {
    return page;
  }
  const described = await sendEcs(
    endpoint,
    SERVICE_OPERATIONS.describeServices,
    (client, abortSignal) => client.send(new DescribeServicesCommand({ cluster, services: arns }), { abortSignal }),
    signal,
  );
  const byArn = new Map<string, Service>();
  for (const raw of described.services ?? []) {
    const service = serviceOf(raw);
    if (service?.arn !== undefined) {
      byArn.set(service.arn, service);
    }
  }
  page.services = arns.flatMap((arn) => {
    const service = byArn.get(arn);
    return service === undefined ? [] : [service];
  });
  return page;
}

/** A service read: the service, whatever its status, or "not found" (a failure `MISSING`, or no service answered). */
export type ServiceRead = { found: true; service: Service } | { found: false };

/** S4's read of the service `name` of the cluster `cluster`: `DescribeServices` of it. */
export async function getService(
  endpoint: string,
  cluster: string,
  name: string,
  signal: AbortSignal,
): Promise<ServiceRead> {
  const output = await sendEcs(
    endpoint,
    SERVICE_OPERATIONS.describeServices,
    (client, abortSignal) => client.send(new DescribeServicesCommand({ cluster, services: [name] }), { abortSignal }),
    signal,
  );
  const service = (output.services ?? [])
    .map(serviceOf)
    .find((candidate) => candidate !== undefined && candidate.name === name);
  return service === undefined ? { found: false } : { found: true, service };
}
