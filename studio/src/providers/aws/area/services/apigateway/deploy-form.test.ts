import { expect, it } from 'vitest';

import { checkDeployStage, STAGE_NAME_RULE } from './deploy-form';

it('accepts letters, digits, and underscores for a new stage', () => {
  expect(checkDeployStage('new', undefined, 'Dev_2')).toEqual({ stageName: 'Dev_2' });
});

it.each(['', 'dev-test', 'dev test'])('rejects the invalid name %j with the rule', (name) => {
  expect(checkDeployStage('new', undefined, name)).toEqual({ error: STAGE_NAME_RULE });
});

it('uses the selected stage without asking for a new name', () => {
  expect(checkDeployStage('existing', 'dev', '')).toEqual({ stageName: 'dev' });
  expect(checkDeployStage('existing', undefined, 'Dev_2')).toEqual({ error: 'Choose an existing stage.' });
});
