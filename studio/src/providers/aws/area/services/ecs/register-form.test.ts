import type { TaskDefinition } from '@aws-sdk/client-ecs';
import { describe, expect, it } from 'vitest';

import { documentOf, NOT_AN_OBJECT, parseDefinition, registerMembersOf, STARTER } from './register-form';

// Test criteria, "Unit s7 — services/ecs/register-form.test.ts" (issue 575).

/** Requirement R4, S10: the starter as written there, its indent of four spaces in the requirement taken off. */
const R4_STARTER = [
  '{',
  '  "family": "studio-task",',
  '  "networkMode": "awsvpc",',
  '  "requiresCompatibilities": ["FARGATE"],',
  '  "cpu": "256",',
  '  "memory": "512",',
  '  "executionRoleArn": "arn:aws:iam::000000000000:role/ecsTaskExecutionRole",',
  '  "containerDefinitions": [',
  '    {',
  '      "name": "app",',
  '      "image": "busybox",',
  '      "essential": true,',
  '      "command": ["sh", "-c", "echo hello from EmuForge Studio; sleep 3600"],',
  '      "logConfiguration": {',
  '        "logDriver": "awslogs",',
  '        "options": {',
  '          "awslogs-group": "/ecs/studio-task",',
  '          "awslogs-region": "us-east-1",',
  '          "awslogs-stream-prefix": "ecs",',
  '          "awslogs-create-group": "true"',
  '        }',
  '      }',
  '    }',
  '  ]',
  '}',
].join('\n');

/** A revision as `DescribeTaskDefinition` answers it, with every member the answer has beside the input's. */
const ANSWER: TaskDefinition = {
  taskDefinitionArn: 'arn:aws:ecs:us-east-1:000000000000:task-definition/web:3',
  containerDefinitions: [{ name: 'app', image: 'busybox', essential: true, command: ['sh', '-c', 'echo hi'] }],
  family: 'web',
  taskRoleArn: 'arn:aws:iam::000000000000:role/task',
  executionRoleArn: 'arn:aws:iam::000000000000:role/exec',
  networkMode: 'awsvpc',
  revision: 3,
  volumes: [],
  status: 'ACTIVE',
  requiresAttributes: [{ name: 'com.amazonaws.ecs.capability.logging-driver.awslogs' }],
  placementConstraints: [],
  compatibilities: ['EC2', 'FARGATE'],
  requiresCompatibilities: ['FARGATE'],
  cpu: '256',
  memory: '512',
  pidMode: 'task',
  ipcMode: 'none',
  proxyConfiguration: { containerName: 'app', type: 'APPMESH', properties: [] },
  inferenceAccelerators: [],
  ephemeralStorage: { sizeInGiB: 21 },
  runtimePlatform: { operatingSystemFamily: 'LINUX', cpuArchitecture: 'X86_64' },
  enableFaultInjection: false,
  registeredAt: new Date('2026-11-20T05:00:00Z'),
  deregisteredAt: new Date('2026-11-20T06:00:00Z'),
  registeredBy: 'arn:aws:iam::000000000000:root',
};

describe('the register form', () => {
  it('the starter → the document of R4, character for character, indented by two spaces', () => {
    expect(STARTER).toBe(R4_STARTER);
    // It is one JSON object, and two spaces are its indent.
    expect(parseDefinition(STARTER).ok).toBe(true);
    expect(STARTER.split('\n')[1]).toBe('  "family": "studio-task",');
  });

  it("a revision's answer as from → the members RegisterTaskDefinition takes, without the answer's own", () => {
    const members = registerMembersOf(ANSWER);
    expect(Object.keys(members).sort()).toEqual(
      [
        'containerDefinitions',
        'cpu',
        'enableFaultInjection',
        'ephemeralStorage',
        'executionRoleArn',
        'family',
        'inferenceAccelerators',
        'ipcMode',
        'memory',
        'networkMode',
        'pidMode',
        'placementConstraints',
        'proxyConfiguration',
        'requiresCompatibilities',
        'runtimePlatform',
        'taskRoleArn',
        'volumes',
      ].sort(),
    );
    for (const left of [
      'taskDefinitionArn',
      'revision',
      'status',
      'requiresAttributes',
      'compatibilities',
      'registeredAt',
      'registeredBy',
      'deregisteredAt',
    ]) {
      expect(members).not.toHaveProperty(left);
    }
    expect(members['containerDefinitions']).toEqual(ANSWER.containerDefinitions);

    const document = documentOf(ANSWER);
    expect(document).toBe(JSON.stringify(members, null, 2));
    expect(document.split('\n')[1]).toMatch(/^ {2}"/);
    expect(JSON.parse(document)).toEqual(members);
  });

  it('text that is not JSON, JSON that is not an object, and an object', () => {
    let parserMessage = '';
    try {
      JSON.parse('{"family": ');
    } catch (error) {
      parserMessage = (error as Error).message;
    }
    expect(parseDefinition('{"family": ')).toEqual({ ok: false, message: `This is not valid JSON: ${parserMessage}` });
    expect(parseDefinition('')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^This is not valid JSON: /),
    });

    for (const value of ['[]', '1', 'null']) {
      expect(parseDefinition(value)).toEqual({ ok: false, message: NOT_AN_OBJECT });
    }
    expect(NOT_AN_OBJECT).toBe('A task definition is a JSON object.');

    expect(parseDefinition('{}')).toEqual({ ok: true, input: {} });
    expect(parseDefinition('{"anything": [1, {"b": null}]}')).toEqual({
      ok: true,
      input: { anything: [1, { b: null }] },
    });
  });
});
