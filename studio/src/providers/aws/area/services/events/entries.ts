import type { EntryGroup } from '../../entries';
import { EVENT_BUSES_PATH, EVENTS_PATH, RULES_PATH } from './format';

export const ENTRIES: readonly EntryGroup[] = [
  {
    name: 'EventBridge',
    entries: [
      { label: 'Event buses', path: EVENT_BUSES_PATH, listedBy: 'ListEventBuses' },
      { label: 'Rules', path: RULES_PATH, listedBy: 'ListRules' },
      { label: 'API destinations', path: `${EVENTS_PATH}/api-destinations`, listedBy: 'ListApiDestinations' },
      { label: 'Archives', path: `${EVENTS_PATH}/archives`, listedBy: 'ListArchives' },
      { label: 'Connections', path: `${EVENTS_PATH}/connections`, listedBy: 'ListConnections' },
      { label: 'Endpoints', path: `${EVENTS_PATH}/endpoints`, listedBy: 'ListEndpoints' },
      { label: 'Replays', path: `${EVENTS_PATH}/replays`, listedBy: 'ListReplays' },
      {
        label: 'Targets',
        path: `${EVENTS_PATH}/targets`,
        listedBy: 'ListTargetsByRule',
        listedInside: RULES_PATH,
      },
    ],
  },
  {
    name: 'EventBridge Scheduler',
    subService: { name: 'EventBridge Scheduler', path: `${EVENTS_PATH}/eventbridge-scheduler` },
    entries: [
      { label: 'Schedule groups', path: `${EVENTS_PATH}/schedule-groups`, listedBy: 'ListScheduleGroups' },
      { label: 'Schedules', path: `${EVENTS_PATH}/schedules`, listedBy: 'ListSchedules' },
    ],
  },
  {
    name: 'EventBridge Pipes',
    subService: { name: 'EventBridge Pipes', path: `${EVENTS_PATH}/eventbridge-pipes` },
    entries: [{ label: 'Pipes', path: `${EVENTS_PATH}/pipes`, listedBy: 'ListPipes' }],
  },
  {
    name: 'EventBridge Schemas',
    subService: { name: 'EventBridge Schemas', path: `${EVENTS_PATH}/eventbridge-schemas` },
    entries: [
      { label: 'Discoverers', path: `${EVENTS_PATH}/discoverers`, listedBy: 'ListDiscoverers' },
      { label: 'Registries', path: `${EVENTS_PATH}/registries`, listedBy: 'ListRegistries' },
      {
        label: 'Schemas',
        path: `${EVENTS_PATH}/schemas`,
        listedBy: 'ListSchemas',
        listedInside: `${EVENTS_PATH}/registries`,
      },
    ],
  },
];
