import { KMS } from '@aws-sdk/client-kms';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EnvError, type Ctx } from '../../support/check';
import { emulatorDir, readEmulatorFiles } from '../../support/emulator';
import { checkPrefix } from '../../support/service-screens';
import { startStack } from '../../support/stack';

export function direct(ctx: Ctx, port: number) {
  const dir = emulatorDir(ctx.home, port);
  const files = readEmulatorFiles(dir);
  if (!files) throw new EnvError('Local emulator credentials unavailable');
  const kms = new KMS({
    endpoint: 'https://127.0.0.1:' + port,
    region: 'us-east-1',
    credentials: { accessKeyId: files.accessKeyId, secretAccessKey: files.secretAccessKey },
    requestHandler: { httpsAgent: { ca: readFileSync(path.join(dir, 'ca.pem')) } },
    maxAttempts: 1,
  });
  ctx.own({ dispose: async () => kms.destroy() });
  return kms;
}

export async function fixture(ctx: Ctx) {
  // KMS has no immediate key deletion. The private emulator owns all resources for this case.
  const stack = await startStack(ctx, { ownEmulator: true });
  const kms = direct(ctx, stack.emulatorPort);
  const prefix = checkPrefix(ctx, ctx.id.slice('studio.kms-'.length));
  async function seed(suffix: string) {
    const record = await kms.createKey({ Description: prefix + '-' + suffix });
    if (!record.KeyMetadata?.KeyId) throw new Error('CreateKey returned no key ID');
    return record.KeyMetadata.KeyId;
  }
  return { ...stack, kms, prefix, seed };
}
