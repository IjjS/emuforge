import { expect, it } from 'vitest';

import { ENTRIES } from './entries';
import { apisPath } from './format';
import { apiGatewayNavigation } from './navigation';

it('links APIs first and groups the service entries in order', () => {
  const navigation = apiGatewayNavigation();
  expect(navigation.header).toEqual({ text: 'API Gateway', href: '/aws/apigateway' });
  expect(navigation.items).toEqual([
    { type: 'link', text: 'APIs', href: apisPath },
    ...(['REST APIs', 'HTTP and WebSocket APIs'] as const).map((group) => ({
      type: 'section',
      text: group,
      items: ENTRIES.filter((entry) => entry.group === group).map(({ name, path }) => ({
        type: 'link',
        text: name,
        href: path,
      })),
    })),
  ]);
});

it('marks the screen entry current, defaulting to APIs', () => {
  expect(apiGatewayNavigation().activeHref).toBe(apisPath);
  expect(apiGatewayNavigation('/aws/apigateway/v2/routes').activeHref).toBe('/aws/apigateway/v2/routes');
});
