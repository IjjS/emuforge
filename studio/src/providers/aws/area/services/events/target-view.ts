import type { InputTransformer, Target } from '@aws-sdk/client-eventbridge';

type TargetInput =
  | { label: 'Matched event' }
  | { label: 'Constant'; text: string }
  | { label: 'Part of the event'; path: string }
  | { label: 'Transformed'; paths: InputTransformer['InputPathsMap']; template: InputTransformer['InputTemplate'] };

function targetInput(target: Target): TargetInput {
  if (target.Input !== undefined) return { label: 'Constant', text: target.Input };
  if (target.InputPath !== undefined) return { label: 'Part of the event', path: target.InputPath };
  if (target.InputTransformer !== undefined) {
    return {
      label: 'Transformed',
      paths: target.InputTransformer.InputPathsMap,
      template: target.InputTransformer.InputTemplate,
    };
  }
  return { label: 'Matched event' };
}

export function targetView(target: Target) {
  return {
    input: targetInput(target),
    deadLetterArn: target.DeadLetterConfig?.Arn,
    retryPolicy: target.RetryPolicy,
    roleArn: target.RoleArn,
    messageGroupId: target.SqsParameters?.MessageGroupId,
  };
}
