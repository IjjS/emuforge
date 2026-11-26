import type { ChoiceSource } from '../../components/use-paged-choices';
import { GET_APIS, GET_REST_APIS, readRestApis, readV2Apis, type ApiRow } from './apis-api';
import type { ApiModel } from './format';

export function apiChoices(endpoint: string | undefined, model: ApiModel): ChoiceSource<ApiRow> {
  const rest = model === 'rest';
  const read = rest ? readRestApis : readV2Apis;

  return {
    key: ['apigateway', 'api-choices', model],
    endpoint,
    operation: rest ? GET_REST_APIS : GET_APIS,
    filtering: 'local',
    read: (at, _text, token, signal) => read(at, token, signal),
    optionOf: (api) => ({
      value: api.id,
      label: api.name,
      description: rest ? api.id : `${api.id} · ${api.kind}`,
    }),
  };
}
