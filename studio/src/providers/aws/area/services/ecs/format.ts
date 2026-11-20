import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';

import { AWS_PATH } from '../../../identity';
import type { ScreenCrumbs, ScreenNavigation } from '../../screens';

// Every address of ECS's screens, their titles, crumbs and notice words, the side navigation and the status words
// (issue 575, requirement R3 and R4; design "Code layout and the cut"): a unit links to another unit's screen by this
// file alone. A cluster, a service and a family are addressed by their names, a task by its id and a revision by its
// number, each percent-encoded once as one segment.

/** Shown for a value the answer lacks. */
export const NONE = '-';

/** ECS's route in the area, `/aws/ecs`. */
export const ECS_PATH = `${AWS_PATH}/ecs`;

/** S1, the clusters. */
export const CLUSTERS_PATH = `${ECS_PATH}/clusters`;

/** S2, "Create cluster". */
export const CREATE_CLUSTER_PATH = `${CLUSTERS_PATH}/create`;

/** S3's pattern, a cluster. */
export const CLUSTER_PATTERN = `${CLUSTERS_PATH}/cluster/{cluster}`;

/** S4's pattern, a service of a cluster. */
export const SERVICE_PATTERN = `${CLUSTER_PATTERN}/services/service/{service}`;

export const CREATE_SERVICE_PATTERN = `${CLUSTER_PATTERN}/services/create`;
export const CREATE_SERVICE_TITLE = 'Create service';
export const SERVICES_SECTION_ID = 'ecs-services';

export function createServiceHref(cluster: string): string {
  return `${clusterHref(cluster)}/services/create`;
}

/** S5's pattern, a task of a cluster. */
export const TASK_PATTERN = `${CLUSTER_PATTERN}/tasks/task/{task}`;

/** S6's pattern, "Run task" in a cluster. */
export const RUN_TASK_PATTERN = `${CLUSTER_PATTERN}/tasks/run`;

/** S7, the task definitions. */
export const TASK_DEFINITIONS_PATH = `${ECS_PATH}/task-definitions`;

/** S8's pattern, a family. */
export const FAMILY_PATTERN = `${TASK_DEFINITIONS_PATH}/family/{family}`;

/** S9's pattern, a revision of a family. */
export const REVISION_PATTERN = `${FAMILY_PATTERN}/revision/{revision}`;

/** S10, "Register task definition". */
export const REGISTER_PATH = `${TASK_DEFINITIONS_PATH}/register`;

const segment = (value: string | number) => encodeURIComponent(String(value));

/** S3 of the cluster `cluster`. */
export function clusterHref(cluster: string): string {
  return `${CLUSTERS_PATH}/cluster/${segment(cluster)}`;
}

/** S4 of the service `service` of the cluster `cluster`. */
export function serviceHref(cluster: string, service: string): string {
  return `${clusterHref(cluster)}/services/service/${segment(service)}`;
}

/** S5 of the task `task` (its id) of the cluster `cluster`. */
export function taskHref(cluster: string, task: string): string {
  return `${clusterHref(cluster)}/tasks/task/${segment(task)}`;
}

/** S6 in the cluster `cluster`. */
export function runTaskHref(cluster: string): string {
  return `${clusterHref(cluster)}/tasks/run`;
}

/** S8 of the family `family`. */
export function familyHref(family: string): string {
  return `${TASK_DEFINITIONS_PATH}/family/${segment(family)}`;
}

/** S9 of the revision `revision` (its number) of the family `family`. */
export function revisionHref(family: string, revision: string | number): string {
  return `${familyHref(family)}/revision/${segment(revision)}`;
}

/** S10; with `from`, filled from that revision (`?from={family}:{revision}`, the value encoded once). */
export function registerHref(from?: { family: string; revision: string | number }): string {
  return from === undefined
    ? REGISTER_PATH
    : `${REGISTER_PATH}?from=${encodeURIComponent(`${from.family}:${String(from.revision)}`)}`;
}

/** The screens' titles, each its `h1` and its crumb, of the screens whose title is not a resource's name. */
export const CLUSTERS_TITLE = 'Clusters';
export const CREATE_CLUSTER_TITLE = 'Create cluster';
export const RUN_TASK_TITLE = 'Run task';
export const TASK_DEFINITIONS_TITLE = 'Task definitions';
export const REGISTER_TITLE = 'Register task definition';

