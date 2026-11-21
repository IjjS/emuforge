// A loopback socket held just below a block leases it to this check across processes.
// Ordinary check control ports come from the host ephemeral interval, excluded here.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { type Ctx, EnvError } from './check';

export function portNumbers(low: number, high: number): number[] {
  return Array.from({ length: high - low + 1 }, (_, i) => low + i);
}

async function bind(port: number): Promise<net.Server> {
  const socket = net.createServer((peer) => peer.destroy());
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(port, '127.0.0.1', () => resolve(socket));
  });
}

function close(socket: net.Server): Promise<void> {
  return new Promise((resolve) => socket.close(() => resolve()));
}

export async function leaseDatabaseRange(ctx: Ctx) {
  const raw =
    process.platform === 'darwin'
      ? execFileSync('sysctl', ['-n', 'net.inet.ip.portrange.first', 'net.inet.ip.portrange.last'], {
          encoding: 'utf8',
        })
      : fs.readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8');
  const [first, last] = raw.trim().split(/\s+/).map(Number);
  if (!first || !last || first > last) throw new EnvError('Cannot determine the host ephemeral interval');
  for (let lock = 10000; lock + 64 < 65000; lock += 65) {
    const low = lock + 1;
    const high = lock + 64;
    if ((lock <= last && high >= first) || (lock <= 29023 && high >= 28000)) continue;
    let lease: net.Server | undefined;
    try {
      lease = await bind(lock);
      for (const port of portNumbers(low, high)) await close(await bind(port));
    } catch (error) {
      if (lease) await close(lease);
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') continue;
      throw error;
    }
    const held = lease;
    ctx.own({ dispose: () => close(held) });
    return { low, high, env: { EMUFORGE_DB_PORT_MIN: String(low), EMUFORGE_DB_PORT_MAX: String(high) } };
  }
  throw new EnvError('No free database port block outside the host ephemeral interval');
}
