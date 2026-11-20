import type { SecurityGroupRule } from './group-api';

// The words of a security group's rule, as S6's "Rules" shows them and the delete dialog names it (issue 553,
// requirement S6 and "Delete a rule"): one place, so the dialog's sentence is built from the table's words.

/** The group the emulator makes in every VPC, which cannot be deleted. */
export const DEFAULT_GROUP_NAME = 'default';

/** "Inbound" or "Outbound". */
export function directionText(rule: Pick<SecurityGroupRule, 'egress'>): string {
  return rule.egress ? 'Outbound' : 'Inbound';
}

const PROTOCOLS: Readonly<Record<string, string>> = { tcp: 'TCP', udp: 'UDP', icmp: 'ICMP', '-1': 'All' };

/** "TCP", "UDP", "ICMP", "All", or the value as the API gives it. */
export function protocolText(protocol: string): string {
  return PROTOCOLS[protocol] ?? protocol;
}

const ALL = 'All';

/**
 * The port range: for TCP and UDP one port, "first - last", or "All"; for ICMP "All", or "Type {first}, code {last}"
 * with the two values as the API gives them; "All" for any other protocol.
 */
export function portRangeText(rule: Pick<SecurityGroupRule, 'protocol' | 'fromPort' | 'toPort'>): string {
  const { protocol, fromPort, toPort } = rule;
  if (protocol === 'tcp' || protocol === 'udp') {
    if (fromPort === undefined || fromPort === -1) return ALL;
    if (toPort === undefined || toPort === fromPort) return String(fromPort);
    return `${String(fromPort)} - ${String(toPort)}`;
  }
  if (protocol === 'icmp') {
    if (fromPort === undefined || fromPort === -1) return ALL;
    return `Type ${String(fromPort)}, code ${toPort === undefined ? '-1' : String(toPort)}`;
  }
  return ALL;
}

/** The source or destination: an IPv4 or IPv6 range, or a referenced group's ID; empty without one. */
export function peerText(rule: Pick<SecurityGroupRule, 'peer'>): string {
  return rule.peer?.value ?? '';
}

/** The delete dialog's sentence: "The inbound rule TCP 22 10.0.0.0/8 is removed from web." */
export function ruleSentence(rule: SecurityGroupRule, groupName: string): string {
  const words = [protocolText(rule.protocol), portRangeText(rule), peerText(rule)].filter((word) => word !== '');
  return `The ${directionText(rule).toLowerCase()} rule ${words.join(' ')} is removed from ${groupName}.`;
}
