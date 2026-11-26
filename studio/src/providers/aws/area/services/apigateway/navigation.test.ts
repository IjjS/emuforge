import { expect, it } from 'vitest';

import { ENTRIES } from './entries';
import { apisPath } from './format';
import { apiGatewayNavigation } from './navigation';

it('links APIs first and groups the service entries in order', () => {
  const navigation = apiGatewayNavigation();
  expect(navigation.header).toEqual({ text: 'API Gateway', href: '/aws/apigateway' });
  expect(navigation.items).toEqual([
    { type: 'link', text: 'APIs', href: apisPath },
    ...(
      [
        ['REST APIs', 'More REST API resources'],
        ['HTTP and WebSocket APIs', 'More HTTP and WebSocket API resources'],
      ] as const
    ).map(([group, moreLabel]) => {
      const links = (built: boolean) =>
        ENTRIES.filter((entry) => entry.group === group && entry.built === built).map(({ name, path }) => ({
          type: 'link',
          text: name,
          href: path,
        }));
      return {
        type: 'section',
        text: group,
        defaultExpanded: true,
        items: [...links(true), { type: 'section', text: moreLabel, defaultExpanded: false, items: links(false) }],
      };
    }),
  ]);
});

it.each([
  ['/aws/apigateway/deployments', true, false],
  ['/aws/apigateway/v2/deployments', false, true],
])('opens the additional section for the current entry %s', (href, restExpanded, v2Expanded) => {
  const navigation = apiGatewayNavigation(href);
  expect(navigation.activeHref).toBe(href);
  const [, rest, v2] = navigation.items;
  expect(rest?.type === 'section' && rest.items.at(-1)).toMatchObject({ defaultExpanded: restExpanded });
  expect(v2?.type === 'section' && v2.items.at(-1)).toMatchObject({ defaultExpanded: v2Expanded });
});

it('marks the screen entry current, defaulting to APIs', () => {
  expect(apiGatewayNavigation().activeHref).toBe(apisPath);
  expect(apiGatewayNavigation('/aws/apigateway/v2/routes').activeHref).toBe('/aws/apigateway/v2/routes');
});
