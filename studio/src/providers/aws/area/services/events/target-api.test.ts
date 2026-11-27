import { EventBridgeClient, PutTargetsCommand } from '@aws-sdk/client-eventbridge';
import { expect, it, vi } from 'vitest';

import { putRuleTargets } from './target-api';

it('puts the built targets and reports a failed entry with the operation, code and reason', async () => {
  const entry = { TargetId: 'delivery', ErrorCode: 'Refused', ErrorMessage: 'Target refused' };
  const send = vi
    .spyOn(EventBridgeClient.prototype, 'send')
    .mockResolvedValueOnce({ FailedEntryCount: 0 } as never)
    .mockResolvedValueOnce({ FailedEntryCount: 1, FailedEntries: [entry] } as never);
  const targets = [{ Id: 'delivery', Arn: 'arn:target', InputPath: '$.detail' }];
  const put = () => putRuleTargets('http://127.0.0.1:8327', 'orders', 'route', targets, new AbortController().signal);
  await expect(put()).resolves.toBeUndefined();
  await expect(put()).rejects.toMatchObject({
    failure: { operation: 'PutTargets', code: 'Refused', message: 'Target refused' },
    entries: [entry],
  });
  expect(send).toHaveBeenCalledTimes(2);
  for (const [command] of send.mock.calls) {
    expect(command).toBeInstanceOf(PutTargetsCommand);
    expect(command).toMatchObject({ input: { EventBusName: 'orders', Rule: 'route', Targets: targets } });
  }
  send.mockRestore();
});
