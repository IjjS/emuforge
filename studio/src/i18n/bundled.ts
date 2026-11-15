// The catalogues bundled with Studio: every `messages/*.json`, imported eagerly, so the first render and every change
// of language need no request (R2.6, R2.7). The set of languages is the set of files found; nothing else lists
// them (R4.6).

import { catalogueSet, parseCatalogue, type Catalogues } from './catalogue';

const FILES = import.meta.glob<unknown>('./messages/*.json', { eager: true, import: 'default' });

/** The tag a catalogue's file is named by: `./messages/pt-BR.json` → `pt-BR`. */
function tagOf(file: string): string {
  return file.replace(/^\.\/messages\//, '').replace(/\.json$/, '');
}

export const BUNDLED_CATALOGUES: Catalogues = catalogueSet(
  Object.entries(FILES).map(([file, json]) => parseCatalogue(tagOf(file), json)),
);
