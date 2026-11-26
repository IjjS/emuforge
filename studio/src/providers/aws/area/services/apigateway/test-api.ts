import { TestInvokeMethodCommand, type TestInvokeMethodCommandInput } from '@aws-sdk/client-api-gateway';

import { sendRest } from './clients';

export const TEST_INVOKE_METHOD = 'TestInvokeMethod';

export type TestMethodInput = Pick<TestInvokeMethodCommandInput, 'pathWithQueryString' | 'headers' | 'body'> & {
  restApiId: string;
  resourceId: string;
  httpMethod: string;
};

export function testInvokeMethod(endpoint: string, input: TestMethodInput, signal: AbortSignal) {
  return sendRest(
    endpoint,
    TEST_INVOKE_METHOD,
    (client, abortSignal) => client.send(new TestInvokeMethodCommand(input), { abortSignal }),
    signal,
  );
}
