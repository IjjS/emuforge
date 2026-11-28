import type { RequestFailure } from '../../../../../lib/aws/request';
import { isBusName } from './format';
import { useEventBus } from './queries';

export type BusChoice =
  | { kind: 'chosen'; name: string }
  | { kind: 'invalid'; name: string; message: string }
  | { kind: 'loading' }
  | { kind: 'failed'; failure: RequestFailure; retry: () => void };

function invalidBus(name: string): BusChoice {
  return {
    kind: 'invalid',
    name,
    message:
      name === ''
        ? 'The address names no event bus. Choose an event bus.'
        : `Event bus ${name} is not in your local emulator. Choose an event bus.`,
  };
}

/** Resolve an address's bus. A name just selected from the emulator's list is already resolved. */
export function useBusChoice(endpoint: string | undefined, addressBus: string | null, selectedBus?: string): BusChoice {
  const fromList = addressBus !== null && addressBus === selectedBus;
  const validName = addressBus !== null && isBusName(addressBus);
  const read = useEventBus(endpoint, addressBus ?? '', validName && !fromList);

  if (addressBus === null) return { kind: 'chosen', name: 'default' };
  if (fromList) return { kind: 'chosen', name: addressBus };
  if (!validName) return invalidBus(addressBus);
  if (read.failure !== undefined) return { kind: 'failed', failure: read.failure, retry: read.refresh };
  if (read.loading) return { kind: 'loading' };
  if (read.value?.kind === 'found' && read.value.bus.Name === addressBus) {
    return { kind: 'chosen', name: read.value.bus.Name };
  }
  return invalidBus(addressBus);
}
