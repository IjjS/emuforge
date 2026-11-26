import type { AreaConnection } from '../../../components/emulator-line';
import { StreamSection } from './stream-section';

export function GroupStreams({ connection, group }: { connection: AreaConnection; group: string }) {
  return <StreamSection connection={connection} group={group} />;
}
