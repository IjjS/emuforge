import type { RegisterTaskDefinitionCommandInput, TaskDefinition } from '@aws-sdk/client-ecs';

// What S10, "Register task definition", starts with and checks before it sends `RegisterTaskDefinition` (issue 575,
// requirement S10; design task 4): Studio's starter, the members of a revision that `RegisterTaskDefinition` takes
// (for `from`), and the two checks of the text: it is JSON, and the JSON is an object. Every other rule is the
// emulator's, shown as its refusal.

/**
 * Studio's starter, R4's document as written there, indented by two spaces. It is text a developer edits; nothing else
 * of the area reads the account or the Region from it.
 */
export const STARTER = `{
  "family": "studio-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::000000000000:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "app",
      "image": "busybox",
      "essential": true,
      "command": ["sh", "-c", "echo hello from EmuForge Studio; sleep 3600"],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/studio-task",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs",
          "awslogs-create-group": "true"
        }
      }
    }
  ]
}`;

export const NOT_AN_OBJECT = 'A task definition is a JSON object.';

/** The message of text that is not JSON. */
export function notJsonMessage(parserMessage: string): string {
  return `This is not valid JSON: ${parserMessage}`;
}

/**
 * The members `RegisterTaskDefinition` takes (the SDK's `RegisterTaskDefinitionRequest`); every other member of a
 * described revision (`taskDefinitionArn`, `revision`, `status`, `requiresAttributes`, `compatibilities`,
 * `registeredAt`, `registeredBy`, `deregisteredAt`, …) is left out of `from`'s document.
 */
const REGISTER_MEMBERS: ReadonlySet<string> = new Set<keyof RegisterTaskDefinitionCommandInput>([
  'family',
  'taskRoleArn',
  'executionRoleArn',
  'networkMode',
  'containerDefinitions',
  'volumes',
  'placementConstraints',
  'requiresCompatibilities',
  'cpu',
  'memory',
  'tags',
  'pidMode',
  'ipcMode',
  'proxyConfiguration',
  'inferenceAccelerators',
  'ephemeralStorage',
  'runtimePlatform',
  'enableFaultInjection',
]);

/** The members of the described revision `answer` that `RegisterTaskDefinition` takes, in the answer's order. */
export function registerMembersOf(answer: TaskDefinition): Record<string, unknown> {
  const members: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(answer)) {
    if (REGISTER_MEMBERS.has(name) && value !== undefined) {
      members[name] = value;
    }
  }
  return members;
}

/** The field's text for `from`: the members of `answer` that `RegisterTaskDefinition` takes, indented by two spaces. */
export function documentOf(answer: TaskDefinition): string {
  return JSON.stringify(registerMembersOf(answer), null, 2);
}

/** The text as `RegisterTaskDefinition`'s input, or the message of why it is not one. */
export type ParsedDefinition = { ok: true; input: Record<string, unknown> } | { ok: false; message: string };

/** Checks `text`: JSON, and a JSON object; an object is accepted whatever its members. */
export function parseDefinition(text: string): ParsedDefinition {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: notJsonMessage(error instanceof Error ? error.message : String(error)) };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: NOT_AN_OBJECT };
  }
  return { ok: true, input: value as Record<string, unknown> };
}
