import type { ServiceScreen } from '../../../screens';
import { CREATE_RULE_PATH, RULES_PATH } from '../format';
import { eventsNavigation } from '../navigation';
import { CreateRulePage } from '../pages/create-rule-page';
import { CREATE_RULE_TITLE } from '../rule-form';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [CREATE_RULE_PATH],
    title: CREATE_RULE_TITLE,
    crumbs: [{ text: 'Rules', href: RULES_PATH }, { text: CREATE_RULE_TITLE }],
    navigation: eventsNavigation(RULES_PATH),
    Page: CreateRulePage,
  },
];