/** The crumbs after `EmuForge > AWS > ECS` (R3), per screen. */
export const CLUSTERS_CRUMBS: ScreenCrumbs = [{ text: CLUSTERS_TITLE }];
export const CREATE_CLUSTER_CRUMBS: ScreenCrumbs = [
  { text: CLUSTERS_TITLE, href: CLUSTERS_PATH },
  { text: CREATE_CLUSTER_TITLE },
];

export function createServiceCrumbs(cluster: string): ScreenCrumbs {
  return [
    { text: CLUSTERS_TITLE, href: CLUSTERS_PATH },
    { text: cluster, href: clusterHref(cluster) },
    { text: CREATE_SERVICE_TITLE },
  ];
}

export function clusterCrumbs(cluster: string): ScreenCrumbs {
  return [{ text: CLUSTERS_TITLE, href: CLUSTERS_PATH }, { text: cluster }];
}

export function serviceCrumbs(cluster: string, service: string): ScreenCrumbs {
  return [
    { text: CLUSTERS_TITLE, href: CLUSTERS_PATH },
    { text: cluster, href: clusterHref(cluster) },
    { text: service },
  ];
}

export function taskCrumbs(cluster: string, task: string): ScreenCrumbs {
  return [{ text: CLUSTERS_TITLE, href: CLUSTERS_PATH }, { text: cluster, href: clusterHref(cluster) }, { text: task }];
}

export function runTaskCrumbs(cluster: string): ScreenCrumbs {
  return [
    { text: CLUSTERS_TITLE, href: CLUSTERS_PATH },
    { text: cluster, href: clusterHref(cluster) },
    { text: RUN_TASK_TITLE },
  ];
}

export const TASK_DEFINITIONS_CRUMBS: ScreenCrumbs = [{ text: TASK_DEFINITIONS_TITLE }];

export function familyCrumbs(family: string): ScreenCrumbs {
  return [{ text: TASK_DEFINITIONS_TITLE, href: TASK_DEFINITIONS_PATH }, { text: family }];
}

export function revisionCrumbs(family: string, revision: string): ScreenCrumbs {
  return [
    { text: TASK_DEFINITIONS_TITLE, href: TASK_DEFINITIONS_PATH },
    { text: family, href: familyHref(family) },
    { text: revision },
  ];
}

export const REGISTER_CRUMBS: ScreenCrumbs = [
  { text: TASK_DEFINITIONS_TITLE, href: TASK_DEFINITIONS_PATH },
  { text: REGISTER_TITLE },
];

/** The notice's plural word, per section (R3): S1 and S2, S3 to S6, S7 to S10. */
export const CLUSTERS_WORD = 'clusters';
export const SERVICES_AND_TASKS_WORD = 'services and tasks';
export const TASK_DEFINITIONS_WORD = 'task definitions';

// The side navigation (R3): the header "ECS", "Clusters" current on S1 to S6, "Task definitions" on S7 to S10.

const HEADER: ScreenNavigation['header'] = { text: 'ECS', href: ECS_PATH };

const ITEMS: readonly SideNavigationProps.Item[] = [
  { type: 'link', text: CLUSTERS_TITLE, href: CLUSTERS_PATH },
  { type: 'link', text: TASK_DEFINITIONS_TITLE, href: TASK_DEFINITIONS_PATH },
];

/** The navigation of S1 to S6: "Clusters" current. */
export const CLUSTERS_NAVIGATION: ScreenNavigation = { header: HEADER, items: ITEMS, activeHref: CLUSTERS_PATH };

/** The navigation of S7 to S10: "Task definitions" current. */
export const TASK_DEFINITIONS_NAVIGATION: ScreenNavigation = {
  header: HEADER,
  items: ITEMS,
  activeHref: TASK_DEFINITIONS_PATH,
};

// The status words (R4): the emulator's word in sentence case; any other word as the emulator gave it.

const STATUS_WORDS: Readonly<Record<string, string>> = {
  RUNNING: 'Running',
  PROVISIONING: 'Provisioning',
  STOPPED: 'Stopped',
  ACTIVE: 'Active',
  DRAINING: 'Draining',
  INACTIVE: 'Inactive',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

/** A status as a screen shows it: the word of R4 in sentence case, another word as given, none as "-". */
export function statusText(status: string | undefined): string {
  if (status === undefined || status === '') {
    return NONE;
  }
  return Object.hasOwn(STATUS_WORDS, status) ? (STATUS_WORDS[status] ?? status) : status;
}
