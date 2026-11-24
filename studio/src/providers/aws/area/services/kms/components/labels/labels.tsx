import SpaceBetween from '@cloudscape-design/components/space-between';

import type { AreaConnection } from '../../../../components/emulator-line';
import { Aliases } from './aliases';
import { Tags } from './tags';

export function Labels({
  connection,
  keyId,
  writesEnabled = true,
}: {
  connection: AreaConnection;
  keyId: string;
  writesEnabled?: boolean;
}) {
  // The AWS area remounts the whole page on target changes, independently of connection status.
  const scope = JSON.stringify([connection.engineOrigin, keyId]);

  return (
    <SpaceBetween key={scope} size="l">
      <Aliases connection={connection} keyId={keyId} writesEnabled={writesEnabled} />
      <Tags connection={connection} keyId={keyId} writesEnabled={writesEnabled} />
    </SpaceBetween>
  );
}
