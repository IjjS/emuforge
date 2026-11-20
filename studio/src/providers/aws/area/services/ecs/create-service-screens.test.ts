import { expect, it } from 'vitest';

import { matchesPattern } from '../../screen-paths';
import { CREATE_SERVICE_SCREENS } from './create-service-screens';
import { SCREENS } from './screens';
import { SERVICE_SCREENS } from './service-screens';

function matches(path: string) {
  return SCREENS.filter(({ paths }) => paths.some((pattern) => matchesPattern(pattern, path)));
}

it('registers the create form with the cluster breadcrumb and Clusters navigation', () => {
  const [form] = CREATE_SERVICE_SCREENS;
  if (form === undefined || typeof form.crumbs !== 'function') throw new Error('Missing create service screen');
  expect(matches('/aws/ecs/clusters/cluster/dev/services/create')).toEqual([form]);
  expect(form.title).toBe('Create service');
  expect(form.crumbs({ cluster: 'dev' }, new URLSearchParams())).toEqual([
    { text: 'Clusters', href: '/aws/ecs/clusters' },
    { text: 'dev', href: '/aws/ecs/clusters/cluster/dev' },
    { text: 'Create service' },
  ]);
  expect(form.navigation.activeHref).toBe('/aws/ecs/clusters');
});

it('resolves a service named create to service detail', () => {
  expect(matches('/aws/ecs/clusters/cluster/dev/services/service/create')).toEqual(SERVICE_SCREENS);
});
