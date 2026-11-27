import { expect, it } from 'vitest';

import {
  buildTarget,
  chooseTargetKind,
  chooseTargetResource,
  emptyTarget,
  setTargetQueueArn,
  validateTarget,
} from './target-form';

const queue = { value: 'https://127.0.0.1/1/events.fifo', label: 'events.fifo', description: 'Queue URL' };
const standard = { value: 'https://127.0.0.1/1/events', label: 'events', description: 'Queue URL' };
const topic = { value: 'arn:topic', label: 'Topic', description: 'arn:topic' };
const topicDraft = { ...emptyTarget(), kind: 'sns', resource: topic, id: 'delivery_1' } as const;
const draft = chooseTargetResource(chooseTargetKind({ ...emptyTarget(), id: 'delivery_1' }, 'sqs'), queue);

it.each(['', 'a'.repeat(65), 'has space', 'ends\n'])('rejects an invalid target ID %j', (id) => {
  expect(validateTarget({ ...topicDraft, id }).id).toBeDefined();
});

it('rejects duplicate row IDs and IDs already held by the rule', () => {
  expect(validateTarget(topicDraft, { duplicate: true }).id).toBe('Use each target ID only once.');
  expect(validateTarget(topicDraft, { existingIds: ['delivery_1'] }).id).toBe(
    'The rule already holds a target with this ID.',
  );
});

it('needs a resource and waits for the chosen queue ARN', () => {
  expect(validateTarget({ ...draft, resource: undefined }).resource).toBe('Choose a target resource.');
  expect(validateTarget(draft).resource).toBe('The queue ARN must be read before saving.');
  expect(buildTarget(draft)).toBeUndefined();
});

it('accepts only the selected queue ARN and clears it when the queue or kind changes', () => {
  const withGroup = { ...draft, messageGroupId: 'orders' };
  expect(setTargetQueueArn(withGroup, standard.value, 'wrong')).toBe(withGroup);
  const ready = setTargetQueueArn(withGroup, queue.value, 'arn:queue');
  expect(validateTarget(ready)).toEqual({});
  expect(buildTarget(ready)?.Arn).toBe('arn:queue');
  expect(chooseTargetResource(ready, standard).queueArn).toBeUndefined();
  expect(chooseTargetKind(ready, 'sns')).toMatchObject({ resource: undefined, queueArn: undefined });
});

it('requires a message group ID only for a FIFO queue', () => {
  expect(validateTarget(setTargetQueueArn(draft, queue.value, 'arn:fifo')).messageGroupId).toBeDefined();
  expect(validateTarget(chooseTargetResource(draft, standard)).messageGroupId).toBeUndefined();
});

it('requires JSON for constant input and a path for partial input', () => {
  expect(validateTarget({ ...topicDraft, inputKind: 'constant', input: '{bad' }).input).toBe('Enter valid JSON.');
  expect(validateTarget({ ...topicDraft, inputKind: 'path', path: '' }).path).toBe('Enter a JSON path.');
});

it('builds only the parameters for the selected resource and input mode', () => {
  const fifo = setTargetQueueArn({ ...draft, messageGroupId: 'orders' }, queue.value, 'arn:fifo');
  expect(buildTarget(fifo)).toEqual({ Id: 'delivery_1', Arn: 'arn:fifo', SqsParameters: { MessageGroupId: 'orders' } });
  const regular = setTargetQueueArn(chooseTargetResource(fifo, standard), standard.value, 'arn:standard');
  expect(
    buildTarget({ ...regular, messageGroupId: 'unused', inputKind: 'constant', input: ' {"a": 1} ', path: '$.a' }),
  ).toEqual({ Id: 'delivery_1', Arn: 'arn:standard', Input: ' {"a": 1} ' });
  expect(buildTarget({ ...topicDraft, inputKind: 'path', path: '$.detail', input: '{}' })).toEqual({
    Id: 'delivery_1',
    Arn: 'arn:topic',
    InputPath: '$.detail',
  });
});
