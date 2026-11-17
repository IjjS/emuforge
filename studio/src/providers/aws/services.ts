// The AWS services Studio will cover: the AWS area's navigation and Home's list, not data read from the emulator. A
// service's entry lives in its own folder of the area, `area/services/<route>/service.json` (its label, the service's
// `serviceFullName` from the AWS CLI service model, verbatim, and its crumb); its route is the folder's name. This file
// collects every such file at build time, as data only (issue 386, R13), and sorts them by label, so a service is
// added, and its first screen built, inside its own folder with no change here.

export interface Service {
  label: string;
  /**
   * The service's crumb in the area's breadcrumbs, its short name: the label without a leading "Amazon " or "AWS ",
   * the acronym where the route abbreviates the name (`S3`, `EC2`, `IAM`), "Systems Manager" for `ssm`.
   */
  crumb: string;
  /** The service's route inside the AWS area, `/<name>`; every path below it belongs to the service too. */
  route: string;
}

/** A service's `service.json`, by the path the file pattern gives it (`./area/services/<folder>/service.json`). */
export type ServiceFiles = Readonly<Record<string, Pick<Service, 'label' | 'crumb'>>>;

const compareLabels = new Intl.Collator('en', { sensitivity: 'base' }).compare;

/** The services `files` give, each with its file's label and crumb and its folder's route, sorted by label. */
export function collectServices(files: ServiceFiles): Service[] {
  return Object.entries(files)
    .map(([file, { label, crumb }]) => ({ label, crumb, route: `/${file.split('/').at(-2) ?? ''}` }))
    .sort((a, b) => compareLabels(a.label, b.label));
}

export const SERVICES: readonly Service[] = collectServices(
  import.meta.glob<ServiceFiles[string]>('./area/services/*/service.json', { eager: true, import: 'default' }),
);
