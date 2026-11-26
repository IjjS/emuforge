import { expect, it } from 'vitest';

import { V2_STAGE_NAME_RULE, v2StageNameError } from './v2-stage-form';

it.each(['$default', 'Dev-01_test'])('accepts %j as a stage name', (name) => {
  expect(v2StageNameError(name)).toBeUndefined();
});

it.each(['', 'two words', 'dev.', '$another'])('rejects %j with the stage name rule', (name) => {
  expect(v2StageNameError(name)).toBe(V2_STAGE_NAME_RULE);
});
