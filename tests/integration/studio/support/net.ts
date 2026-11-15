// Ports and connections on loopback.

import fs from 'node:fs';
import net from 'node:net';

import { EnvError } from './check';
import { emulatorDir } from './emulator';

/** A loopback port nothing listens on now (bound to `127.0.0.1:0`, read, released). */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (e) => reject(new EnvError(`cannot bind a free loopback port: ${e.message}`)));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface FreePortOptions {
  /** The lowest port to accept (for example 10000, for a port of five digits); any port when unset. */
  min?: number | undefined;
}

/**
 * A free loopback port that is none of `taken` and whose `$HOME/.aws/emulator/<port>/` does not exist, so no
 * emulator ran there and a guard may remove that directory later without touching another emulator's files. With
 * `min`, only a port of at least `min` counts; `EnvError` when 20 tries give none.
 */
export async function freePortExcept(home: string, taken: number[], options: FreePortOptions = {}): Promise<number> {
  const min = options.min ?? 0;
  for (let i = 0; i < 20; i++) {
    const port = await freePort();
    if (port >= min && !taken.includes(port) && !fs.existsSync(emulatorDir(home, port))) return port;
  }
  throw new EnvError(
    min > 0
      ? `no free loopback port of at least ${String(min)} after 20 tries`
      : 'no free loopback port after 20 tries',
  );
}

/**
 * Throws `EnvError` when something already listens on `127.0.0.1:<port>`: a check must own the port its process is
 * about to take, or what it observes is not that process.
 */
export async function ensurePortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (e) => reject(new EnvError(`127.0.0.1:${port} is not free: ${e.message}`)));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
}

/** How a TCP connection to `127.0.0.1:<port>` ends: `open` (accepted), `refused`, or another error code. */
export async function probe(port: number, timeoutMs = 500): Promise<'open' | 'refused' | string> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (result: string) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done('timeout'));
    socket.once('connect', () => done('open'));
    socket.once('error', (e: NodeJS.ErrnoException) =>
      done(e.code === 'ECONNREFUSED' ? 'refused' : (e.code ?? 'error')),
    );
  });
}

/** True for `127.0.0.0/8` and `::1`, the only destinations a check may reach. */
export function isLoopback(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  return bare === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}
