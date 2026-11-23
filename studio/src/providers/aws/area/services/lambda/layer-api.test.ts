import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { listLayers, listLayerVersions, publishLayerVersion } from './layer-api';

const layerPath = '/2018-10-31/layers';
const arn = 'arn:aws:lambda:us-east-1:000000000000:layer:tools';
const calls: Request[] = [];
let answer: (request: Request) => Response;

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return Response.json({ token: 'test-session' });
    }
    calls.push(request);
    return answer(request);
  });
});

afterEach(() => vi.unstubAllGlobals());

it('follows the service markers to later layer names and earlier version ARNs', async () => {
  const marker = 'next/page+2';
  answer = (request) => {
    const url = new URL(request.url);
    const later = url.searchParams.get('Marker') === marker;
    if (url.pathname === layerPath) {
      return later
        ? Response.json({ Layers: [{ LayerName: 'tools', LatestMatchingVersion: { Version: 2 } }] })
        : Response.json({ Layers: [{ LayerName: 'first' }], NextMarker: marker });
    }
    expect(url.pathname).toBe(`${layerPath}/tools/versions`);
    return later
      ? Response.json({ LayerVersions: [{ LayerVersionArn: `${arn}:1`, Version: 1 }] })
      : Response.json({ LayerVersions: [{ LayerVersionArn: `${arn}:2`, Version: 2 }], NextMarker: marker });
  };
  const endpoint = engineEndpoint(9563);
  const signal = new AbortController().signal;

  const layers = await listLayers(endpoint, undefined, signal);
  expect(layers).toEqual({ items: [{ name: 'first', latestVersion: undefined }], nextMarker: marker });
  await expect(listLayers(endpoint, layers.nextMarker, signal)).resolves.toEqual({
    items: [{ name: 'tools', latestVersion: 2 }],
    nextMarker: undefined,
  });
  const versions = await listLayerVersions(endpoint, 'tools', undefined, signal);
  expect(versions).toEqual({ items: [{ version: 2, arn: `${arn}:2` }], nextMarker: marker });
  await expect(listLayerVersions(endpoint, 'tools', versions.nextMarker, signal)).resolves.toEqual({
    items: [{ version: 1, arn: `${arn}:1` }],
    nextMarker: undefined,
  });
});

it('publishes the chosen ZIP bytes under an existing layer name and reads the assigned version', async () => {
  answer = () => Response.json({ LayerArn: arn, LayerVersionArn: `${arn}:2`, Version: 2 }, { status: 201 });
  // An empty ZIP archive with an end-of-central-directory record.
  const bytes = Uint8Array.of(80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const file = new File([bytes], 'tools.zip', { type: 'application/zip' });

  await expect(
    publishLayerVersion(
      engineEndpoint(9564),
      'tools',
      new Uint8Array(await file.arrayBuffer()),
      new AbortController().signal,
    ),
  ).resolves.toEqual({ name: 'tools', version: 2 });
  expect(calls).toHaveLength(1);
  const [request] = calls;
  expect(request?.method).toBe('POST');
  expect(new URL(request!.url).pathname).toBe(`${layerPath}/tools/versions`);
  await expect(request?.json()).resolves.toEqual({ Content: { ZipFile: 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==' } });
});
