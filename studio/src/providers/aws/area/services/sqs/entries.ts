import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Queues',
        path: '/aws/sqs/queues',
        listedBy: 'ListQueues',
      },
      {
        label: 'Message move tasks',
        path: '/aws/sqs/message-move-tasks',
        listedBy: 'ListMessageMoveTasks',
        listedInside: '/aws/sqs/queues',
        shownIn: {
          entry: '/aws/sqs/queues',
          place: '"Move tasks" in the "Redrive" tab of a dead-letter queue',
        },
      },
    ],
  },
];
