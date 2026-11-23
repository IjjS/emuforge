import SpaceBetween from '@cloudscape-design/components/space-between';

import type { AreaConnection } from '../../../../components/emulator-line';
import { Aliases } from './aliases';
import { Tags } from './tags';

export function Labels({ connection, keyId }: { connection: AreaConnection; keyId: string }) {
  const connected = connection.result === undefined || connection.result.kind === 'connected';
  const scope = JSON.stringify([connection.engineOrigin, connected, keyId]);

  return (
    <SpaceBetween key={scope} size="l">
      <Aliases connection={connection} keyId={keyId} />
      <Tags connection={connection} keyId={keyId} />
    </SpaceBetween>
  );
}
