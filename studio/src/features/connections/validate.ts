// The five rules Studio checks before it sends an add (requirement R4), from the engine's limits. Every other rule of
// the engine (user info, a query or fragment, a path, a port outside 1–65535, a host that is not a loopback IP, the
// engine's or Studio's own port, the limit of 32) is the engine's to judge: what passes here is sent.

import type { MessageKey } from '../../i18n/catalogue';

/** 1 to 64 of `a-z 0-9 - _`, starting with a letter or a digit. */
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const SCHEME = 'https://';

/** What is wrong with a connection's name, or `undefined` when it passes. */
export function nameProblem(name: string): MessageKey | undefined {
  if (name === '') {
    return 'connections.add.nameEmpty';
  }
  return NAME.test(name) ? undefined : 'connections.add.nameRule';
}

/** Whether the authority of an endpoint (what lies between `https://` and its path) ends in `:<port>`. */
function hasPort(authority: string): boolean {
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    return close !== -1 && /^:\d+$/.test(host.slice(close + 1));
  }
  return /:\d+$/.test(host);
}

/** What is wrong with a connection's endpoint, or `undefined` when it passes. */
export function endpointProblem(endpoint: string): MessageKey | undefined {
  if (endpoint === '') {
    return 'connections.add.endpointEmpty';
  }
  if (!endpoint.startsWith(SCHEME)) {
    return 'connections.add.endpointScheme';
  }
  const rest = endpoint.slice(SCHEME.length);
  const authority = rest.split(/[/?#]/, 1)[0] ?? '';
  return hasPort(authority) ? undefined : 'connections.add.endpointPort';
}
