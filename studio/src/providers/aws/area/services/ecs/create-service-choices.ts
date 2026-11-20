import { DescribeTaskDefinitionCommand } from '@aws-sdk/client-ecs';

import type { ChoiceSource } from '../../components/use-paged-choices';
import type { TokenPage } from '../../components/use-token-listing';
import { sendEcs } from './api';
import { listRevisionChoices, revisionChoices, type RevisionChoice } from './definition-choices';

const DESCRIBE = 'DescribeTaskDefinition';

/** Skip raw pages with no eligible revisions, keeping the emulator's order and continuation. */
export async function listFargateRevisions(
  endpoint: string,
  family: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<RevisionChoice>> {
  let next = token;
  do {
    const page = await listRevisionChoices(endpoint, family, next, signal);
    const items: RevisionChoice[] = [];
    for (const revision of page.items) {
      const { taskDefinition } = await sendEcs(
        endpoint,
        DESCRIBE,
        (client, abortSignal) =>
          client.send(new DescribeTaskDefinitionCommand({ taskDefinition: revision.value }), { abortSignal }),
        signal,
      );
      if (
        taskDefinition?.status === 'ACTIVE' &&
        taskDefinition.networkMode === 'awsvpc' &&
        taskDefinition.compatibilities?.includes('FARGATE')
      ) {
        items.push(revision);
      }
    }
    next = page.next;
    if (items.length > 0 || next === undefined) {
      return next === undefined ? { items } : { items, next };
    }
  } while (next !== undefined);
  return { items: [] };
}

export function fargateRevisionChoices(
  endpoint: string | undefined,
  family: string | undefined,
): ChoiceSource<RevisionChoice> {
  const source = revisionChoices(endpoint, family);
  return {
    ...source,
    key: [...source.key, 'fargate'],
    read: (at, _text, token, signal) => listFargateRevisions(at, family ?? '', token, signal),
  };
}
