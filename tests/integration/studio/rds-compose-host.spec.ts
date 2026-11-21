import { CONTAINER } from './support/screen-rules';
import { expect, startStack, test } from './support';
import {
  clusterPath,
  valueLocator,
  instanceDirect,
  instancePath,
  open,
  rdsPrefix,
  RdsSeeded,
  runPassword,
} from './services/rds/rds';

test('studio.rds-compose-host-endpoints-match-describe', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const prefix = rdsPrefix(ctx, 'hostsql');
  const seed = new RdsSeeded(ctx, stack.emulatorPort, prefix);
  const login = { masterUsername: 'dbadmin', password: runPassword() };
  const id = await seed.instance({
    id: prefix + '-instance',
    engine: 'postgres',
    instanceClass: 'db.t3.micro',
    dbName: 'instanceapp',
    storage: 20,
    ...login,
  });
  const instance = await instanceDirect(ctx, stack.emulatorPort, id);
  const cluster = await seed.cluster({
    id: prefix + '-cluster',
    engine: 'aurora-postgresql',
    databaseName: 'clusterapp',
    ...login,
  });
  expect(cluster.readerEndpoint).toBeTruthy();
  for (const row of [
    { url: instancePath(id), id, port: instance?.port, label: 'Endpoint address', address: instance?.address },
    {
      url: clusterPath(cluster.id),
      id: cluster.id,
      port: cluster.port,
      label: 'Writer endpoint',
      address: cluster.endpoint,
    },
  ]) {
    expect(row.port).toMatch(/^\d+$/);
    expect(row.address).toBeTruthy();
    await open(page, row.url, row.id);
    const connection = page.locator(CONTAINER).filter({
      has: page.getByRole('heading', { name: 'Connection', exact: true, level: 2 }),
    });
    await expect(valueLocator(connection, row.label)).toHaveText(row.address!);
    await expect(valueLocator(connection, 'Port')).toHaveText(row.port!);
    if (row.id === cluster.id) {
      await expect(valueLocator(connection, 'Reader endpoint')).toHaveText(cluster.readerEndpoint!);
    }
    await expect(connection.getByRole('button', { name: 'Copy Compose host endpoint' })).toBeVisible();
    await expect(connection.getByText('127.0.0.1:' + row.port, { exact: true })).toBeVisible();
    await expect(connection.getByText(/database ports published.*SQL client on the machine running Compose/)).toBeVisible();
  }
});
