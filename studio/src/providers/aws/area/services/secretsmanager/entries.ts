import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Secrets',
        path: '/aws/secretsmanager/secrets',
        listedBy: 'ListSecrets',
      },
      {
        label: 'Secret versions',
        path: '/aws/secretsmanager/secret-versions',
        listedBy: 'ListSecretVersionIds',
        listedInside: '/aws/secretsmanager/secrets',
        shownIn: {
          entry: '/aws/secretsmanager/secrets',
          place: 'the "Version history" section of a secret',
        },
      },
    ],
  },
];
