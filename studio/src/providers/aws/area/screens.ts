import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import type { ComponentType } from 'react';

import type { AreaConnection } from './components/emulator-line';
import {
  patternFault,
  patternSegments,
  sampleParams,
  samePatterns,
  screenCrumbs,
  type ScreenParams,
} from './screen-paths';

export type { ScreenParams } from './screen-paths';

/** A screen's own side navigation, which replaces the area's services list on the screen's paths (requirement R5.1). */
export interface ScreenNavigation {
  /** The navigation's header: the service's name and the address it leads to. */
  header: { text: string; href: string };
  /** Navigation items for a service without an entries.ts. */
  items?: readonly SideNavigationProps.Item[] | undefined;
  /** The link shown current on every path of the screen. */
  activeHref: string;
}

/** What the area's layout hands a screen's page. */
export interface ScreenPageProps {
  /** The connection Studio hands the area, as it last read it. */
  connection: AreaConnection;
  /** The values of the parameters of the path the screen was opened at, by name, each decoded once, as text. */
  params: ScreenParams;
}

/** A crumb that leads somewhere: its text and a path of the area, a parameter's value percent-encoded once in it. */
export interface ScreenCrumbLink {
  text: string;
  href: string;
}

/** The last crumb, the current page: never a link, whether or not an address is given. */
export interface ScreenCrumb {
  text: string;
  href?: string;
}

/** A screen's crumbs below its service's, in order: at least one, each but the last with an address (R4.6). */
export type ScreenCrumbs = readonly [...ScreenCrumbLink[], ScreenCrumb];

/**
 * A screen as its service's own `services/<service>/screens.ts` writes it (issue 386, R3 and R4). The screen's page
 * renders its own `h1`; the layout names the content target by the `h1`, reports `title` to Studio's frame, gives the
 * crumbs `EmuForge > AWS > <service's crumb> > <crumbs…>`, the screen's navigation, and the help panel when the
 * screen gives help.
 */
export interface ServiceScreen {
  /**
   * The paths the screen is shown at, as patterns (R4.1): `/aws/<service>` then segments, each literal text or a
   * whole-segment parameter `{name}` (`/aws/cloudwatch/alarms/{name}`).
   */
  paths: readonly string[];
  /**
   * Patterns of paths the screen's controls lead to that are not below its own paths, in the form of `paths`, each
   * below the service's route and naming exactly the parameters of the first path (issue 57, requirement R4.11): a path
   * at or below one that no screen matches is below this screen, and its "no screen yet" page keeps the screen's
   * crumbs, the last leading to the first path for the same values.
   */
  leadsTo?: readonly string[];
  /**
   * The title reported to Studio's frame, or a function from the parameters' values and the address's query (its
   * `?…`, decoded by `URLSearchParams`) to it.
   */
  title: string | ((params: ScreenParams, query: URLSearchParams) => string);
  /** The crumbs below the service's, or a function from the parameters' values and the address's query to them. */
  crumbs: ScreenCrumbs | ((params: ScreenParams, query: URLSearchParams) => ScreenCrumbs);
  navigation: ScreenNavigation;
  /** The help panel's content (a Cloudscape `HelpPanel`); a screen without it shows no help toggle. */
  help?: ComponentType;
  /** The page. */
  Page: ComponentType<ScreenPageProps>;
}

/** A screen of the registry: a service's screen with its service's route (`/s3`), taken from its folder. */
export interface AreaScreen extends ServiceScreen {
  service: string;
}

/** What a service's `screens.ts` exports. */
export interface ScreensFile {
  SCREENS: readonly ServiceScreen[];
}

/** The screens of one service folder, by the folder's name. */
export interface ScreenFolder {
  folder: string;
  screens: readonly ServiceScreen[];
}

/** The screens of every `services/<folder>/screens.ts` `files` holds, by the paths the file pattern gives them. */
export function screenFolders(files: Readonly<Record<string, ScreensFile>>): ScreenFolder[] {
  return Object.entries(files).map(([file, { SCREENS: screens }]) => ({
    folder: file.split('/').at(-2) ?? '',
    screens,
  }));
}

/** The registry: every folder's screens, each with its service's route, the folder's name. */
export function collectScreens(folders: readonly ScreenFolder[]): AreaScreen[] {
  return folders.flatMap(({ folder, screens }) => screens.map((screen) => ({ ...screen, service: `/${folder}` })));
}

