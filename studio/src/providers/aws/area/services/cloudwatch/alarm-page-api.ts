import {
  DescribeAlarmHistoryCommand,
  ListTagsForResourceCommand,
  type HistoryItemType,
  type Tag,
} from '@aws-sdk/client-cloudwatch';

import type { TokenPage } from '../../components/use-token-listing';
import { ALARM_TYPES } from './alarms-api';
import { sendCloudWatch } from './clients';

export const DESCRIBE_ALARM_HISTORY = 'DescribeAlarmHistory';
export const LIST_ALARM_TAGS = 'ListTagsForResource';

const HISTORY_TYPES: Record<HistoryItemType, string> = {
  ConfigurationUpdate: 'Configuration',
  StateUpdate: 'State',
  Action: 'Action',
};

export interface AlarmHistoryItem {
  time: Date | undefined;
  type: string | undefined;
  summary: string | undefined;
}

export async function readAlarmHistory(
  endpoint: string,
  name: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<AlarmHistoryItem>> {
  const command = new DescribeAlarmHistoryCommand({
    AlarmName: name,
    AlarmTypes: [...ALARM_TYPES],
    MaxRecords: 25,
    ...(token === undefined ? {} : { NextToken: token }),
  });
  const answer = await sendCloudWatch(
    endpoint,
    DESCRIBE_ALARM_HISTORY,
    (client, abortSignal) => client.send(command, { abortSignal }),
    signal,
  );
  return {
    items: (answer.AlarmHistoryItems ?? []).map(({ Timestamp, HistoryItemType, HistorySummary }) => ({
      time: Timestamp,
      type: HistoryItemType === undefined ? undefined : (HISTORY_TYPES[HistoryItemType] ?? HistoryItemType),
      summary: HistorySummary,
    })),
    ...(answer.NextToken === undefined ? {} : { next: answer.NextToken }),
  };
}

export async function readAlarmTags(endpoint: string, arn: string, signal: AbortSignal): Promise<Tag[]> {
  const answer = await sendCloudWatch(
    endpoint,
    LIST_ALARM_TAGS,
    (client, abortSignal) => client.send(new ListTagsForResourceCommand({ ResourceARN: arn }), { abortSignal }),
    signal,
  );
  return answer.Tags ?? [];
}
