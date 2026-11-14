// Who listens on a port, and what a plain HTTP client gets from Studio's server. Used by the Studio server check
// (`serve.spec.ts`); both reach only loopback.

import { execFile } from 'node:child_process';
import http from 'node:http';

import { EnvError } from './check';

/**
 * The local addresses of every TCP socket listening on `port`, as `lsof` names them (`127.0.0.1:8296`,
 * `[::1]:8296`, `*:8296`). Read-only; nothing is connected to. `EnvError` when `lsof` cannot run.
 */
export async function listeningAddresses(port: number): Promise<string[]> {
  const out = await new Promise<string>((resolve, reject) => {
    execFile('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' }, (error, stdout) => {
      // `lsof` exits 1 when nothing matches; that is an answer, not a failure.
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') reject(new EnvError('lsof is not installed'));
      else resolve(stdout);
    });
  });
  const names = out
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1));
  return [...new Set(names)].sort();
}

export interface Answer {
  status: number;
  type: string;
  body: string;
}

/** `GET http://127.0.0.1:<port><path>` with no proxy and no keep-alive. */
export async function get(port: number, path: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path, agent: false, timeout: 5_000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, type: String(response.headers['content-type'] ?? ''), body }),
      );
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error(`no answer from 127.0.0.1:${String(port)} within 5 s`)));
    request.on('error', reject);
  });
}
