import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { SFNClient } from '@aws-sdk/client-sfn';

// The only place Studio creates AWS SDK clients. Every client talks to the engine on loopback, never to an AWS
// host, and holds no AWS key: the engine identifies the browser by its session and signs upstream itself.

const ENGINE_HOST = '127.0.0.1';
const ENGINE_ENDPOINT = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;
const MAX_PORT = 65535;

// The emulator's region (infra/aws-emulator/env.sh). Set here so the SDK never looks it up in the environment.
const REGION = 'us-east-1';

// Requests leave unsigned: no credential provider is consulted, so no key from the environment, a file or browser
// storage can reach a request. How the engine attributes a relayed browser request is issue #2's to decide.
const NO_AUTH = 'smithy.api#noAuth';

type AuthScheme = NonNullable<S3ClientConfig['httpAuthSchemes']>[number];

const noAuthScheme: AuthScheme = {
  schemeId: NO_AUTH,
  identityProvider: () => () => Promise.resolve({}),
  signer: { sign: (request) => Promise.resolve(request) },
};

export interface AwsClientOptions {
  /** The engine's address, exactly `http://127.0.0.1:<port>`; build it with `engineEndpoint`. */
  endpoint: string;
}

export class EndpointRefusedError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string) {
    super(
      `Refused AWS endpoint "${endpoint}": Studio sends AWS requests only to the engine at http://${ENGINE_HOST}:<port>.`,
    );
    this.name = 'EndpointRefusedError';
    this.endpoint = endpoint;
  }
}

function checkedEndpoint(endpoint: string): string {
  const port = ENGINE_ENDPOINT.exec(endpoint)?.[1];
  if (port === undefined || Number(port) > MAX_PORT) {
    throw new EndpointRefusedError(endpoint);
  }
  return endpoint;
}

/** The engine's address for an engine port; refuses a port that is not an integer from 1 to 65535. */
export function engineEndpoint(enginePort: number): string {
  return checkedEndpoint(`http://${ENGINE_HOST}:${String(enginePort)}`);
}

// Options every client shares. Each one that the SDK would otherwise resolve from the environment or a shared
// config file, and that decides where a request goes or how it is authenticated, is set here.
function commonConfig({ endpoint }: AwsClientOptions) {
  return {
    endpoint: checkedEndpoint(endpoint),
    region: REGION,
    disableHostPrefix: true,
    useDualstackEndpoint: false,
    useFipsEndpoint: false,
    httpAuthSchemes: [noAuthScheme],
    httpAuthSchemeProvider: () => [{ schemeId: NO_AUTH }],
    authSchemePreference: [NO_AUTH],
  };
}

export function createS3Client(options: AwsClientOptions): S3Client {
  return new S3Client({
    ...commonConfig(options),
    forcePathStyle: true,
    useArnRegion: false,
    disableS3ExpressSessionAuth: true,
  });
}

export function createSfnClient(options: AwsClientOptions): SFNClient {
  return new SFNClient(commonConfig(options));
}