/** How the rules name a screen: its folder and its first path. */
function screenName(folder: string, screen: ServiceScreen): string {
  return `the screen of ${folder} at ${screen.paths[0] ?? '(no path)'}`;
}

/**
 * What breaks the registry's rules (R3.4) among `folders`, one sentence per fault, naming the folder, the path or
 * the screen: a folder for which `hasServiceFile` is false; a folder whose `screens.ts` registers no screen (issue
 * 494: a service has a Studio screen exactly when its folder holds a `screens.ts`); a path not `/aws/<folder>` or below it, or not well
 * formed (R4.1); a screen without a path, or whose crumbs, written or returned by its function for sample values,
 * are none (R4.6); two paths, of one screen or of two, that match the same addresses (R4.3); a `leadsTo` pattern not
 * well formed, not below `/aws/<folder>`, or whose parameters are not exactly those of the screen's first path (issue
 * 57, R4.11).
 */
export function registryFaults(
  folders: readonly ScreenFolder[],
  hasServiceFile: (folder: string) => boolean,
): string[] {
  const faults: string[] = [];
  const paths: string[] = [];
  for (const { folder, screens } of folders) {
    if (!hasServiceFile(folder)) faults.push(`${folder}: a folder with a screens.ts holds no service.json`);
    if (screens.length === 0) faults.push(`${folder}: a screens.ts registers at least one screen`);
    const route = `/aws/${folder}`;
    for (const screen of screens) {
      if (screen.paths.length === 0) faults.push(`${screenName(folder, screen)}: a screen has at least one path`);
      for (const path of screen.paths) {
        const fault = patternFault(path);
        if (fault !== undefined) {
          faults.push(fault);
          continue;
        }
        if (path !== route && !path.startsWith(`${route}/`)) {
          faults.push(`${path}: a screen of ${folder} is at ${route} or below it`);
        }
        const same = paths.find((other) => samePatterns(other, path));
        if (same !== undefined) faults.push(`${same} and ${path} match the same addresses`);
        paths.push(path);
        if (screenCrumbs(screen, sampleParams(path)).length === 0) {
          faults.push(`${screenName(folder, screen)}: its crumbs at ${path} are none`);
        }
      }
      faults.push(...leadsToFaults(folder, screen));
    }
  }
  return faults;
}

/** The parameters' names of a well formed pattern, in order. */
function paramNames(pattern: string): string[] {
  return patternSegments(pattern).flatMap((segment) => ('param' in segment ? [segment.param] : []));
}

/** What breaks the rules of a screen's `leadsTo` patterns (R4.11), one sentence per fault, naming the pattern. */
function leadsToFaults(folder: string, screen: ServiceScreen): string[] {
  const route = `/aws/${folder}`;
  const first = screen.paths[0];
  const firstNames = first === undefined || patternFault(first) !== undefined ? [] : paramNames(first);
  return (screen.leadsTo ?? []).flatMap((pattern) => {
    const fault = patternFault(pattern);
    if (fault !== undefined) return [fault];
    const faults: string[] = [];
    if (!pattern.startsWith(`${route}/`)) {
      faults.push(`${pattern}: a path the screen of ${folder} leads to is below ${route}`);
    }
    const names = paramNames(pattern);
    const extra = names.filter((name) => !firstNames.includes(name));
    const missing = firstNames.filter((name) => !names.includes(name));
    if (extra.length > 0 || missing.length > 0) {
      faults.push(
        `${pattern}: a path ${screenName(folder, screen)} leads to names exactly the parameters of its first path` +
          [
            extra.length > 0 ? `, not ${extra.map((name) => `{${name}}`).join(', ')}` : '',
            missing.length > 0 ? `, and ${missing.map((name) => `{${name}}`).join(', ')} too` : '',
          ].join(''),
      );
    }
    return faults;
  });
}

/** Every service folder's `screens.ts`, collected at build time (R3.2), each by its folder's name. */
export const SCREEN_FOLDERS: readonly ScreenFolder[] = screenFolders(
  import.meta.glob<ScreensFile>('./services/*/screens.ts', { eager: true }),
);

/**
 * The area's `console` screens, each service's from its own folder. A path that no screen matches shows the area's
 * own page for it, as before: the index, the "no screen yet" page of its service, or the area's "Page not found".
 */
export const SCREENS: readonly AreaScreen[] = collectScreens(SCREEN_FOLDERS);
