// Run on the Compose machine with Bun's native SQL driver, without a client image.
import { SQL } from 'bun';
const { adapter, port, database, password } = JSON.parse(await Bun.stdin.text());
const client = new SQL({
  adapter,
  hostname: '127.0.0.1',
  port,
  database,
  username: 'dbadmin',
  password,
  connectionTimeout: 5,
  max: 1,
});
try {
  const rows =
    adapter === 'mysql'
      ? await client`SELECT DATABASE() AS db, 578 AS marker`
      : await client`SELECT current_database() AS db, 578 AS marker`;
  console.log(JSON.stringify(rows[0]));
} catch (error) {
  // Return only the database error code. Credentials never go to the log.
  console.log(JSON.stringify({ code: error.errno ?? error.code }));
} finally {
  await client.close();
}
