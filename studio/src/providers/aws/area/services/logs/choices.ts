import type { ChoiceSource } from '../../components/use-paged-choices';
import { listLogGroups, OPERATIONS } from './api';
import { DESCRIBE_LOG_STREAMS, listLogStreams } from './stream-api';

function nameOption(name: string) {
  return { label: name, value: name };
}

export function logGroupChoices(endpoint: string | undefined): ChoiceSource<string> {
  return {
    key: ['logs', 'choices', 'groups'],
    endpoint,
    operation: OPERATIONS.describeLogGroups,
    filtering: 'sent',
    read: async (at, text, token, signal) => {
      const page = await listLogGroups(at, text, token, signal);
      return { ...page, items: page.items.flatMap(({ logGroupName }) => logGroupName ?? []) };
    },
    optionOf: nameOption,
  };
}

export function logStreamChoices(endpoint: string | undefined, group: string | undefined): ChoiceSource<string> {
  const ready = group !== undefined && group !== '';
  return {
    key: ['logs', 'choices', 'streams', group],
    endpoint,
    operation: DESCRIBE_LOG_STREAMS,
    filtering: 'sent',
    ready,
    read: async (at, text, token, signal) => {
      if (!ready) return { items: [] };
      const page = await listLogStreams(at, group, text, token, signal);
      return { ...page, items: page.items.flatMap(({ logStreamName }) => logStreamName ?? []) };
    },
    optionOf: nameOption,
  };
}
