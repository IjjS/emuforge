import { CloudFormationClient, ListStacksCommand } from '@aws-sdk/client-cloudformation';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest } from '../../../../../lib/aws/request';
import type { TokenPage } from '../../components/use-token-listing';

export const LIST_STACKS = 'ListStacks';

export interface StackRow {
  id: string;
  name: string;
  status: string;
  created: Date;
  description: string | undefined;
}

const clients = new Map<string, CloudFormationClient>();

function cloudFormationClient(endpoint: string): CloudFormationClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(CloudFormationClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

export async function listStacks(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<StackRow>> {
  const command = new ListStacksCommand(token === undefined ? {} : { NextToken: token });
  const answer = await sendRequest(
    LIST_STACKS,
    (abortSignal) => cloudFormationClient(endpoint).send(command, { abortSignal }),
    signal,
  );
  const items = (answer.StackSummaries ?? []).map(
    ({ StackId, StackName, StackStatus, CreationTime, TemplateDescription }): StackRow => {
      if (
        !StackId ||
        !StackName ||
        !StackStatus ||
        CreationTime === undefined ||
        Number.isNaN(CreationTime.getTime())
      ) {
        throw new RequestError({
          kind: 'other',
          operation: LIST_STACKS,
          code: 'The emulator returned an incomplete stack summary.',
        });
      }
      return {
        id: StackId,
        name: StackName,
        status: StackStatus,
        created: CreationTime,
        description: TemplateDescription,
      };
    },
  );
  return answer.NextToken ? { items, next: answer.NextToken } : { items };
}
