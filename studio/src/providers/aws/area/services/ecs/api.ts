import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { EC2Client } from '@aws-sdk/client-ec2';
import {
  CreateClusterCommand,
  DeleteClusterCommand,
  DescribeClustersCommand,
  ECSClient,
  ListClustersCommand,
  type Cluster as SdkCluster,
} from '@aws-sdk/client-ecs';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../../lib/aws/request';

// The calls of ECS's cluster screens (issue 575, design tasks 1 and 5), through the engine, mapped to plain typed
// results, and the one place a client class of ECS's folder meets the factory: ECS's (`sendEcs`), CloudWatch Logs'
// (`sendLogs`, for a task's log) and EC2's (`sendEc2`, for the subnets and groups "Run task" chooses from). Every other
// API file of the folder sends its commands through these three. Each command goes through the shared `sendRequest`
// with its operation's name, so a failed request rejects with its `RequestError` and an aborted one with the signal's
// reason. Every value is the emulator's, as it came.

/** The operations of the cluster screens, as a failure names them. */
export const OPERATIONS = {
  listClusters: 'ListClusters',
  describeClusters: 'DescribeClusters',
  createCluster: 'CreateCluster',
  deleteCluster: 'DeleteCluster',
} as const;

/** How many clusters one page of S1 asks for. */
export const CLUSTERS_PAGE_SIZE = 25;

/** One client of `Client` per engine address. */
function clientsOf<C>(make: (endpoint: string) => C): (endpoint: string) => C {
  const clients = new Map<string, C>();
  return (endpoint) => {
    let client = clients.get(endpoint);
    if (client === undefined) {
      client = make(endpoint);
      clients.set(endpoint, client);
    }
    return client;
  };
}

const ecsClient = clientsOf((endpoint) => createAwsClient(ECSClient, { endpoint }));
const logsClient = clientsOf((endpoint) => createAwsClient(CloudWatchLogsClient, { endpoint }));
const ec2Client = clientsOf((endpoint) => createAwsClient(EC2Client, { endpoint }));

/** The sender every API file of the folder uses: `send` is handed the client and the signal to send its command with. */
type Sender<C> = <T>(
  endpoint: string,
  operation: string,
  send: (client: C, abortSignal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
) => Promise<T>;

function senderOf<C>(client: (endpoint: string) => C): Sender<C> {
  return (endpoint, operation, send, signal) =>
    sendRequest(operation, (abortSignal) => send(client(endpoint), abortSignal), signal);
}

/** One request of `operation` to ECS at the engine `endpoint`. */
export const sendEcs: Sender<ECSClient> = senderOf(ecsClient);

/** One request of `operation` to CloudWatch Logs at the engine `endpoint`. */
export const sendLogs: Sender<CloudWatchLogsClient> = senderOf(logsClient);

/** One request of `operation` to EC2 at the engine `endpoint`. */
export const sendEc2: Sender<EC2Client> = senderOf(ec2Client);

/** `value` when it is a text that is not empty. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** `value` when it is a number. */
export function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Clusters

/** A cluster as S1 and S3 show it. A value the answer lacks is absent. */
export interface Cluster {
  name: string;
  arn?: string;
  /** `status` as the API names it; empty when the answer gave none. */
  status: string;
  activeServices?: number;
  runningTasks?: number;
  pendingTasks?: number;
}

function clusterOf(raw: SdkCluster): Cluster | undefined {
  const name = text(raw.clusterName);
  if (name === undefined) {
    return undefined;
  }
  const cluster: Cluster = { name, status: text(raw.status) ?? '' };
  const arn = text(raw.clusterArn);
  if (arn !== undefined) cluster.arn = arn;
  const active = count(raw.activeServicesCount);
  if (active !== undefined) cluster.activeServices = active;
  const running = count(raw.runningTasksCount);
  if (running !== undefined) cluster.runningTasks = running;
  const pending = count(raw.pendingTasksCount);
  if (pending !== undefined) cluster.pendingTasks = pending;
  return cluster;
}

/** One page of S1: its clusters in the order `ListClusters` gave their ARNs, and its token. */
export interface ClusterPage {
  clusters: Cluster[];
  nextToken?: string;
}

/**
 * S1's page: `ListClusters` with `maxResults` 25 and the page's token, then one `DescribeClusters` of the ARNs it
 * answered; an answer of no ARN sends no `DescribeClusters`.
 */
export async function listClusters(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ClusterPage> {
  const listed = await sendEcs(
    endpoint,
    OPERATIONS.listClusters,
    (client, abortSignal) =>
      client.send(
        new ListClustersCommand({
          maxResults: CLUSTERS_PAGE_SIZE,
          ...(token === undefined ? {} : { nextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const arns = (listed.clusterArns ?? []).filter((arn) => text(arn) !== undefined);
  const page: ClusterPage = { clusters: [] };
  const next = text(listed.nextToken);
  if (next !== undefined) {
    page.nextToken = next;
  }
  if (arns.length === 0) {
    return page;
  }
  const described = await sendEcs(
    endpoint,
    OPERATIONS.describeClusters,
    (client, abortSignal) => client.send(new DescribeClustersCommand({ clusters: arns }), { abortSignal }),
    signal,
  );
  const byArn = new Map<string, Cluster>();
  for (const raw of described.clusters ?? []) {
    const cluster = clusterOf(raw);
    if (cluster?.arn !== undefined) {
      byArn.set(cluster.arn, cluster);
    }
  }
  page.clusters = arns.flatMap((arn) => {
    const cluster = byArn.get(arn);
    return cluster === undefined ? [] : [cluster];
  });
  return page;
}

/** A cluster read: the active cluster, or "not found" (`MISSING`, or `INACTIVE`: a deleted cluster). */
export type ClusterRead = { found: true; cluster: Cluster } | { found: false };

/** The read of the one cluster `name`: `DescribeClusters` of it. */
export async function getCluster(endpoint: string, name: string, signal: AbortSignal): Promise<ClusterRead> {
  const output = await sendEcs(
    endpoint,
    OPERATIONS.describeClusters,
    (client, abortSignal) => client.send(new DescribeClustersCommand({ clusters: [name] }), { abortSignal }),
    signal,
  );
  const cluster = (output.clusters ?? [])
    .map(clusterOf)
    .find((candidate) => candidate !== undefined && candidate.name === name);
  return cluster === undefined || cluster.status === 'INACTIVE' ? { found: false } : { found: true, cluster };
}

/** "Create cluster": `CreateCluster` with `clusterName`. */
export async function createCluster(endpoint: string, name: string, signal: AbortSignal): Promise<void> {
  await sendEcs(
    endpoint,
    OPERATIONS.createCluster,
    (client, abortSignal) => client.send(new CreateClusterCommand({ clusterName: name }), { abortSignal }),
    signal,
  );
}

/** "Delete cluster": `DeleteCluster` with `cluster`. */
export async function deleteCluster(endpoint: string, name: string, signal: AbortSignal): Promise<void> {
  await sendEcs(
    endpoint,
    OPERATIONS.deleteCluster,
    (client, abortSignal) => client.send(new DeleteClusterCommand({ cluster: name }), { abortSignal }),
    signal,
  );
}
