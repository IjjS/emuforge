import type { TaskDefinition } from '@aws-sdk/client-ecs';
import { describe, expect, it } from 'vitest';

import { commandText, essentialText, portsText, revisionJson } from './definition-format';

describe("a revision's values", () => {
  it('a command is its words joined by spaces; none is "-"', () => {
    expect(commandText(['sh', '-c', 'echo a; sleep 1'])).toBe('sh -c echo a; sleep 1');
    expect(commandText(undefined)).toBe('-');
    expect(commandText([])).toBe('-');
  });

  it('port mappings as containerPort/protocol, in order; one without a protocol is tcp', () => {
    expect(
      portsText([
        { containerPort: 80, protocol: 'tcp' },
        { containerPort: 53, protocol: 'udp' },
      ]),
    ).toBe('80/tcp, 53/udp');
    expect(portsText([{ containerPort: 80 }])).toBe('80/tcp');
    expect(portsText([])).toBe('-');
  });

  it("the revision's JSON is the answer's members indented by two spaces, a date as ISO text", () => {
    const answer: TaskDefinition = {
      family: 'web',
      revision: 2,
      registeredAt: new Date('2026-11-20T05:15:03.000Z'),
      containerDefinitions: [{ name: 'app', image: 'busybox' }],
    };
    const json = revisionJson(answer);
    expect(json).toBe(
      [
        '{',
        '  "family": "web",',
        '  "revision": 2,',
        '  "registeredAt": "2026-11-20T05:15:03.000Z",',
        '  "containerDefinitions": [',
        '    {',
        '      "name": "app",',
        '      "image": "busybox"',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    );
  });

  it('essential true is "Yes", false "No", absent "Yes" as ECS reads it', () => {
    expect(essentialText(true)).toBe('Yes');
    expect(essentialText(false)).toBe('No');
    expect(essentialText(undefined)).toBe('Yes');
  });
});
