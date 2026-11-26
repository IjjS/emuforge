import { describe, expect, it } from 'vitest';

import {
  CLUSTER_PATTERN,
  clusterHref,
  CLUSTERS_NAVIGATION,
  CLUSTERS_PATH,
  CREATE_CLUSTER_PATH,
  createServiceHref,
  ECS_PATH,
  FAMILY_PATTERN,
  familyHref,
  REGISTER_PATH,
  registerHref,
  REVISION_PATTERN,
  revisionHref,
  RUN_TASK_PATTERN,
  runTaskHref,
  SERVICE_PATTERN,
  serviceHref,
  statusText,
  TASK_DEFINITIONS_NAVIGATION,
  TASK_DEFINITIONS_PATH,
  TASK_PATTERN,
  taskHref,
} from './format';

describe("ECS's addresses", () => {
  it("are the requirement's routes", () => {
    expect(ECS_PATH).toBe('/aws/ecs');
    expect(CLUSTERS_PATH).toBe('/aws/ecs/clusters');
    expect(CREATE_CLUSTER_PATH).toBe('/aws/ecs/clusters/create');
    expect(CLUSTER_PATTERN).toBe('/aws/ecs/clusters/cluster/{cluster}');
    expect(SERVICE_PATTERN).toBe('/aws/ecs/clusters/cluster/{cluster}/services/service/{service}');
    expect(TASK_PATTERN).toBe('/aws/ecs/clusters/cluster/{cluster}/tasks/task/{task}');
    expect(RUN_TASK_PATTERN).toBe('/aws/ecs/clusters/cluster/{cluster}/tasks/run');
    expect(TASK_DEFINITIONS_PATH).toBe('/aws/ecs/task-definitions');
    expect(FAMILY_PATTERN).toBe('/aws/ecs/task-definitions/family/{family}');
    expect(REVISION_PATTERN).toBe('/aws/ecs/task-definitions/family/{family}/revision/{revision}');
    expect(REGISTER_PATH).toBe('/aws/ecs/task-definitions/register');
  });

  it('each path builder gives the route of R3, each value one encoded segment', () => {
    expect(clusterHref('dev')).toBe('/aws/ecs/clusters/cluster/dev');
    expect(serviceHref('dev', 'web')).toBe('/aws/ecs/clusters/cluster/dev/services/service/web');
    expect(taskHref('dev', 'abc123')).toBe('/aws/ecs/clusters/cluster/dev/tasks/task/abc123');
    expect(runTaskHref('dev')).toBe('/aws/ecs/clusters/cluster/dev/tasks/run');
    expect(familyHref('app')).toBe('/aws/ecs/task-definitions/family/app');
    expect(revisionHref('app', 3)).toBe('/aws/ecs/task-definitions/family/app/revision/3');

    const odd = 'a/b c';
    const encoded = 'a%2Fb%20c';
    expect(clusterHref(odd)).toBe(`/aws/ecs/clusters/cluster/${encoded}`);
    expect(serviceHref(odd, odd)).toBe(`/aws/ecs/clusters/cluster/${encoded}/services/service/${encoded}`);
    expect(taskHref(odd, odd)).toBe(`/aws/ecs/clusters/cluster/${encoded}/tasks/task/${encoded}`);
    expect(runTaskHref(odd)).toBe(`/aws/ecs/clusters/cluster/${encoded}/tasks/run`);
    expect(familyHref(odd)).toBe(`/aws/ecs/task-definitions/family/${encoded}`);
    expect(revisionHref(odd, odd)).toBe(`/aws/ecs/task-definitions/family/${encoded}/revision/${encoded}`);
    for (const href of [clusterHref(odd), serviceHref(odd, odd), taskHref(odd, odd), revisionHref(odd, odd)]) {
      expect(href.split('/').length).toBe(href.replaceAll(encoded, 'x').split('/').length);
    }
  });

  it('the register path with a family and a revision → …/register?from={family}:{revision}, encoded once', () => {
    expect(registerHref()).toBe('/aws/ecs/task-definitions/register');
    expect(registerHref({ family: 'app', revision: 3 })).toBe('/aws/ecs/task-definitions/register?from=app%3A3');
    expect(registerHref({ family: 'a b/c', revision: '12' })).toBe(
      '/aws/ecs/task-definitions/register?from=a%20b%2Fc%3A12',
    );
    const query = new URLSearchParams(registerHref({ family: 'a b/c', revision: 12 }).split('?')[1]);
    expect(query.get('from')).toBe('a b/c:12');
  });
});

describe('the status words', () => {
  it("a word of R4 → its sentence-case text; a word not listed → as given; none → '-'", () => {
    expect(statusText('RUNNING')).toBe('Running');
    expect(statusText('PROVISIONING')).toBe('Provisioning');
    expect(statusText('IN_PROGRESS')).toBe('In progress');
    expect(statusText('ACTIVE')).toBe('Active');
    expect(statusText('STOPPED')).toBe('Stopped');
    expect(statusText('DRAINING')).toBe('Draining');
    expect(statusText('INACTIVE')).toBe('Inactive');
    expect(statusText('COMPLETED')).toBe('Completed');
    expect(statusText('DEACTIVATING')).toBe('DEACTIVATING');
    expect(statusText('toString')).toBe('toString');
    expect(statusText(undefined)).toBe('-');
    expect(statusText('')).toBe('-');
  });
});

describe('the side navigation', () => {
  it('marks the appropriate entry current under the header "ECS"', () => {
    for (const navigation of [CLUSTERS_NAVIGATION, TASK_DEFINITIONS_NAVIGATION]) {
      expect(navigation.header).toEqual({ text: 'ECS', href: '/aws/ecs' });
      expect(navigation).not.toHaveProperty('items');
    }
    expect(CLUSTERS_NAVIGATION.activeHref).toBe('/aws/ecs/clusters');
    expect(TASK_DEFINITIONS_NAVIGATION.activeHref).toBe('/aws/ecs/task-definitions');
  });
});

it('keeps a cluster name in one encoded create-service segment', () => {
  expect(createServiceHref('dev/west %')).toBe('/aws/ecs/clusters/cluster/dev%2Fwest%20%25/services/create');
});
