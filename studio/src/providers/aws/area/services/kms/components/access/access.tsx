import SpaceBetween from '@cloudscape-design/components/space-between';

import type { AreaConnection } from '../../../../components/emulator-line';
import { connectionFailure } from '../../queries';
import { ACCESS_OPERATIONS } from '../../access-api';
import { Grants } from './grants';
import { KeyPolicy } from './key-policy';

export interface AccessProps {
  connection: AreaConnection;
  keyId: string;
}

export function Access({ connection, keyId }: AccessProps) {
  const offline = connectionFailure(connection, ACCESS_OPERATIONS.listPolicies) !== undefined;
  return (
    <SpaceBetween key={JSON.stringify([connection.engineOrigin, keyId, offline])} size="l">
      <KeyPolicy connection={connection} keyId={keyId} />
      <Grants connection={connection} keyId={keyId} />
    </SpaceBetween>
  );
}
