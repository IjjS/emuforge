import { ListLayersCommand, ListLayerVersionsCommand, PublishLayerVersionCommand } from '@aws-sdk/client-lambda';

import { RequestError, sendRequest, UNREADABLE_ANSWER } from '../../../../../lib/aws/request';
import { lambdaClient } from './api';

export const LIST_LAYERS = 'ListLayers';
export const LIST_LAYER_VERSIONS = 'ListLayerVersions';
export const PUBLISH_LAYER_VERSION = 'PublishLayerVersion';

export interface LayerSummary {
  name: string;
  latestVersion: number | undefined;
}

export interface LayerVersion {
  version: number;
  arn: string;
}

export interface LayerPage<T> {
  items: T[];
  nextMarker: string | undefined;
}

export async function listLayers(
  endpoint: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<LayerPage<LayerSummary>> {
  const client = lambdaClient(endpoint);
  const command = new ListLayersCommand({ Marker: marker });
  const answer = await sendRequest(LIST_LAYERS, (abortSignal) => client.send(command, { abortSignal }), signal);
  return {
    items: (answer.Layers ?? []).flatMap(({ LayerName, LatestMatchingVersion }) =>
      LayerName ? [{ name: LayerName, latestVersion: LatestMatchingVersion?.Version }] : [],
    ),
    nextMarker: answer.NextMarker,
  };
}

export async function listLayerVersions(
  endpoint: string,
  name: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<LayerPage<LayerVersion>> {
  const client = lambdaClient(endpoint);
  const command = new ListLayerVersionsCommand({ LayerName: name, Marker: marker });
  const answer = await sendRequest(LIST_LAYER_VERSIONS, (abortSignal) => client.send(command, { abortSignal }), signal);
  return {
    items: (answer.LayerVersions ?? []).flatMap(({ Version, LayerVersionArn }) =>
      Version !== undefined && LayerVersionArn ? [{ version: Version, arn: LayerVersionArn }] : [],
    ),
    nextMarker: answer.NextMarker,
  };
}

export interface PublishedLayerVersion {
  name: string;
  version: number;
}

export async function publishLayerVersion(
  endpoint: string,
  name: string,
  zip: Uint8Array,
  signal: AbortSignal,
): Promise<PublishedLayerVersion> {
  const client = lambdaClient(endpoint);
  const command = new PublishLayerVersionCommand({ LayerName: name, Content: { ZipFile: zip } });
  const answer = await sendRequest(
    PUBLISH_LAYER_VERSION,
    (abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  const publishedName = answer.LayerArn?.split(':').at(-1) ?? answer.LayerVersionArn?.split(':').at(-2);
  if (!publishedName || answer.Version === undefined) {
    throw new RequestError({ kind: 'other', operation: PUBLISH_LAYER_VERSION, code: UNREADABLE_ANSWER });
  }
  return { name: publishedName, version: answer.Version };
}
