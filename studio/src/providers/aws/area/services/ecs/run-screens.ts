import type { ServiceScreen } from '../../screens';
import { CLUSTERS_NAVIGATION, RUN_TASK_PATTERN, RUN_TASK_TITLE, runTaskCrumbs } from './format';
import { RunTaskPage } from './pages/run-task-page';

/** ECS's screens of S6, "Run task" (unit s3), which `screens.ts` collects. */
export const RUN_SCREENS: readonly ServiceScreen[] = [
  // S6: "Run task" in a cluster, in the clusters' section. The literal `run` after `tasks/` is no task's address:
  // a task's page is under `tasks/task/{task}`.
  {
    paths: [RUN_TASK_PATTERN],
    title: RUN_TASK_TITLE,
    crumbs: (params) => runTaskCrumbs(params.cluster ?? ''),
    navigation: CLUSTERS_NAVIGATION,
    Page: RunTaskPage,
  },
];
