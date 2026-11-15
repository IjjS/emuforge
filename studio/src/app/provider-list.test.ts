import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { PROVIDERS } from './provider-list';

// The area module, watched: the factory runs when, and only when, something imports the area.
const area = vi.hoisted(() => ({ loaded: vi.fn(), Component: () => null }));
vi.mock('../providers/aws/area', () => {
  area.loaded();
  return { default: area.Component };
});

// providers/aws/services.ts, in label order, each under /aws.
const SERVICES: [string, string][] = [
  ['Amazon API Gateway', '/aws/apigateway'],
  ['Amazon CloudWatch', '/aws/cloudwatch'],
  ['Amazon CloudWatch Logs', '/aws/logs'],
  ['Amazon DynamoDB', '/aws/dynamodb'],
  ['Amazon Elastic Compute Cloud', '/aws/ec2'],
  ['Amazon Elastic Container Registry', '/aws/ecr'],
  ['Amazon EventBridge', '/aws/events'],
  ['Amazon Kinesis', '/aws/kinesis'],
  ['Amazon Route 53', '/aws/route53'],
  ['Amazon Simple Notification Service', '/aws/sns'],
  ['Amazon Simple Queue Service', '/aws/sqs'],
  ['Amazon Simple Storage Service', '/aws/s3'],
  ['Amazon Simple Systems Manager (SSM)', '/aws/ssm'],
  ['AWS CloudFormation', '/aws/cloudformation'],
  ['AWS Identity and Access Management', '/aws/iam'],
  ['AWS Key Management Service', '/aws/kms'],
  ['AWS Lambda', '/aws/lambda'],
  ['AWS Secrets Manager', '/aws/secretsmanager'],
  ['AWS Step Functions', '/aws/states'],
];

const SRC = path.resolve(import.meta.dirname, '..');
const AREA = path.join(SRC, 'providers/aws/area');

function resolveSource(from: string, specifier: string): string {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  const file = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (file === undefined) {
    throw new Error(`Cannot resolve ${specifier} from ${from}.`);
  }
  return file;
}

/** The module specifiers a file imports at run time, statically (type-only imports are erased). */
function staticImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly !== true) {
      specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier !== undefined) {
      specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  return specifiers;
}

/** Every module the providers list loads with it: the closure of its static imports. */
function loadedWithProviderList(): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [path.join(SRC, 'app/provider-list.ts')];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (files.has(file)) {
      continue;
    }
    files.add(file);
    for (const specifier of staticImports(file)) {
      if (specifier.startsWith('.')) {
        pending.push(resolveSource(file, specifier));
      } else {
        packages.add(specifier);
      }
    }
  }
  return { files: [...files], packages: [...packages] };
}

describe('the providers list', () => {
  it('has one entry: Amazon Web Services, short name AWS, first path segment aws', () => {
    expect(PROVIDERS.map(({ name, shortName, segment }) => ({ name, shortName, segment }))).toEqual([
      { name: 'Amazon Web Services', shortName: 'AWS', segment: 'aws' },
    ]);
  });

  it("gives the AWS entry's 19 services in label order, each at /aws/<route>", () => {
    const aws = PROVIDERS[0];
    expect(aws?.services.map(({ label, path }) => [label, path])).toEqual(SERVICES);
  });

  it('loads no Cloudscape module, and loads the AWS area only when its component is asked for', async () => {
    const loaded = loadedWithProviderList();
    expect(loaded.files).toContain(path.join(SRC, 'providers/aws/provider.ts'));
    expect(loaded.packages.filter((name) => name.startsWith('@cloudscape-design/'))).toEqual([]);
    expect(loaded.files.filter((file) => file.startsWith(`${AREA}${path.sep}`))).toEqual([]);
    expect(area.loaded).not.toHaveBeenCalled();

    const module = await PROVIDERS[0]?.loadArea();

    expect(area.loaded).toHaveBeenCalledTimes(1);
    expect(module?.default).toBe(area.Component);
  });
});
