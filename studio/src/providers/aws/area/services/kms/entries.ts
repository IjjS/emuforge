import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Customer managed keys',
        path: '/aws/kms/keys',
        listedBy: 'ListKeys',
      },
      {
        label: 'Aliases',
        path: '/aws/kms/aliases',
        listedBy: 'ListAliases',
        shownIn: {
          entry: '/aws/kms/keys',
          place: '"Aliases" in the "Labels" tab of a key',
        },
      },
      {
        label: 'Custom key stores',
        path: '/aws/kms/custom-key-stores',
        listedBy: 'DescribeCustomKeyStores',
      },
      {
        label: 'Grants',
        path: '/aws/kms/grants',
        listedBy: 'ListGrants',
        listedInside: '/aws/kms/keys',
        shownIn: {
          entry: '/aws/kms/keys',
          place: '"Grants" in the "Access" tab of a key',
        },
      },
      {
        label: 'Key policies',
        path: '/aws/kms/key-policies',
        listedBy: 'ListKeyPolicies',
        listedInside: '/aws/kms/keys',
        shownIn: {
          entry: '/aws/kms/keys',
          place: '"Key policy" in the "Access" tab of a key',
        },
      },
      {
        label: 'Key rotations',
        path: '/aws/kms/key-rotations',
        listedBy: 'ListKeyRotations',
        listedInside: '/aws/kms/keys',
        shownIn: {
          entry: '/aws/kms/keys',
          place: '"Rotation history" in the "Rotation" tab of a key',
        },
      },
    ],
  },
];
