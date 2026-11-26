import { AWS_PATH } from '../identity';
import { matchingScreens } from './screen-paths';
import type { AreaScreen } from './screens';

export interface SubServiceEntry {
  name: string;
  path: string;
}

export interface ResourceEntry {
  label: string;
  path: string;
  listedBy: string;
  listedInside?: string;
  shownIn?: { entry: string; place: string };
}

/** One API model's entries, in the order its service writes them. */
export interface EntryGroup {
  name?: string;
  subService?: SubServiceEntry;
  entries: readonly ResourceEntry[];
}

export interface EntriesFile {
  ENTRIES: readonly EntryGroup[];
}

export interface EntryFolder {
  folder: string;
  groups: readonly EntryGroup[];
}

export interface ServiceEntries {
  service: string;
  groups: readonly EntryGroup[];
}

export function entryFolders(files: Readonly<Record<string, EntriesFile>>): EntryFolder[] {
  return Object.entries(files).map(([file, { ENTRIES: groups }]) => ({
    folder: file.split('/').at(-2) ?? '',
    groups,
  }));
}

export function collectEntries(folders: readonly EntryFolder[]): ServiceEntries[] {
  return folders.map(({ folder, groups }) => ({ service: `/${folder}`, groups }));
}

export function entryHasScreen(screens: readonly AreaScreen[], service: string, path: string): boolean {
  return matchingScreens(screens, service, path).length > 0;
}

export function findResourceEntry(groups: readonly EntryGroup[], path: string): ResourceEntry | undefined {
  for (const group of groups) {
    const entry = group.entries.find((entry) => entry.path === path);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

/** The faults of a service's entries (issue 650, D2), one sentence per fault. */
export function entryFaults(folders: readonly EntryFolder[], screens: readonly AreaScreen[]): string[] {
  const faults: string[] = [];
  for (const { folder, groups } of folders) {
    const service = `/${folder}`;
    const route = `${AWS_PATH}${service}`;
    const serviceScreens = screens.filter((screen) => screen.service === service);
    if (serviceScreens.length === 0) faults.push(`${folder}: an entries.ts requires a screens.ts`);
    for (const screen of serviceScreens) {
      if (screen.navigation.items !== undefined) {
        faults.push(`${folder}: the screen at ${screen.paths[0]} gives navigation items alongside entries.ts`);
      }
    }
    if (groups.length > 1 && groups.some(({ name }) => !name)) {
      faults.push(`${folder}: every group in a service with several groups has a name`);
    }
    if (groups[0]?.subService !== undefined) {
      faults.push(`${folder}: the first group gives a sub-service`);
    }

    const paths = new Set<string>();
    const labels = new Set<string>();
    for (const { subService, entries } of groups) {
      const links =
        subService === undefined ? entries : [{ label: subService.name, path: subService.path }, ...entries];
      for (const { label, path } of links) {
        if (!path.startsWith(`${route}/`) || path === `${route}/`) {
          faults.push(`${folder}: the entry path ${path} must be below ${route}`);
        }
        if (paths.has(path)) faults.push(`${folder}: the entry path ${path} appears twice`);
        if (labels.has(label)) faults.push(`${folder}: the entry label "${label}" appears twice`);
        paths.add(path);
        labels.add(label);
      }
    }
    for (const { entries } of groups) {
      for (const { label, listedInside, shownIn } of entries) {
        if (listedInside !== undefined && findResourceEntry(groups, listedInside) === undefined) {
          faults.push(`${folder}: "${label}" is listed inside ${listedInside}, which is not an entry of the service`);
        }
        if (shownIn !== undefined) {
          if (findResourceEntry(groups, shownIn.entry) === undefined) {
            faults.push(
              `${folder}: "${label}" is shown today in ${shownIn.entry}, which is not an entry of the service`,
            );
          } else if (!entryHasScreen(serviceScreens, service, shownIn.entry)) {
            faults.push(`${folder}: "${label}" is shown today in ${shownIn.entry}, which has no screen`);
          }
        }
      }
    }
  }
  return faults;
}

export const ENTRY_FOLDERS: readonly EntryFolder[] = entryFolders(
  import.meta.glob<EntriesFile>('./services/*/entries.ts', { eager: true }),
);

export const ENTRIES: readonly ServiceEntries[] = collectEntries(ENTRY_FOLDERS);
