import {
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
  type CreateLogGroupCommandInput,
} from '@aws-sdk/client-cloudwatch-logs';

import { sendLogs } from '../../lib/cloudwatch-logs-client';

export const GROUP_CREATE_OPERATIONS = {
  createLogGroup: 'CreateLogGroup',
  putRetentionPolicy: 'PutRetentionPolicy',
} as const;

export function createLogGroup(endpoint: string, input: CreateLogGroupCommandInput, signal: AbortSignal) {
  return sendLogs(
    endpoint,
    GROUP_CREATE_OPERATIONS.createLogGroup,
    (client, abortSignal) => client.send(new CreateLogGroupCommand(input), { abortSignal }),
    signal,
  );
}

export function putRetentionPolicy(endpoint: string, name: string, days: number, signal: AbortSignal) {
  return sendLogs(
    endpoint,
    GROUP_CREATE_OPERATIONS.putRetentionPolicy,
    (client, abortSignal) =>
      client.send(new PutRetentionPolicyCommand({ logGroupName: name, retentionInDays: days }), { abortSignal }),
    signal,
  );
}
