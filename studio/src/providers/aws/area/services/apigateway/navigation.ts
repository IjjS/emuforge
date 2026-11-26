import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';

import type { ScreenNavigation } from '../../screens';
import { ENTRIES, type ApiGatewayEntry } from './entries';
import { apisPath, servicePath } from './format';

function entryLink({ name, path }: ApiGatewayEntry): SideNavigationProps.Link {
  return { type: 'link', text: name, href: path };
}

function entrySection(
  group: Exclude<ApiGatewayEntry['group'], 'core'>,
  moreLabel: string,
  activeHref: string,
): SideNavigationProps.Section {
  const entries = ENTRIES.filter((entry) => entry.group === group);
  const additional = entries.filter((entry) => !entry.built);
  return {
    type: 'section',
    text: group,
    defaultExpanded: true,
    items: [
      ...entries.filter((entry) => entry.built).map(entryLink),
      {
        type: 'section',
        text: moreLabel,
        defaultExpanded: additional.some((entry) => entry.path === activeHref),
        items: additional.map(entryLink),
      },
    ],
  };
}

export function apiGatewayNavigation(activeHref = apisPath): ScreenNavigation {
  const items = [
    ...ENTRIES.filter((entry) => entry.group === 'core').map(entryLink),
    entrySection('REST APIs', 'More REST API resources', activeHref),
    entrySection('HTTP and WebSocket APIs', 'More HTTP and WebSocket API resources', activeHref),
  ];
  return { header: { text: 'API Gateway', href: servicePath }, items, activeHref };
}
