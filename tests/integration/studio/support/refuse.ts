// The destination rule of the check contract's browser context, kept without request interception (issue 15).
//
// The context's proxy is a loopback listener the check owns, and its bypass list names exactly the loopback
// addresses `isLoopback` (`net.ts`) accepts: `127.0.0.0/8` and `[::1]` go direct, unchanged; everything else, host
// names such as `localhost` or `*.invalid` included, is handed to the listener, which reads the request line, logs
// the refusal and closes the connection before answering. The page sees the request fail; nothing leaves the
// machine, and no name is looked up (the browser hands the name to the proxy). Because no route is installed, a CORS
// preflight goes to its server and the page sees that server's answer.

import net from 'node:net';

import { EnvError } from './check';

/** Chromium's bypass list: drop its implicit loopback bypass, then let exactly `127.0.0.0/8` and `[::1]` go direct. */
export const LOOPBACK_BYPASS = '<-loopback>,127.0.0.1/8,[::1]';

/** The longest request line read before a connection is closed without one. */
const MAX_LINE = 8 * 1024;

/** How long a connection that sends no request line (a speculative preconnect) is kept. */
const IDLE_MS = 10_000;

export interface RefusingProxy {
  /** `http://127.0.0.1:<port>`, the proxy server of the context. */
  server: string;
  /** Closes every connection and the listener. */
  dispose(): Promise<void>;
}

/**
 * The origin of the URL the page requested, from the request line the proxy received: the absolute URL of a plain
 * HTTP request (`GET http://192.0.2.1/x HTTP/1.1` → `http://192.0.2.1`), or `https://<host>[:<port>]` for a tunnel,
 * which names only its destination (`CONNECT 192.0.2.1:443 HTTP/1.1` → `https://192.0.2.1`). `null` when the line
 * is not a request line.
 */
export function requestedOrigin(line: string): string | null {
  const match = /^([A-Z]+) (\S+) HTTP\/\d(?:\.\d)?$/.exec(line);
  if (!match) return null;
  const [, method, target] = match;
  if (method === 'CONNECT') {
    const tunnel = /^(\[[^\]]+\]|[^:[\]]+):(\d+)$/.exec(target);
    if (!tunnel) return null;
    const [, host, port] = tunnel;
    return port === '443' ? `https://${host}` : `https://${host}:${port}`;
  }
  try {
    return new URL(target).origin;
  } catch {
    return null;
  }
}

/** Starts the refusing proxy on a free `127.0.0.1` port; `log` receives one line per refused request. */
export async function startRefusingProxy(log: (line: string) => void): Promise<RefusingProxy> {
  const sockets = new Set<net.Socket>();
  const listener = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.setTimeout(IDLE_MS, () => socket.destroy());
    let head = '';
    const onData = (chunk: Buffer) => {
      head += chunk.toString('latin1');
      const end = head.indexOf('\r\n');
      if (end < 0 && head.length < MAX_LINE) return;
      socket.off('data', onData);
      const line = end < 0 ? head.slice(0, MAX_LINE) : head.slice(0, end);
      const origin = requestedOrigin(line);
      log(
        origin === null
          ? `refused browser connection with no request line (${JSON.stringify(line.slice(0, 200))}): checks reach only loopback addresses`
          : `refused browser request to ${origin}: checks reach only loopback addresses`,
      );
      socket.destroy();
    };
    socket.on('data', onData);
  });

  const port = await new Promise<number>((resolve, reject) => {
    listener.once('error', (e) => reject(new EnvError(`the refusing proxy cannot listen on 127.0.0.1: ${e.message}`)));
    listener.listen(0, '127.0.0.1', () => resolve((listener.address() as net.AddressInfo).port));
  });

  return {
    server: `http://127.0.0.1:${String(port)}`,
    async dispose() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    },
  };
}
