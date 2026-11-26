import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Topics',
        path: '/aws/sns/topics',
        listedBy: 'ListTopics',
      },
      {
        label: 'Platform applications',
        path: '/aws/sns/platform-applications',
        listedBy: 'ListPlatformApplications',
      },
      {
        label: 'Platform endpoints',
        path: '/aws/sns/platform-endpoints',
        listedBy: 'ListEndpointsByPlatformApplication',
        listedInside: '/aws/sns/platform-applications',
      },
      {
        label: 'SMS sandbox phone numbers',
        path: '/aws/sns/sms-sandbox-phone-numbers',
        listedBy: 'ListSMSSandboxPhoneNumbers',
      },
      {
        label: 'Subscriptions',
        path: '/aws/sns/subscriptions',
        listedBy: 'ListSubscriptions',
        shownIn: {
          entry: '/aws/sns/topics',
          place: 'the "Subscriptions" tab of a topic',
        },
      },
    ],
  },
];
