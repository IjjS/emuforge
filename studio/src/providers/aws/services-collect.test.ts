/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readServiceFiles } from '../../test/service-files';
import { collectServices, SERVICES } from './services';

// The services list is collected from each service's own `service.json`, not written out (issue 386, requirement
// R13.2, R13.6). The files on disk are read with `node:fs`, apart from the product's collection.

const SERVICES_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'services.ts');

/** The string literals of `source`, its comment lines (`//`, `/**`, ` *`) left out. */
function stringLiterals(source: string): string[] {
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
  return [...code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((match) => match[2] ?? '');
}

describe('the AWS services, collected from their folders', () => {
  it("the collection, given the service.json files of two folders, one a service outside the nineteen → both, with their files' label and crumb and their folders' routes, in the order of R13.2", () => {
    const services = collectServices({
      './area/services/sqs/service.json': { label: 'Amazon Simple Queue Service', crumb: 'SQS' },
      './area/services/rds/service.json': { label: 'Amazon Relational Database Service', crumb: 'RDS' },
    });

    expect(services).toEqual([
      { label: 'Amazon Relational Database Service', crumb: 'RDS', route: '/rds' },
      { label: 'Amazon Simple Queue Service', crumb: 'SQS', route: '/sqs' },
    ]);
  });

  it('the collection orders labels in English, ignoring case', () => {
    const services = collectServices({
      './area/services/b/service.json': { label: 'amazon Beta', crumb: 'Beta' },
      './area/services/a/service.json': { label: 'Amazon alpha', crumb: 'Alpha' },
      './area/services/c/service.json': { label: 'AWS Gamma', crumb: 'Gamma' },
    });

    expect(services.map(({ route }) => route)).toEqual(['/a', '/b', '/c']);
  });

  it('the real list: exactly one entry per service.json file under services/, and services.ts writes out no label, crumb or route', () => {
    const files = readServiceFiles();

    expect(SERVICES).toEqual(files);

    const literals = stringLiterals(readFileSync(SERVICES_SOURCE, 'utf8'));
    const written = files.flatMap(({ label, crumb, route }) =>
      [label, crumb, route].filter((value) => literals.some((literal) => literal.includes(value))),
    );
    expect(written).toEqual([]);
  });
});
