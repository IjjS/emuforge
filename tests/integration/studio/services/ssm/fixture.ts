import { SSM, type PutParameterRequest } from "@aws-sdk/client-ssm";
import { KMS } from "@aws-sdk/client-kms";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EnvError, type Ctx } from "../../support/check";
import { emulatorDir, readEmulatorFiles } from "../../support/emulator";
import { checkPrefix } from "../../support/service-screens";
import { startStack } from "../../support/stack";

function config(ctx: Ctx, port: number, region = "us-east-1") {
  const dir = emulatorDir(ctx.home, port);
  const credentials = readEmulatorFiles(dir);
  if (!credentials) throw new EnvError("Missing local emulator credentials");
  return {
    endpoint: "https://127.0.0.1:" + port,
    region,
    disableHostPrefix: true,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    requestHandler: {
      httpsAgent: { ca: readFileSync(path.join(dir, "ca.pem")) },
    },
    maxAttempts: 1,
  };
}

export function direct(ctx: Ctx, port: number, region?: string) {
  const client = new SSM(config(ctx, port, region));
  ctx.own({ dispose: async () => client.destroy() });
  return client;
}

export async function localKey(ctx: Ctx, port: number, region?: string) {
  const kms = new KMS(config(ctx, port, region));
  try {
    const arn = (await kms.createKey({ Description: ctx.id })).KeyMetadata?.Arn;
    if (!arn) throw new Error("CreateKey returned no ARN");
    return arn;
  } finally {
    kms.destroy();
  }
}

export async function fixture(ctx: Ctx, ownEmulator = false) {
  const stack = await startStack(ctx, { ownEmulator });
  const client = direct(ctx, stack.emulatorPort);
  const prefix = "/" + checkPrefix(ctx, ctx.id.split("ssm-parameter-")[1]!);
  const name = prefix + "/target";
  const names = new Set([name]);
  if (!ownEmulator)
    ctx.own({
      dispose: async () => {
        for (const key of names) {
          try {
            await client.deleteParameter({ Name: key });
          } catch (error) {
            if (!(error instanceof Error && error.name === "ParameterNotFound"))
              throw error;
          }
        }
      },
    });
  return {
    ...stack,
    prefix,
    name,
    client,
    async seed(input: Partial<PutParameterRequest> = {}) {
      const key = input.Name ?? name;
      names.add(key);
      return client.putParameter({
        Name: key,
        Type: "String",
        Value: "fixture-one",
        ...input,
      });
    },
    async read(key = name) {
      return (await client.getParameter({ Name: key, WithDecryption: true }))
        .Parameter!;
    },
    async metadata() {
      const result = await client.describeParameters({
        ParameterFilters: [{ Key: "Name", Option: "Equals", Values: [name] }],
      });
      if (result.Parameters?.[0]?.Name !== name)
        throw new Error("Expected named parameter metadata");
      return result.Parameters[0];
    },
  };
}
