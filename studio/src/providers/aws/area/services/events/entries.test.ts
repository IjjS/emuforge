import { expect, it } from 'vitest';

import { entryFaults } from '../../entries';
import { collectScreens } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

it('lists the required groups, sub-services and resource kinds in order', () => {
  expect(
    ENTRIES.map(({ name, subService, entries }) => ({
      name,
      subService,
      entries: entries.map(({ label, path, listedBy }) => [label, path, listedBy]),
    })),
  ).toEqual([
    {
      name: 'EventBridge',
      entries: [
        ['Event buses', '/aws/events/event-buses', 'ListEventBuses'],
        ['Rules', '/aws/events/rules', 'ListRules'],
        ['API destinations', '/aws/events/api-destinations', 'ListApiDestinations'],
        ['Archives', '/aws/events/archives', 'ListArchives'],
        ['Connections', '/aws/events/connections', 'ListConnections'],
        ['Endpoints', '/aws/events/endpoints', 'ListEndpoints'],
        ['Replays', '/aws/events/replays', 'ListReplays'],
        ['Targets', '/aws/events/targets', 'ListTargetsByRule'],
      ],
    },
    {
      name: 'EventBridge Scheduler',
      subService: { name: 'EventBridge Scheduler', path: '/aws/events/eventbridge-scheduler' },
      entries: [
        ['Schedule groups', '/aws/events/schedule-groups', 'ListScheduleGroups'],
        ['Schedules', '/aws/events/schedules', 'ListSchedules'],
      ],
    },
    {
      name: 'EventBridge Pipes',
      subService: { name: 'EventBridge Pipes', path: '/aws/events/eventbridge-pipes' },
      entries: [['Pipes', '/aws/events/pipes', 'ListPipes']],
    },
    {
      name: 'EventBridge Schemas',
      subService: { name: 'EventBridge Schemas', path: '/aws/events/eventbridge-schemas' },
      entries: [
        ['Discoverers', '/aws/events/discoverers', 'ListDiscoverers'],
        ['Registries', '/aws/events/registries', 'ListRegistries'],
        ['Schemas', '/aws/events/schemas', 'ListSchemas'],
      ],
    },
  ]);
});

it('meets the entry registry rules and lists Targets inside Rules', () => {
  const screens = collectScreens([{ folder: 'events', screens: SCREENS }]);
  expect(entryFaults([{ folder: 'events', groups: ENTRIES }], screens)).toEqual([]);
  expect(ENTRIES[0]?.entries.find(({ label }) => label === 'Targets')?.listedInside).toBe('/aws/events/rules');
});

it('shows Targets in a rule’s page under Rules', () => {
  expect(ENTRIES[0]?.entries.find(({ label }) => label === 'Targets')?.shownIn).toEqual({
    entry: '/aws/events/rules',
    place: "a rule's page",
  });
  expect(
    ENTRIES.flatMap(({ entries }) => entries.filter(({ shownIn }) => shownIn !== undefined)).map(({ label }) => label),
  ).toEqual(['Targets']);
});
