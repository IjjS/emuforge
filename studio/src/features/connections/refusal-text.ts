// How an add the engine refused is said (requirement R4): the message for its code and the field it concerns.

import type { MessageKey } from '../../i18n/catalogue';

/** The add form's field a refusal is shown beside; `undefined` shows it under the form. */
export type AddField = 'name' | 'endpoint' | undefined;

export interface RefusalText {
  key: MessageKey;
  field: AddField;
}

const BY_CODE: Readonly<Record<string, RefusalText>> = {
  TargetExists: { key: 'connections.add.exists', field: 'name' },
  EndpointNotLoopback: { key: 'connections.add.notLoopback', field: 'endpoint' },
  TargetLimit: { key: 'connections.add.limit', field: undefined },
  ComposeHoldsOneTarget: { key: 'connections.compose', field: undefined },
};

/**
 * The text of an add refused with `code`. Any other code, `TargetInvalid` and none included, is
 * `connections.add.refused`, which shows the engine's message as text in its `{message}`.
 */
export function refusalText(code: string | undefined): RefusalText {
  const known = code === undefined || !Object.hasOwn(BY_CODE, code) ? undefined : BY_CODE[code];
  return known ?? { key: 'connections.add.refused', field: undefined };
}
