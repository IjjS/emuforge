import type { ServiceScreen } from '../../../screens';
import { ruleFromParams, RULE_PATH, RULES_PATH } from '../format';
import { eventsNavigation } from '../navigation';
import { RulePage } from '../pages/rule-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [RULE_PATH],
    title: ruleFromParams,
    crumbs: (params) => [{ text: 'Rules', href: RULES_PATH }, { text: ruleFromParams(params) }],
    navigation: eventsNavigation(RULES_PATH),
    Page: RulePage,
  },
];
