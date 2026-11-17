// @vitest-environment node
/// <reference types="node" />
// The import boundaries of R6.6 and the overlay rule of R8.4 as `bun run lint` enforces them (requirement R10.2):
// each case lints one source text with the project's own ESLint configuration, as a file at the named path under
// `src/`. The files need not exist; ESLint applies the configuration by path.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const eslint = new ESLint({ cwd: STUDIO });

/** The messages of the boundary rule for `code` as the file `src/<file>`. */
async function boundaryErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(STUDIO, 'src', file) });
  if (result === undefined) {
    throw new Error(`ESLint gave no result for ${file}`);
  }
  const fatal = result.messages.filter((m) => m.fatal === true);
  expect(fatal, `${file} parses`).toEqual([]);
  return result.messages.filter((m) => m.ruleId === 'studio/boundaries').map((m) => m.message);
}

/** A file at `file` importing `source` and using what it imports, so no other rule objects. */
function importing(source: string): string {
  return `import thing from '${source}';\n\nexport const used = thing;\n`;
}

/** `source` as written from `src/<file>` to `src/<target>`. */
function from(file: string, target: string): string {
  const relative = path.posix.relative(path.posix.dirname(file), target);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

describe('import boundaries: Cloudscape', () => {
  it.each(['features/home/x.tsx', 'ui/x.tsx'])('%s importing a Cloudscape component → an error', async (file) => {
    expect(await boundaryErrors(file, importing('@cloudscape-design/components/button'))).toHaveLength(1);
  });

  it.each(['app/x.tsx', 'providers/aws/provider.ts'])(
    '%s statically importing a Cloudscape component → an error',
    async (file) => {
      expect(await boundaryErrors(file, importing('@cloudscape-design/components/box'))).toHaveLength(1);
    },
  );

  it('providers/aws/area/x.tsx importing a Cloudscape component → no error', async () => {
    expect(await boundaryErrors('providers/aws/area/x.tsx', importing('@cloudscape-design/components/button'))).toEqual(
      [],
    );
  });
});

describe('import boundaries: the AWS area', () => {
  it.each(['ui/button', 'features/home/home-page', 'app/provider-list'])(
    'providers/aws/area/x.tsx importing from %s → an error',
    async (target) => {
      const file = 'providers/aws/area/x.tsx';
      expect(await boundaryErrors(file, importing(from(file, target)))).toHaveLength(1);
    },
  );

  it.each(['app/x.tsx', 'features/home/x.tsx'])(
    '%s statically importing providers/aws/area/index → an error',
    async (file) => {
      expect(await boundaryErrors(file, importing(from(file, 'providers/aws/area/index')))).toHaveLength(1);
    },
  );

  it('providers/aws/provider.ts loading the area with import() → no error', async () => {
    const code = "export const loadArea = () => import('./area');\n";
    expect(await boundaryErrors('providers/aws/provider.ts', code)).toEqual([]);
  });
});

describe('import boundaries: lib', () => {
  it.each(['providers/aws/area/x.tsx', 'features/home/x.tsx'])(
    '%s importing from lib/engine/engine-client → no error',
    async (file) => {
      expect(await boundaryErrors(file, importing(from(file, 'lib/engine/engine-client')))).toEqual([]);
    },
  );

  it.each(['ui/button', 'providers/aws/area/index'])('lib/x.ts importing from %s → an error', async (target) => {
    const file = 'lib/x.ts';
    expect(await boundaryErrors(file, importing(from(file, target)))).toHaveLength(1);
  });
});

describe('import boundaries: i18n (issue #17, R4.10)', () => {
  it.each(['providers/aws/area/x.tsx', 'providers/aws/area/pages/x.tsx', 'lib/x.ts', 'lib/engine/x.ts'])(
    '%s importing i18n/ → an error',
    async (file) => {
      expect(await boundaryErrors(file, importing(from(file, 'i18n/language-context')))).toHaveLength(1);
    },
  );

  it.each(['app/frame', 'ui/button', 'features/home/home-page', 'providers/aws/provider', 'providers/aws/area/index'])(
    'i18n/x.ts importing from %s → an error',
    async (target) => {
      const file = 'i18n/x.ts';
      expect(await boundaryErrors(file, importing(from(file, target)))).toHaveLength(1);
    },
  );

  it.each(['app/x.tsx', 'ui/x.tsx', 'features/home/x.tsx'])('%s importing i18n/ → no error', async (file) => {
    expect(await boundaryErrors(file, importing(from(file, 'i18n/language-context')))).toEqual([]);
  });

  it('a test under i18n/ rendering what reads it, from ui/ → no error', async () => {
    const file = 'i18n/x.test.tsx';
    expect(await boundaryErrors(file, importing(from(file, 'ui/button')))).toEqual([]);
  });
});

describe('overlays stay in the AWS area', () => {
  it('providers/aws/area/x.tsx rendering a Cloudscape component with expandToViewport → an error', async () => {
    const code = [
      "import Select from '@cloudscape-design/components/select';",
      '',
      'export function Picker() {',
      '  return <Select selectedOption={null} options={[]} expandToViewport />;',
      '}',
      '',
    ].join('\n');
    expect(await boundaryErrors('providers/aws/area/x.tsx', code)).toHaveLength(1);
  });
});

describe("import boundaries: a service's folder (issue 386, R3.2, R3.5)", () => {
  const S3_FILE = 'providers/aws/area/services/s3/format';

  /** A file at `file` re-exporting from `source`. */
  function reExporting(source: string): string {
    return `export { thing } from '${source}';\n`;
  }

  /** A file at `file` loading `source` with `import()`. */
  function loading(source: string): string {
    return `export const load = () => import('${source}');\n`;
  }

  it.each(['providers/aws/area/x.tsx', 'providers/aws/area/pages/x.tsx', 'providers/aws/area/components/x.ts'])(
    '%s importing, re-exporting or loading with import() a file of area/services/s3/ → an error',
    async (file) => {
      const source = from(file, S3_FILE);
      for (const code of [importing(source), reExporting(source), loading(source)]) {
        expect(await boundaryErrors(file, code)).toHaveLength(1);
      }
    },
  );

  it('providers/aws/area/x.test.tsx importing a file of area/services/s3/ → no error', async () => {
    const file = 'providers/aws/area/x.test.tsx';
    expect(await boundaryErrors(file, importing(from(file, S3_FILE)))).toEqual([]);
  });

  it.each(['providers/aws/area/services/s3/x.ts', 'providers/aws/area/services/s3/x.test.ts'])(
    '%s importing from area/services/sqs/ → an error',
    async (file) => {
      expect(await boundaryErrors(file, importing(from(file, 'providers/aws/area/services/sqs/api')))).toHaveLength(1);
    },
  );

  it.each([
    'providers/aws/area/services/s3/format',
    'providers/aws/area/services/s3/pages/bucket-list-page',
    'providers/aws/area/components/format-date',
    'providers/aws/area/screens',
    'lib/aws/client-factory',
  ])('area/services/s3/x.ts importing from %s → no error', async (target) => {
    const file = 'providers/aws/area/services/s3/x.ts';
    expect(await boundaryErrors(file, importing(from(file, target)))).toEqual([]);
  });
});

describe('SDK clients are constructed only in lib/aws (issue 386, R6.8)', () => {
  /** A file constructing `name`, imported from `@aws-sdk/client-sns` as named or through a namespace. */
  function constructing(name: string, namespace = false): string {
    return namespace
      ? `import * as sns from '@aws-sdk/client-sns';\n\nexport const made = new sns.${name}({});\n`
      : `import { ${name} } from '@aws-sdk/client-sns';\n\nexport const made = new ${name}({});\n`;
  }

  it.each([
    ['providers/aws/area/services/sns/api.ts', 'SNSClient'],
    ['providers/aws/area/services/sns/api.ts', 'SNS'],
    ['providers/aws/area/x.tsx', 'SNSClient'],
    ['providers/aws/area/x.tsx', 'SNS'],
    ['app/x.ts', 'SNSClient'],
    ['app/x.ts', 'SNS'],
  ])('%s: new %s imported from @aws-sdk/client-sns → an error', async (file, name) => {
    expect(await boundaryErrors(file, constructing(name))).toHaveLength(1);
    expect(await boundaryErrors(file, constructing(name, true))).toHaveLength(1);
  });

  it.each([
    ['the client class of client-api-gateway, APIGatewayClient', 'APIGatewayClient', 'client-api-gateway'],
    ['the aggregated class of client-cloudwatch-logs, CloudWatchLogs', 'CloudWatchLogs', 'client-cloudwatch-logs'],
  ])('area/services/x/api.ts: new of %s → an error', async (_what, name, id) => {
    const code = `import { ${name} } from '@aws-sdk/${id}';\n\nexport const made = new ${name}({});\n`;
    expect(await boundaryErrors('providers/aws/area/services/x/api.ts', code)).toHaveLength(1);
  });

  it.each(['lib/aws/x.ts', 'providers/aws/area/services/sns/api.test.ts', 'app/x.test.tsx'])(
    '%s: new SNSClient and new SNS → no error',
    async (file) => {
      expect(await boundaryErrors(file, constructing('SNSClient'))).toEqual([]);
      expect(await boundaryErrors(file, constructing('SNS'))).toEqual([]);
    },
  );

  it('area/services/s3/api.ts: new ListBucketsCommand → no error', async () => {
    const code =
      "import { ListBucketsCommand } from '@aws-sdk/client-s3';\n\nexport const made = new ListBucketsCommand({});\n";
    expect(await boundaryErrors('providers/aws/area/services/s3/api.ts', code)).toEqual([]);
  });
});

describe('file patterns (issue 386, R8.1)', () => {
  /** A file using the file pattern `pattern`. */
  function globbing(pattern: string): string {
    return `export const files = import.meta.glob('${pattern}', { eager: true });\n`;
  }

  it.each(['app/x.ts', 'features/home/x.tsx', 'ui/x.tsx', 'lib/x.ts', 'providers/aws/provider.ts'])(
    '%s: import.meta.glob → an error',
    async (file) => {
      expect(await boundaryErrors(file, globbing('./x/*.ts'))).toHaveLength(1);
    },
  );

  it('providers/aws/services.ts with the one pattern ./area/services/*/service.json → no error', async () => {
    expect(await boundaryErrors('providers/aws/services.ts', globbing('./area/services/*/service.json'))).toEqual([]);
  });

  it('providers/aws/services.ts with ./area/services/*/*.ts → an error', async () => {
    expect(await boundaryErrors('providers/aws/services.ts', globbing('./area/services/*/*.ts'))).toHaveLength(1);
  });

  it("i18n/bundled.ts with the catalogues' ./messages/*.json → no error; another file of i18n/ with it → an error", async () => {
    expect(await boundaryErrors('i18n/bundled.ts', globbing('./messages/*.json'))).toEqual([]);
    expect(await boundaryErrors('i18n/x.ts', globbing('./messages/*.json'))).toHaveLength(1);
  });

  it('providers/aws/area/screens.ts with ./services/*/screens.ts → no error', async () => {
    expect(await boundaryErrors('providers/aws/area/screens.ts', globbing('./services/*/screens.ts'))).toEqual([]);
  });

  it.each([
    ['providers/aws/area/x.ts', './services/s3/*.ts'],
    ['providers/aws/area/pages/x.tsx', '../services/s3/*.ts'],
    ['providers/aws/area/x.ts', '/src/providers/aws/area/services/s3/*.ts'],
  ])('%s with %s, a pattern that names a service folder → an error', async (file, pattern) => {
    expect(await boundaryErrors(file, globbing(pattern))).toHaveLength(1);
  });

  it.each(['providers/aws/area/x.test.ts', 'app/x.test.tsx'])('%s: import.meta.glob → no error', async (file) => {
    expect(await boundaryErrors(file, globbing('./services/s3/*.ts'))).toEqual([]);
  });
});
