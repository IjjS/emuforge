import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Clusters',
        path: '/aws/ecs/clusters',
        listedBy: 'ListClusters',
      },
      {
        label: 'Task definitions',
        path: '/aws/ecs/task-definitions',
        listedBy: 'ListTaskDefinitions',
      },
      {
        label: 'Account settings',
        path: '/aws/ecs/account-settings',
        listedBy: 'ListAccountSettings',
      },
      {
        label: 'Attributes',
        path: '/aws/ecs/attributes',
        listedBy: 'ListAttributes',
        listedInside: '/aws/ecs/clusters',
      },
      {
        label: 'Capacity providers',
        path: '/aws/ecs/capacity-providers',
        listedBy: 'DescribeCapacityProviders',
      },
      {
        label: 'Container instances',
        path: '/aws/ecs/container-instances',
        listedBy: 'ListContainerInstances',
        listedInside: '/aws/ecs/clusters',
      },
      {
        label: 'Daemon task definitions',
        path: '/aws/ecs/daemon-task-definitions',
        listedBy: 'ListDaemonTaskDefinitions',
      },
      {
        label: 'Daemons',
        path: '/aws/ecs/daemons',
        listedBy: 'ListDaemons',
        listedInside: '/aws/ecs/clusters',
      },
      {
        label: 'Services',
        path: '/aws/ecs/services',
        listedBy: 'ListServices',
        listedInside: '/aws/ecs/clusters',
        shownIn: {
          entry: '/aws/ecs/clusters',
          place: 'the "Services" section of a cluster',
        },
      },
      {
        label: 'Tasks',
        path: '/aws/ecs/tasks',
        listedBy: 'ListTasks',
        listedInside: '/aws/ecs/clusters',
        shownIn: {
          entry: '/aws/ecs/clusters',
          place: 'the "Tasks" section of a cluster',
        },
      },
    ],
  },
];
