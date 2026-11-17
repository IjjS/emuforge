// @vitest-environment node
/// <reference types="node" />
// The one mapping of a failed request in the AWS area (issue 445, requirement R4, R8, R10): the guide names the
// shared module where it says how a service talks to AWS, and the S3 folder holds no mapping or wait of its own.
// Both read the files from disk.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const S3_FOLDER = path.join(STUDIO, 'src/providers/aws/area/services/s3');

/** Requirement R10, word for word. */
const BULLET =
  "A service's `api.ts` sends every command through `sendRequest` of `src/lib/aws/request.ts`, with the " +
  "operation's name. It maps a failed request to the kinds the states below are shown from (not implemented, " +
  'access denied, the emulator did not answer, the engine did not answer, any other code or status line) and ends ' +
  'a request at once when its signal aborts. No service folder maps a failure or awaits a signal itself.';

/** The lines of the section `## <title>` of a Markdown text, up to the next `## ` heading. */
function section(markdown: string, title: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`## ${title}`);
  if (start === -1) {
    return [];
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Each top-level bullet of `lines`, its continuation lines joined with single spaces. */
function bullets(lines: string[]): string[] {
  const found: string[] = [];
  let current: string | undefined;
  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (current !== undefined) {
        found.push(current);
      }
      current = line.slice(2).trim();
    } else if (current !== undefined && line.startsWith('  ') && line.trim() !== '') {
      current = `${current} ${line.trim()}`;
    } else {
      if (current !== undefined) {
        found.push(current);
      }
      current = undefined;
    }
  }
  if (current !== undefined) {
    found.push(current);
  }
  return found.map((bullet) => bullet.replace(/\s+/g, ' '));
}

/** Every `.ts` and `.tsx` file under `dir` that is not a test, as a path relative to `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .sort();
}

describe('the shared mapping of a failed request', () => {
  it('is named in studio/AGENTS.md, "Talking to AWS", by the bullet of R10 word for word, and its file exists', () => {
    const guide = readFileSync(path.join(STUDIO, 'AGENTS.md'), 'utf8');

    expect(bullets(section(guide, 'Talking to AWS'))).toContain(BULLET);
    expect(existsSync(path.join(STUDIO, 'src/lib/aws/request.ts'))).toBe(true);
  });

  it('is not written again in the S3 folder: no source waits on an abort event or reads $metadata', () => {
    const files = sources(S3_FOLDER);
    expect(files).toContain('api.ts');

    const found = files.flatMap((file) => {
      const source = readFileSync(path.join(S3_FOLDER, file), 'utf8');
      return [
        ...(/['"`]abort['"`]|\bonabort\b/.test(source) ? [`${file}: a wait on the abort event`] : []),
        ...(source.includes('$metadata') ? [`${file}: reads $metadata`] : []),
      ];
    });
    expect(found).toEqual([]);
  });
});
