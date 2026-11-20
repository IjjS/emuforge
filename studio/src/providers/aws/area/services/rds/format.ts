import { AWS_PATH } from '../../../identity';

// Every address of RDS's seven screens, their titles and notice words (issue 573, design "Code layout and the cut"):
// a unit links to another unit's screen by this file alone. A DB instance and a DB cluster are addressed by their
// identifier, percent-encoded once as one segment.

/** Shown for a value the answer lacks. */
export const NONE = '-';

/** RDS's route in the area, `/aws/rds`. */
export const RDS_PATH = `${AWS_PATH}/rds`;

/** S1, the DB instances. */
export const INSTANCES_PATH = `${RDS_PATH}/instances`;

/** S2, "Create DB instance". */
export const CREATE_INSTANCE_PATH = `${INSTANCES_PATH}/create`;

/** S3's pattern, a DB instance. */
export const INSTANCE_PATTERN = `${INSTANCES_PATH}/instance/{id}`;

/** S4, the DB clusters. */
export const CLUSTERS_PATH = `${RDS_PATH}/clusters`;

/** S5, "Create DB cluster". */
export const CREATE_CLUSTER_PATH = `${CLUSTERS_PATH}/create`;

/** S6's pattern, a DB cluster. */
export const CLUSTER_PATTERN = `${CLUSTERS_PATH}/cluster/{id}`;

/** S7's pattern, "Add DB instance" of a DB cluster. */
export const ADD_INSTANCE_PATTERN = `${CLUSTER_PATTERN}/add-instance`;

/** S3 of the DB instance `id`. */
export function instanceHref(id: string): string {
  return `${INSTANCES_PATH}/instance/${encodeURIComponent(id)}`;
}

/** S6 of the DB cluster `id`. */
export function clusterHref(id: string): string {
  return `${CLUSTERS_PATH}/cluster/${encodeURIComponent(id)}`;
}

/** S7 of the DB cluster `id`. */
export function addInstanceHref(id: string): string {
  return `${clusterHref(id)}/add-instance`;
}

/** The screens' titles, each its `h1` and its crumb. */
export const INSTANCES_TITLE = 'DB instances';
export const CREATE_INSTANCE_TITLE = 'Create DB instance';
export const CLUSTERS_TITLE = 'DB clusters';
export const CREATE_CLUSTER_TITLE = 'Create DB cluster';
export const ADD_INSTANCE_TITLE = 'Add DB instance';

/** The notice's plural word, per section: S1 to S3, S4 to S7. */
export const INSTANCES_WORD = 'DB instances';
export const CLUSTERS_WORD = 'DB clusters';

/** A tag as the API gives it. */
export interface Tag {
  key: string;
  value: string;
}

/** An engine with its version as one text ("postgres 18.3"); the engine alone without a version. */
export function engineText(engine: string | undefined, version: string | undefined): string | undefined {
  if (engine === undefined || engine === '') {
    return version === undefined || version === '' ? undefined : version;
  }
  return version === undefined || version === '' ? engine : `${engine} ${version}`;
}
