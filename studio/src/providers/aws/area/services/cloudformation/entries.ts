import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Stacks',
        path: '/aws/cloudformation/stacks',
        listedBy: 'ListStacks',
      },
      {
        label: 'Change sets',
        path: '/aws/cloudformation/change-sets',
        listedBy: 'ListChangeSets',
        listedInside: '/aws/cloudformation/stacks',
      },
      {
        label: 'Generated templates',
        path: '/aws/cloudformation/generated-templates',
        listedBy: 'ListGeneratedTemplates',
      },
      {
        label: 'Resource scans',
        path: '/aws/cloudformation/resource-scans',
        listedBy: 'ListResourceScans',
      },
      {
        label: 'Stack instances',
        path: '/aws/cloudformation/stack-instances',
        listedBy: 'ListStackInstances',
        listedInside: '/aws/cloudformation/stack-sets',
      },
      {
        label: 'Stack sets',
        path: '/aws/cloudformation/stack-sets',
        listedBy: 'ListStackSets',
      },
      {
        label: 'Type versions',
        path: '/aws/cloudformation/type-versions',
        listedBy: 'ListTypeVersions',
        listedInside: '/aws/cloudformation/types',
      },
      {
        label: 'Types',
        path: '/aws/cloudformation/types',
        listedBy: 'ListTypes',
      },
    ],
  },
];
