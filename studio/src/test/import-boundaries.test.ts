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
