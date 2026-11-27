import type { ServiceScreen } from '../../../screens';
import { RULES_PATH } from '../format';
import { eventsNavigation } from '../navigation';
import { RulesPage } from '../pages/rules-page';

const title = 'Rules';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [RULES_PATH],
    title,
    crumbs: [{ text: title }],
    navigation: eventsNavigation(RULES_PATH),
    Page: RulesPage,
  },
];
