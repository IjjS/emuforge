import { CreateDBClusterCommand, CreateDBInstanceCommand } from '@aws-sdk/client-rds';

import { sendRds, text } from './api';

// The two creates of S2 and S5 (issue 573, design tasks 2 and 4): one `CreateDBInstance` or one `CreateDBCluster`,
// through `sendRds` with its operation's name, so a refusal rejects with its `RequestError` carrying the emulator's
// code and message as they came, and a 501 as "not implemented" with the operation. Only what was given is sent. The
// master password goes into the one request and nowhere else: nothing here keeps it, and a failure carries only the
// operation, the code and the message.

/** The operations of the creates, as a failure names them. */
export const CREATE_OPERATIONS = {
  createDBInstance: 'CreateDBInstance',
  createDBCluster: 'CreateDBCluster',
} as const;

/** What both creates may send besides their own values: each sent only when given. */
interface Optional {
  engineVersion?: string | undefined;
  subnetGroupName?: string | undefined;
  securityGroupIds?: readonly string[] | undefined;
}

/** What S2 creates. */
export interface NewInstance extends Optional {
  identifier: string;
  /** `postgres`, `mysql` or `mariadb`, as the API names it. */
  engine: string;
  instanceClass: string;
  /** In GiB. */
  allocatedStorage: number;
  masterUsername: string;
  masterPassword: string;
  /** Sent as `DBName`. */
  dbName?: string | undefined;
}

/** What S5 creates. */
export interface NewCluster extends Optional {
  identifier: string;
  /** `aurora-postgresql` or `aurora-mysql`, as the API names it. */
  engine: string;
  masterUsername: string;
  masterPassword: string;
  /** Sent as `DatabaseName`. */
  databaseName?: string | undefined;
}

function given(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function optional({ engineVersion, subnetGroupName, securityGroupIds }: Optional) {
  return {
    ...(given(engineVersion) ? { EngineVersion: engineVersion } : {}),
    ...(given(subnetGroupName) ? { DBSubnetGroupName: subnetGroupName } : {}),
    ...(securityGroupIds === undefined || securityGroupIds.length === 0
      ? {}
      : { VpcSecurityGroupIds: [...securityGroupIds] }),
  };
}

/** `CreateDBInstance`; the identifier of the instance it answers with, as the emulator gave it. */
export async function createInstance(endpoint: string, values: NewInstance, signal: AbortSignal): Promise<string> {
  const output = await sendRds(
    endpoint,
    CREATE_OPERATIONS.createDBInstance,
    (client, abortSignal) =>
      client.send(
        new CreateDBInstanceCommand({
          DBInstanceIdentifier: values.identifier,
          Engine: values.engine,
          DBInstanceClass: values.instanceClass,
          AllocatedStorage: values.allocatedStorage,
          MasterUsername: values.masterUsername,
          MasterUserPassword: values.masterPassword,
          ...(given(values.dbName) ? { DBName: values.dbName } : {}),
          ...optional(values),
        }),
        { abortSignal },
      ),
    signal,
  );
  const id = text(output.DBInstance?.DBInstanceIdentifier);
  if (id === undefined) {
    throw new Error('CreateDBInstance answered with no identifier.');
  }
  return id;
}

/** `CreateDBCluster`; the identifier of the cluster it answers with, as the emulator gave it. */
export async function createCluster(endpoint: string, values: NewCluster, signal: AbortSignal): Promise<string> {
  const output = await sendRds(
    endpoint,
    CREATE_OPERATIONS.createDBCluster,
    (client, abortSignal) =>
      client.send(
        new CreateDBClusterCommand({
          DBClusterIdentifier: values.identifier,
          Engine: values.engine,
          MasterUsername: values.masterUsername,
          MasterUserPassword: values.masterPassword,
          ...(given(values.databaseName) ? { DatabaseName: values.databaseName } : {}),
          ...optional(values),
        }),
        { abortSignal },
      ),
    signal,
  );
  const id = text(output.DBCluster?.DBClusterIdentifier);
  if (id === undefined) {
    throw new Error('CreateDBCluster answered with no identifier.');
  }
  return id;
}
