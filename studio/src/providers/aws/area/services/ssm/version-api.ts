import {
  GetParameterCommand,
  GetParameterHistoryCommand,
  LabelParameterVersionCommand,
  UnlabelParameterVersionCommand,
  type ParameterHistory,
} from '@aws-sdk/client-ssm';

import { sendRequest } from '../../../../../lib/aws/request';
import { ssmClient } from './api';

export const GET_PARAMETER = 'GetParameter';
export const GET_PARAMETER_HISTORY = 'GetParameterHistory';
export const LABEL_PARAMETER_VERSION = 'LabelParameterVersion';
export const UNLABEL_PARAMETER_VERSION = 'UnlabelParameterVersion';

export type HistoryVersion = Pick<ParameterHistory, 'LastModifiedDate' | 'Labels' | 'Type'> & {
  Version: number;
};

export async function getParameterValue(endpoint: string, name: string, secure: boolean, signal: AbortSignal) {
  const { Parameter } = await sendRequest(
    GET_PARAMETER,
    (abortSignal) =>
      ssmClient(endpoint).send(new GetParameterCommand({ Name: name, WithDecryption: secure }), { abortSignal }),
    signal,
  );
  return Parameter?.Value;
}

export async function getParameterHistory(
  endpoint: string,
  name: string,
  token: string | undefined,
  signal: AbortSignal,
) {
  const { Parameters, NextToken } = await sendRequest(
    GET_PARAMETER_HISTORY,
    (abortSignal) =>
      ssmClient(endpoint).send(
        new GetParameterHistoryCommand({ Name: name, WithDecryption: false, MaxResults: 50, NextToken: token }),
        { abortSignal },
      ),
    signal,
  );
  // Only metadata leaves this function. History values must not enter the query cache.
  const items: HistoryVersion[] = (Parameters ?? []).flatMap(({ Version, LastModifiedDate, Labels, Type }) =>
    Version === undefined ? [] : [{ Version, LastModifiedDate, Labels, Type }],
  );
  return { items, ...(NextToken ? { next: NextToken } : {}) };
}

export async function addVersionLabels(
  endpoint: string,
  Name: string,
  ParameterVersion: number,
  Labels: string[],
  signal: AbortSignal,
) {
  const { InvalidLabels = [], ParameterVersion: updatedVersion } = await sendRequest(
    LABEL_PARAMETER_VERSION,
    (abortSignal) =>
      ssmClient(endpoint).send(new LabelParameterVersionCommand({ Name, ParameterVersion, Labels }), { abortSignal }),
    signal,
  );
  return {
    applied: Labels.filter((label) => !InvalidLabels.includes(label)),
    rejected: InvalidLabels,
    version: updatedVersion ?? ParameterVersion,
  };
}

export async function removeVersionLabels(
  endpoint: string,
  Name: string,
  ParameterVersion: number,
  Labels: string[],
  signal: AbortSignal,
) {
  const { InvalidLabels = [], RemovedLabels = [] } = await sendRequest(
    UNLABEL_PARAMETER_VERSION,
    (abortSignal) =>
      ssmClient(endpoint).send(new UnlabelParameterVersionCommand({ Name, ParameterVersion, Labels }), { abortSignal }),
    signal,
  );
  return { applied: RemovedLabels, rejected: InvalidLabels, version: ParameterVersion };
}
