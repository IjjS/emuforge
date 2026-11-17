// @vitest-environment node
/// <reference types="node" />
// The SDK clients Studio installs (issue 386, requirement R6.5): the client of every service of the list, so a
// service's first screen changes no package file. Each is pinned to the version of the S3 client, with no range.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CLIENTS = [
  'api-gateway',
  'apigatewayv2',
  'cloudwatch',
  'cloudwatch-logs',
  'dynamodb',
  'ec2',
  'ecr',
  'eventbridge',
  'kinesis',
  'route-53',
  'sns',
  'sqs',
  'ssm',
  'cloudformation',
  'iam',
  'kms',
  'lambda',
  'secrets-manager',
  'sfn',
];

interface PackageFile {
  dependencies?: Record<string, string>;
}

const packageFile = JSON.parse(fs.readFileSync(path.join(STUDIO, 'package.json'), 'utf8')) as PackageFile;

describe('the SDK clients of studio/package.json', () => {
  it('pins the client of every listed service and Step Functions to the exact version of the S3 client', () => {
    const dependencies = packageFile.dependencies ?? {};
    const version = dependencies['@aws-sdk/client-s3'];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);

    for (const client of CLIENTS) {
      expect(dependencies[`@aws-sdk/client-${client}`], `@aws-sdk/client-${client}`).toBe(version);
    }
  });
});
