import { describe, expect, it } from 'vitest';

import type { SecurityGroupRule } from './group-api';
import { directionText, peerText, portRangeText, protocolText, ruleSentence } from './group-format';

function rule(changes: Partial<SecurityGroupRule>): SecurityGroupRule {
  return { id: 'sgr-1', egress: false, protocol: 'tcp', ...changes };
}

describe("a rule's words", () => {
  it('the direction: an egress rule "Outbound", another "Inbound"', () => {
    expect(directionText(rule({ egress: true }))).toBe('Outbound');
    expect(directionText(rule({ egress: false }))).toBe('Inbound');
  });

  it('the protocol: tcp, udp, icmp, -1, and another value as the API gives it', () => {
    expect(protocolText('tcp')).toBe('TCP');
    expect(protocolText('udp')).toBe('UDP');
    expect(protocolText('icmp')).toBe('ICMP');
    expect(protocolText('-1')).toBe('All');
    expect(protocolText('47')).toBe('47');
    expect(protocolText('icmpv6')).toBe('icmpv6');
  });

  it('the port range, TCP and UDP: one port, "first - last", or "All" for -1', () => {
    for (const protocol of ['tcp', 'udp']) {
      expect(portRangeText(rule({ protocol, fromPort: 22, toPort: 22 }))).toBe('22');
      expect(portRangeText(rule({ protocol, fromPort: 8000, toPort: 8100 }))).toBe('8000 - 8100');
      expect(portRangeText(rule({ protocol, fromPort: -1, toPort: -1 }))).toBe('All');
    }
  });

  it('the port range, ICMP: -1 "All", 8 and 0 "Type 8, code 0"; any other protocol "All"', () => {
    expect(portRangeText(rule({ protocol: 'icmp', fromPort: -1, toPort: -1 }))).toBe('All');
    expect(portRangeText(rule({ protocol: 'icmp', fromPort: 8, toPort: 0 }))).toBe('Type 8, code 0');
    expect(portRangeText(rule({ protocol: '-1', fromPort: -1, toPort: -1 }))).toBe('All');
    expect(portRangeText(rule({ protocol: '47', fromPort: -1, toPort: -1 }))).toBe('All');
  });

  it("the source or destination: an IPv4 range, an IPv6 range, or a referenced group's ID", () => {
    expect(peerText(rule({ peer: { kind: 'ipv4', value: '10.0.0.0/8' } }))).toBe('10.0.0.0/8');
    expect(peerText(rule({ peer: { kind: 'ipv6', value: '::/0' } }))).toBe('::/0');
    expect(peerText(rule({ peer: { kind: 'group', value: 'sg-2' } }))).toBe('sg-2');
  });

  it('the sentence that names a rule in its delete dialog, from the same words', () => {
    expect(ruleSentence(rule({ fromPort: 22, toPort: 22, peer: { kind: 'ipv4', value: '10.0.0.0/8' } }), 'web')).toBe(
      'The inbound rule TCP 22 10.0.0.0/8 is removed from web.',
    );
    expect(
      ruleSentence(
        rule({ egress: true, protocol: 'udp', fromPort: 5000, toPort: 5010, peer: { kind: 'group', value: 'sg-2' } }),
        'api',
      ),
    ).toBe('The outbound rule UDP 5000 - 5010 sg-2 is removed from api.');
    expect(
      ruleSentence(
        rule({ protocol: 'icmp', fromPort: 8, toPort: 0, peer: { kind: 'ipv4', value: '0.0.0.0/0' } }),
        'web',
      ),
    ).toBe('The inbound rule ICMP Type 8, code 0 0.0.0.0/0 is removed from web.');
  });
});
