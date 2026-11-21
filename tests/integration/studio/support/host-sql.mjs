// Run on the Compose machine with Bun's native SQL driver, without a client image.
import { SQL } from 'bun';
const { adapter, port, database, password, ca } = JSON.parse(await Bun.stdin.text());
const client = new SQL({
  adapter,
  hostname: '127.0.0.1',
  port,
  database,
  username: 'dbadmin',
  password,
  tls: { ca, rejectUnauthorized: true, servername: '127.0.0.1' },
  connectionTimeout: 5,
  max: 1,
});
try {
  const rows =
    adapter === 'mysql'
      ? await client`SELECT DATABASE() AS db, 578 AS marker`.simple()
      : await client`SELECT current_database() AS db, 578 AS marker`;
  console.log(JSON.stringify(rows[0]));
} catch (error) {
  // Keep server text and credentials private while distinguishing authorization failures.
  const reason = /pg_hba.conf/i.test(error.message)
    ? 'host access rule'
    : /role .*does not exist/i.test(error.message)
      ? 'unknown login role'
      : /password authentication failed/i.test(error.message)
        ? 'password authentication failed'
        : undefined;
  console.log(JSON.stringify({ code: error.errno ?? error.code, reason }));
} finally {
  await client.close();
}
