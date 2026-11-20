import { ListTaskDefinitionFamiliesCommand, ListTaskDefinitionsCommand } from '@aws-sdk/client-ecs';

import type { ChoiceSource } from '../../components/use-paged-choices';
import type { TokenPage } from '../../components/use-token-listing';
import { sendEcs, text } from './api';
import { ECS_KEY } from './queries';

// The task definition families and a family's revisions as choices of the area's choice fields (issue 575, design
// task 2): "Run task" chooses a family, then one of its active revisions, the newest first; "Update service" chooses
// a revision of the service's family. Each a page of 50 at a time on the API's own tokens, under a key of the roots
// below, which a register reads again.

/** The operations of the choices, as a failure names them. */
export const CHOICE_OPERATIONS = {
  listTaskDefinitionFamilies: 'ListTaskDefinitionFamilies',
  listTaskDefinitions: 'ListTaskDefinitions',
} as const;

/** How many choices one page asks for. */
export const CHOICES_PAGE_SIZE = 50;

/** The roots of the choices' keys: every key of these reads starts with one of them. */
export const DEFINITION_CHOICE_KEYS = {
  families: [...ECS_KEY, 'choices', 'families'] as const,
  revisions: [...ECS_KEY, 'choices', 'revisions'] as const,
};

/** A revision of a family: its `family:revision`, from its ARN. */
export interface RevisionChoice {
  /** `family:revision`, as `RunTask` and `UpdateService` take it. */
  value: string;
  family: string;
  revision: number;
}

/** The `family:revision` of a task definition's ARN (`…:task-definition/{family}:{revision}`). */
export function revisionOf(arn: string): RevisionChoice | undefined {
  const value = arn.slice(arn.lastIndexOf('/') + 1);
  const colon = value.lastIndexOf(':');
  if (colon <= 0) {
    return undefined;
  }
  const revision = Number(value.slice(colon + 1));
  if (!Number.isInteger(revision) || revision <= 0) {
    return undefined;
  }
  return { value, family: value.slice(0, colon), revision };
}

/** One page of the active families: `ListTaskDefinitionFamilies` with `status` `ACTIVE`, 50 a page. */
export async function listFamilyChoices(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<string>> {
  const output = await sendEcs(
    endpoint,
    CHOICE_OPERATIONS.listTaskDefinitionFamilies,
    (client, abortSignal) =>
      client.send(
        new ListTaskDefinitionFamiliesCommand({
          status: 'ACTIVE',
          maxResults: CHOICES_PAGE_SIZE,
          ...(token === undefined ? {} : { nextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const items = (output.families ?? []).flatMap((family) => {
    const name = text(family);
    return name === undefined ? [] : [name];
  });
  const next = text(output.nextToken);
  return next === undefined ? { items } : { items, next };
}

/**
 * One page of the active revisions of `family`, the newest first: `ListTaskDefinitions` with `familyPrefix`,
 * `status` `ACTIVE`, `sort` `DESC`, 50 a page. The prefix matches longer names too, so only the family's own are kept.
 */
export async function listRevisionChoices(
  endpoint: string,
  family: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<RevisionChoice>> {
  const output = await sendEcs(
    endpoint,
    CHOICE_OPERATIONS.listTaskDefinitions,
    (client, abortSignal) =>
      client.send(
        new ListTaskDefinitionsCommand({
          familyPrefix: family,
          status: 'ACTIVE',
          sort: 'DESC',
          maxResults: CHOICES_PAGE_SIZE,
          ...(token === undefined ? {} : { nextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const items = (output.taskDefinitionArns ?? []).flatMap((arn) => {
    const choice = typeof arn === 'string' ? revisionOf(arn) : undefined;
    return choice === undefined || choice.family !== family ? [] : [choice];
  });
  const next = text(output.nextToken);
  return next === undefined ? { items } : { items, next };
}

/** The active families: each its name. */
export function familyChoices(endpoint: string | undefined): ChoiceSource<string> {
  return {
    key: DEFINITION_CHOICE_KEYS.families,
    endpoint,
    operation: CHOICE_OPERATIONS.listTaskDefinitionFamilies,
    read: (at, _text, token, signal) => listFamilyChoices(at, token, signal),
    optionOf: (family) => ({ value: family, label: family }),
  };
}

/** The active revisions of `family`, the newest first; not ready, asking nothing, while no family is given. */
export function revisionChoices(
  endpoint: string | undefined,
  family: string | undefined,
): ChoiceSource<RevisionChoice> {
  const given = family !== undefined && family !== '';
  return {
    key: [...DEFINITION_CHOICE_KEYS.revisions, family ?? ''],
    endpoint,
    operation: CHOICE_OPERATIONS.listTaskDefinitions,
    ready: given,
    read: (at, _text, token, signal) => listRevisionChoices(at, family ?? '', token, signal),
    optionOf: (choice) => ({ value: choice.value, label: choice.value }),
  };
}
