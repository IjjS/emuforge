import type { ServiceScreen } from '../../../screens';
import { busFromParams, ruleFromParams, RULE_PATH, RULES_PATH, rulesPath } from '../format';
import { eventsNavigation } from '../navigation';
import { RulePage } from '../pages/rule-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [RULE_PATH],
    title: ruleFromParams,
    crumbs: (params) => [{ text: 'Rules', href: rulesPath(busFromParams(params)) }, { text: ruleFromParams(params) }],
    navigation: eventsNavigation(RULES_PATH),
    Page: RulePage,
  },
];
