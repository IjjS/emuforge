// Studio's own server: `bun run serve` in `studio/`, after `bun run build`. It serves `dist/` on 127.0.0.1 only,
// falls back to `index.html` for any page path so deep links and refresh work, and answers `GET /config.json` with
// the engine port the page talks to. It exits non-zero, naming the port, when that port is taken.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ServeConfigError, serveConfig, type ServeConfig } from '../src/app/serve-config.ts';

const DIST = path.resolve(import.meta.dirname, '..', 'dist');
const INDEX = path.join(DIST, 'index.html');

// Vite puts every built asset here, each with a hashed name; a missing one is a 404, never the page.
const ASSETS_PREFIX = '/assets/';
const ASSETS_DIR = path.join(DIST, 'assets') + path.sep;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function fail(message: string): never {
  process.stderr.write(`studio serve: ${message}\n`);
  process.exit(1);
}

function send(
  response: ServerResponse,
  status: number,
  headers: Readonly<Record<string, string>>,
  body: string | Buffer,
  head: boolean,
) {
  response.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Length': String(Buffer.byteLength(body)),
    ...headers,
  });
  response.end(head ? undefined : body);
}

function sendText(response: ServerResponse, status: number, text: string, head: boolean, extra = {}) {
  send(response, status, { 'Content-Type': 'text/plain; charset=utf-8', ...extra }, `${text}\n`, head);
}

/** The file under `dist/` a request path names, or `null` when it names none (or leaves `dist/`). */
async function builtFile(pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.resolve(DIST, `.${decoded}`);
  if (!file.startsWith(`${DIST}${path.sep}`)) {
    return null;
  }
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function sendFile(response: ServerResponse, file: string, head: boolean) {
  const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
  // Vite's hashed assets never change. Every other file keeps its path from build to build, the page and the icons
  // of `public/` that a browser asks for by name, so it is revalidated and a new build or a changed icon is picked up.
  const cache = file.startsWith(ASSETS_DIR) ? 'public, max-age=31536000, immutable' : 'no-cache';
  send(response, 200, { 'Content-Type': type, 'Cache-Control': cache }, await readFile(file), head);
}

async function handle(config: ServeConfig, request: IncomingMessage, response: ServerResponse) {
  const origin = `http://${config.listenAddress}:${String(config.studioPort)}`;
  const head = request.method === 'HEAD';
  if (request.method !== 'GET' && !head) {
    sendText(response, 405, 'Method not allowed.', false, { Allow: 'GET, HEAD' });
    return;
  }
  // The engine accepts only this origin (`--studio-port`); a page opened under another name could not reach it.
  if (request.headers.host !== `${config.listenAddress}:${String(config.studioPort)}`) {
    sendText(response, 421, `Open Studio at ${origin}/.`, head);
    return;
  }
  const pathname = new URL(request.url ?? '/', origin).pathname;
  if (pathname === '/config.json') {
    const body = JSON.stringify({ enginePort: config.enginePort });
    send(response, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body, head);
    return;
  }
  const file = await builtFile(pathname);
  if (file !== null) {
    await sendFile(response, file, head);
    return;
  }
  if (pathname.startsWith(ASSETS_PREFIX)) {
    sendText(response, 404, 'Not found.', head);
    return;
  }
  // Every other path is a page of the app; the router in the page decides what it shows.
  await sendFile(response, INDEX, head);
}

async function main() {
  let config: ServeConfig;
  try {
    config = serveConfig(process.env);
  } catch (error) {
    if (error instanceof ServeConfigError) {
      fail(error.message);
    }
    throw error;
  }
  try {
    await stat(INDEX);
  } catch {
    fail(`no built Studio at ${INDEX}; run \`bun run build\` first.`);
  }

  const server = createServer((request, response) => {
    handle(config, request, response).catch((error: unknown) => {
      process.stderr.write(`studio serve: ${request.method ?? ''} ${request.url ?? ''} failed: ${String(error)}\n`);
      if (!response.headersSent) {
        sendText(response, 500, 'Studio could not read its built files.', false);
      } else {
        response.destroy();
      }
    });
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      fail(`port ${String(config.studioPort)} on ${config.listenAddress} is already in use (EMUFORGE_STUDIO_PORT).`);
    }
    fail(`cannot listen on ${config.listenAddress}:${String(config.studioPort)}: ${error.message}`);
  });
  server.listen({ host: config.listenAddress, port: config.studioPort, exclusive: true }, () => {
    process.stdout.write(
      `Studio on http://${config.listenAddress}:${String(config.studioPort)}/ (engine port ${String(config.enginePort)})\n`,
    );
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close();
      process.exit(0);
    });
  }
}

await main();
