import { ModifyDBInstanceCommand } from '@aws-sdk/client-rds';

import { sendRds, text } from './api';
import type { UpgradeTarget } from './choices-api';
import { versionChange } from './modify-draft';

export const MODIFY_INSTANCE = 'ModifyDBInstance';

export interface InstanceChanges {
  identifier?: string;
  instanceClass?: string;
  engineVersion?: UpgradeTarget;
  allocatedStorage?: number;
  storageType?: string;
  iops?: number;
  multiAz?: boolean;
  subnetGroup?: string;
  securityGroupIds?: string[];
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
          ...versionChange(changes.engineVersion),
          AllocatedStorage: changes.allocatedStorage,
          StorageType: changes.storageType,
          Iops: changes.iops,
          MultiAZ: changes.multiAz,
          DBSubnetGroupName: changes.subnetGroup,
          VpcSecurityGroupIds: changes.securityGroupIds,
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
