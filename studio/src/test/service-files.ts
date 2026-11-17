/// <reference types="node" />
// Used by unit tests only; nothing in the app imports it. The AWS services as their folders give them (issue 386,
// requirement R13): each folder under `providers/aws/area/services/` is a service whose route is `/<folder>`, and its
// `service.json` holds its label and crumb. A case that holds the services list, or what is shown from it, reads the
// files here, from disk with `node:fs`, never through the product's list: the rules of the list (R13.4) and its order
// (R13.2) are written here a second time, so a fault of the product's collection cannot pass by agreeing with itself.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `studio/src/providers/aws/area/services/`. */
export const SERVICES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../providers/aws/area/services',
);

/** One folder under `services/` as found: its name and its `service.json` parsed, `undefined` when it has none. */
export interface ServiceFolder {
  folder: string;
  file: unknown;
}

/** A service as its folder gives it. */
export interface ServiceFile {
  label: string;
  crumb: string;
  /** `/<folder>`. */
  route: string;
}

/** The form of a service's folder name (issue 327's service name). */
const FOLDER_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The order of the list (requirement R13.2): by label, English, ignoring case. */
export const compareLabels = new Intl.Collator('en', { sensitivity: 'base' }).compare;

/** Every folder under `dir`, in name order, with its `service.json` parsed. */
export function readServiceFolders(dir: string = SERVICES_DIR): ServiceFolder[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((folder) => {
      const file = path.join(dir, folder, 'service.json');
      return { folder, file: existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : undefined };
    });
}

function text(file: unknown, key: 'label' | 'crumb'): string | undefined {
  if (typeof file !== 'object' || file === null) return undefined;
  const value = (file as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * What breaks the rules of the list (requirement R13.4) among `folders`, one sentence per fault, each naming its
 * folder: a folder without `service.json`, a folder name not in the form of a service name, a label or crumb that is
 * not a non-empty text, a label equal to another folder's, a crumb that starts with "Amazon " or "AWS ".
 */
export function serviceListFaults(folders: readonly ServiceFolder[]): string[] {
  const faults: string[] = [];
  const labels = new Map<string, string>();
  for (const { folder, file } of folders) {
    if (!FOLDER_NAME.test(folder)) faults.push(`${folder}: the folder's name is not in the form of a service name`);
    if (file === undefined) {
      faults.push(`${folder}: no service.json`);
      continue;
    }
    const label = text(file, 'label');
    const crumb = text(file, 'crumb');
    if (label === undefined || label.trim() === '') faults.push(`${folder}: the label is not a non-empty text`);
    if (crumb === undefined || crumb.trim() === '') faults.push(`${folder}: the crumb is not a non-empty text`);
    if (crumb !== undefined && /^(Amazon|AWS) /.test(crumb)) {
      faults.push(`${folder}: the crumb "${crumb}" starts with "Amazon " or "AWS "`);
    }
    if (label !== undefined && label.trim() !== '') {
      const other = labels.get(label);
      if (other === undefined) labels.set(label, folder);
      else faults.push(`${folder}: the label "${label}" is also the label of ${other}`);
    }
  }
  return faults;
}

/**
 * The services the folders under `dir` give, sorted by `compareLabels`. Throws, naming every fault, when the folders
 * break the rules of the list, so a case never reads a list the rules refuse.
 */
export function readServiceFiles(dir: string = SERVICES_DIR): ServiceFile[] {
  const folders = readServiceFolders(dir);
  const faults = serviceListFaults(folders);
  if (faults.length > 0) throw new Error(`the services under ${dir} break the list's rules:\n${faults.join('\n')}`);
  return folders
    .map(({ folder, file }) => ({
      label: text(file, 'label') as string,
      crumb: text(file, 'crumb') as string,
      route: `/${folder}`,
    }))
    .sort((a, b) => compareLabels(a.label, b.label));
}

/** Each service's label and its path in the AWS area, `/aws<route>`, in the list's order. */
export function serviceLinks(dir: string = SERVICES_DIR): [string, string][] {
  return readServiceFiles(dir).map(({ label, route }) => [label, `/aws${route}`]);
}
