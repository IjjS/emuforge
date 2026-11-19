// The AWS services Studio will cover: the AWS area's navigation and Home's list, not data read from the emulator. A
// service's entry lives in its own folder of the area, `area/services/<route>/service.json` (its label, the service's
// `serviceFullName` from the AWS CLI service model, verbatim, and its crumb); its route is the folder's name. This file
// collects every such file at build time, as data only (issue 386, R13), and sorts them by label, so a service is
// added, and its first screen built, inside its own folder with no change here. Whether a service has a Studio screen
// is whether its folder holds a `screens.ts` (issue 494): only the paths of those files are read, none is loaded, so
// nothing of the area comes with this data; the area's registry refuses a `screens.ts` that registers no screen.

export interface Service {
  label: string;
  /**
   * The service's crumb in the area's breadcrumbs, its short name: the label without a leading "Amazon " or "AWS ",
   * the acronym where the route abbreviates the name (`S3`, `EC2`, `IAM`), "Systems Manager" for `ssm`.
   */
  crumb: string;
  /** The service's route inside the AWS area, `/<name>`; every path below it belongs to the service too. */
  route: string;
  /** Whether the service has a Studio screen: its folder holds a `screens.ts`, which registers at least one. */
  hasScreen: boolean;
}

/** A service's `service.json`, by the path the file pattern gives it (`./area/services/<folder>/service.json`). */
export type ServiceFiles = Readonly<Record<string, Pick<Service, 'label' | 'crumb'>>>;

/** The folder's name of a path the file patterns give (`./area/services/<folder>/<file>`). */
function folderOf(file: string): string {
  return file.split('/').at(-2) ?? '';
}

const compareLabels = new Intl.Collator('en', { sensitivity: 'base' }).compare;

/**
 * The services `files` give, each with its file's label and crumb, its folder's route, and whether its folder is one
 * of those `screenFiles` name (`./area/services/<folder>/screens.ts`), sorted by label. A path of `screenFiles` whose
 * folder `files` has no entry for adds no service.
 */
export function collectServices(files: ServiceFiles, screenFiles: readonly string[]): Service[] {
  const withScreens = new Set(screenFiles.map(folderOf));
  return Object.entries(files)
    .map(([file, { label, crumb }]) => {
      const folder = folderOf(file);
      return { label, crumb, route: `/${folder}`, hasScreen: withScreens.has(folder) };
    })
    .sort((a, b) => compareLabels(a.label, b.label));
}

export const SERVICES: readonly Service[] = collectServices(
  import.meta.glob<ServiceFiles[string]>('./area/services/*/service.json', { eager: true, import: 'default' }),
  // The keys alone: no loader of this pattern is kept or called, so no file of the area is loaded from here.
  Object.keys(import.meta.glob('./area/services/*/screens.ts')),
);
