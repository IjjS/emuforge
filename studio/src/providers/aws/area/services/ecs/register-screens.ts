import type { ServiceScreen } from '../../screens';
import { REGISTER_CRUMBS, REGISTER_PATH, REGISTER_TITLE, TASK_DEFINITIONS_NAVIGATION } from './format';
import { RegisterPage } from './pages/register-page';

/** ECS's screen of S10, "Register task definition" (unit s7), which `screens.ts` collects. */
export const REGISTER_SCREENS: readonly ServiceScreen[] = [
  // S10, with or without `?from={family}:{revision}`. The literal `register` is no family's address: a family's page
  // is under `family/{family}`.
  {
    paths: [REGISTER_PATH],
    title: REGISTER_TITLE,
    crumbs: REGISTER_CRUMBS,
    navigation: TASK_DEFINITIONS_NAVIGATION,
    Page: RegisterPage,
  },
];
