import { SecretsManager, type CreateSecretRequest } from '@aws-sdk/client-secrets-manager';
import { KMS } from '@aws-sdk/client-kms';
import { IAM } from '@aws-sdk/client-iam';
import { Lambda } from '@aws-sdk/client-lambda';
import { zipSync, strToU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EnvError, type Ctx } from '../../support/check';
import { emulatorDir, readEmulatorFiles } from '../../support/emulator';
import { checkPrefix } from '../../support/service-screens';
import { startStack } from '../../support/stack';

export const WEST = 'us-west-2';
export const POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { AWS: 'arn:aws:iam::000000000000:root' },
      Action: 'secretsmanager:GetSecretValue',
      Resource: '*',
    },
  ],
});

function config(ctx: Ctx, port: number, region = 'us-east-1') {
  const dir = emulatorDir(ctx.home, port);
  const credentials = readEmulatorFiles(dir);
  if (!credentials) throw new EnvError('Missing local emulator credentials');
  return {
    endpoint: 'https://127.0.0.1:' + port,
    region,
    disableHostPrefix: true,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
    requestHandler: { httpsAgent: { ca: readFileSync(path.join(dir, 'ca.pem')) } },
    maxAttempts: 1,
  };
}

export function direct(ctx: Ctx, port: number, region?: string) {
  const client = new SecretsManager(config(ctx, port, region));
  ctx.own({ dispose: async () => client.destroy() });
  return client;
}

export async function fixture(ctx: Ctx, ownEmulator = false) {
  const stack = await startStack(ctx, { ownEmulator });
  const name = checkPrefix(ctx, ctx.id.split('secretsmanager-')[1]!) + '/secret';
  const client = direct(ctx, stack.emulatorPort);
  // Dedicated stack disposal also removes its KMS keys, Lambda, role and regional replicas.
  if (!ownEmulator)
    ctx.own({
      dispose: async () => {
        try {
          await client.deleteSecret({ SecretId: name, ForceDeleteWithoutRecovery: true });
        } catch (e) {
          if (!(e instanceof Error && e.name === 'ResourceNotFoundException')) throw e;
        }
      },
    });
  return {
    ...stack,
    name,
    client,
    seed: (input: Partial<CreateSecretRequest> = {}) =>
      client.createSecret({ Name: name, SecretString: 'fixture text', ...input }),
    describe: () => client.describeSecret({ SecretId: name }),
    value: (VersionId?: string) => client.getSecretValue({ SecretId: name, VersionId }),
    versions: () => client.listSecretVersionIds({ SecretId: name, IncludeDeprecated: true }),
  };
}

export async function localKey(ctx: Ctx, port: number, region?: string) {
  const kms = new KMS(config(ctx, port, region));
  try {
    const arn = (await kms.createKey({ Description: ctx.id })).KeyMetadata?.Arn;
    if (!arn) throw new Error('CreateKey returned no ARN');
    return arn;
  } finally {
    kms.destroy();
  }
}

export async function rotationFunction(ctx: Ctx, port: number, permitted: boolean) {
  const iam = new IAM(config(ctx, port));
  const lambda = new Lambda(config(ctx, port));
  const name = checkPrefix(ctx, 'rotation').slice(0, 64);
  try {
    const role = await iam.createRole({
      RoleName: name,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      }),
    });
    const { FunctionArn } = await lambda.createFunction({
      FunctionName: name,
      Role: role.Role!.Arn,
      Runtime: 'python3.12',
      Handler: 'index.handler',
      Code: { ZipFile: zipSync({ 'index.py': strToU8('def handler(event, context): return {}\n') }) },
    });
    if (!FunctionArn) throw new Error('CreateFunction returned no ARN');
    if (permitted)
      await lambda.addPermission({
        FunctionName: name,
        StatementId: 'rotation',
        Action: 'lambda:InvokeFunction',
        Principal: 'secretsmanager.amazonaws.com',
      });
    return FunctionArn;
  } finally {
    iam.destroy();
    lambda.destroy();
  }
}
