import type { TaskDefinition } from '@aws-sdk/client-ecs';

import type { RevisionContainer } from './definition-api';
import { NONE } from './format';

// How S9 writes a revision's values (issue 575, requirement R4 "S9 A revision"): a command, the ports, `essential`
// and the revision's JSON. Every value is the emulator's, as text.

/** A container's command, its words joined by spaces; none as "-". */
export function commandText(command: readonly string[] | undefined): string {
  return command === undefined || command.length === 0 ? NONE : command.join(' ');
}

/** The port mappings as `containerPort/protocol`, in the answer's order; a mapping without a protocol is `tcp`. */
export function portsText(ports: RevisionContainer['ports']): string {
  return ports.length === 0
    ? NONE
    : ports.map((port) => `${String(port.containerPort)}/${port.protocol ?? 'tcp'}`).join(', ');
}

/** `essential` as "Yes" or "No"; an absent one is "Yes", as ECS reads it. */
export function essentialText(essential: boolean | undefined): string {
  return essential === false ? 'No' : 'Yes';
}

/** The revision as the emulator answered it, indented by two spaces; a date is ISO text (its own `toJSON`). */
export function revisionJson(answer: TaskDefinition): string {
  return JSON.stringify(answer, null, 2);
}
