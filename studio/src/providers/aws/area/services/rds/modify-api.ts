import { ModifyDBInstanceCommand } from '@aws-sdk/client-rds';

import { sendRds, text } from './api';

export const MODIFY_INSTANCE = 'ModifyDBInstance';

export interface InstanceChanges {
  identifier?: string;
  instanceClass?: string;
  allocatedStorage?: number;
  masterPassword?: string;
  deletionProtection?: boolean;
}

/** Apply the supplied changes to the original identifier and return the identifier the emulator assigned. */
export async function modifyInstance(
  endpoint: string,
  id: string,
  changes: InstanceChanges,
  signal: AbortSignal,
): Promise<string> {
  const output = await sendRds(
    endpoint,
    MODIFY_INSTANCE,
    (client, abortSignal) =>
      client.send(
        new ModifyDBInstanceCommand({
          DBInstanceIdentifier: id,
          ApplyImmediately: true,
          NewDBInstanceIdentifier: changes.identifier,
          DBInstanceClass: changes.instanceClass,
          AllocatedStorage: changes.allocatedStorage,
          MasterUserPassword: changes.masterPassword === '' ? undefined : changes.masterPassword,
          DeletionProtection: changes.deletionProtection,
        }),
        { abortSignal },
      ),
    signal,
  );
  const updatedId = text(output.DBInstance?.DBInstanceIdentifier);
  if (updatedId === undefined) {
    throw new Error('ModifyDBInstance answered with no identifier.');
  }
  return updatedId;
}
