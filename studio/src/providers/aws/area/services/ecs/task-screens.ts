import type { ServiceScreen } from '../../screens';
import { CLUSTERS_NAVIGATION, TASK_PATTERN, taskCrumbs } from './format';
import { TaskPage } from './pages/task-page';

/** ECS's screen S5, a task (unit s2), which `screens.ts` collects: its title and its last crumb the task's id. */
export const TASK_SCREENS: readonly ServiceScreen[] = [
  {
    paths: [TASK_PATTERN],
    title: ({ task }) => task ?? '',
    crumbs: ({ cluster, task }) => taskCrumbs(cluster ?? '', task ?? ''),
    navigation: CLUSTERS_NAVIGATION,
    Page: TaskPage,
  },
];
