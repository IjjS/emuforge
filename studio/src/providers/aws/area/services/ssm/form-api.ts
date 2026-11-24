import { PutParameterCommand, type PutParameterCommandInput } from '@aws-sdk/client-ssm';

import { sendRequest } from '../../../../../lib/aws/request';
import { ssmClient } from './api';

export const PUT_PARAMETER = 'PutParameter';

export function putParameter(endpoint: string, input: PutParameterCommandInput, signal: AbortSignal) {
  return sendRequest(
    PUT_PARAMETER,
    (abortSignal) => ssmClient(endpoint).send(new PutParameterCommand(input), { abortSignal }),
    signal,
  );
}
