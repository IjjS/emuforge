import { useTokenListing, type TokenListing } from '../../components/use-token-listing';
import { LIST_STACKS, listStacks, type StackRow } from './api';

export function useStackListing(endpoint: string | undefined, generation: number): TokenListing<StackRow> {
  return useTokenListing({
    key: ['aws', 'cloudformation', 'stacks', generation],
    endpoint,
    operation: LIST_STACKS,
    read: listStacks,
  });
}
