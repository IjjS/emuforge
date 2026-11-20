import type { ServiceScreen } from '../../screens';
import {
  familyCrumbs,
  FAMILY_PATTERN,
  revisionCrumbs,
  REVISION_PATTERN,
  TASK_DEFINITIONS_CRUMBS,
  TASK_DEFINITIONS_NAVIGATION,
  TASK_DEFINITIONS_PATH,
  TASK_DEFINITIONS_TITLE,
} from './format';
import { DefinitionListPage } from './pages/definition-list-page';
import { FamilyPage } from './pages/family-page';
import { RevisionPage } from './pages/revision-page';

/** ECS's screens of S7 to S9, the task definitions (unit s4), which `screens.ts` collects. */
export const DEFINITION_SCREENS: readonly ServiceScreen[] = [
  // S7: the active families.
  {
    paths: [TASK_DEFINITIONS_PATH],
    title: TASK_DEFINITIONS_TITLE,
    crumbs: TASK_DEFINITIONS_CRUMBS,
    navigation: TASK_DEFINITIONS_NAVIGATION,
    Page: DefinitionListPage,
  },
  // S8: a family, its title and last crumb the family's name.
  {
    paths: [FAMILY_PATTERN],
    title: ({ family }) => family ?? '',
    crumbs: ({ family }) => familyCrumbs(family ?? ''),
    navigation: TASK_DEFINITIONS_NAVIGATION,
    Page: FamilyPage,
  },
  // S9: a revision, its title "{family}:{revision}", its last crumb the revision's number.
  {
    paths: [REVISION_PATTERN],
    title: ({ family, revision }) => `${family ?? ''}:${revision ?? ''}`,
    crumbs: ({ family, revision }) => revisionCrumbs(family ?? '', revision ?? ''),
    navigation: TASK_DEFINITIONS_NAVIGATION,
    Page: RevisionPage,
  },
];
