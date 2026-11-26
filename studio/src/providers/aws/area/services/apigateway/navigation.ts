import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';

import type { ScreenNavigation } from '../../screens';
import { ENTRIES, type ApiGatewayEntry } from './entries';
import { apisPath, servicePath } from './format';

function entryLinks(group: ApiGatewayEntry['group']): SideNavigationProps.Link[] {
  return ENTRIES.filter((entry) => entry.group === group).map(({ name, path }) => ({
    type: 'link',
    text: name,
    href: path,
  }));
}

const items: ScreenNavigation['items'] = [
  ...entryLinks('core'),
  { type: 'section', text: 'REST APIs', items: entryLinks('REST APIs') },
  { type: 'section', text: 'HTTP and WebSocket APIs', items: entryLinks('HTTP and WebSocket APIs') },
];

export function apiGatewayNavigation(activeHref = apisPath): ScreenNavigation {
  return { header: { text: 'API Gateway', href: servicePath }, items, activeHref };
}
