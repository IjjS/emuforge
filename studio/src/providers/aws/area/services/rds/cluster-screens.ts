import type { ServiceScreen } from '../../screens';
import {
  ADD_INSTANCE_PATTERN,
  ADD_INSTANCE_TITLE,
  CLUSTER_PATTERN,
  CLUSTER_SNAPSHOTS_PATH,
  CLUSTER_SNAPSHOTS_TITLE,
  clusterHref,
  CLUSTERS_PATH,
  CLUSTERS_TITLE,
} from './format';
import { CLUSTERS_NAVIGATION } from './navigation';
import { AddInstancePage } from './pages/add-instance-page';
import { ClusterListPage } from './pages/cluster-list-page';
import { ClusterPage } from './pages/cluster-page';
import { ClusterSnapshotsPage } from './pages/cluster-snapshots-page';

/** RDS's DB cluster screens, which `screens.ts` collects; "DB clusters" active. */
export const CLUSTER_SCREENS: readonly ServiceScreen[] = [
  // S4: the DB clusters.
  {
    paths: [CLUSTERS_PATH],
    title: CLUSTERS_TITLE,
    crumbs: [{ text: CLUSTERS_TITLE }],
    navigation: CLUSTERS_NAVIGATION,
    Page: ClusterListPage,
  },
  {
    paths: [CLUSTER_SNAPSHOTS_PATH],
    title: CLUSTER_SNAPSHOTS_TITLE,
    crumbs: [{ text: CLUSTERS_TITLE, href: CLUSTERS_PATH }, { text: CLUSTER_SNAPSHOTS_TITLE }],
    navigation: CLUSTERS_NAVIGATION,
    Page: ClusterSnapshotsPage,
  },
  // S6: a DB cluster, its crumb the identifier of the address.
  {
    paths: [CLUSTER_PATTERN],
    title: ({ id }) => id ?? '',
    crumbs: ({ id }) => [{ text: CLUSTERS_TITLE, href: CLUSTERS_PATH }, { text: id ?? '' }],
    navigation: CLUSTERS_NAVIGATION,
    Page: ClusterPage,
  },
  // S7: "Add DB instance" of a DB cluster, below the cluster's crumb.
  {
    paths: [ADD_INSTANCE_PATTERN],
    title: ADD_INSTANCE_TITLE,
    crumbs: ({ id }) => [
      { text: CLUSTERS_TITLE, href: CLUSTERS_PATH },
      { text: id ?? '', href: clusterHref(id ?? '') },
      { text: ADD_INSTANCE_TITLE },
    ],
    navigation: CLUSTERS_NAVIGATION,
    Page: AddInstancePage,
  },
];
