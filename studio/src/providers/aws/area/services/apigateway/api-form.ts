import { REST_API_NAME_LIMIT, V2_API_NAME_LIMIT } from './format';

export type CreateApiKind = 'REST' | 'HTTP';
export type RestEndpointType = 'EDGE' | 'REGIONAL' | 'PRIVATE';
export type DefaultStageChoice = 'create' | 'skip';

export interface ApiForm {
  kind: CreateApiKind | '';
  name: string;
  description: string;
  endpointType: RestEndpointType;
  defaultStage: DefaultStageChoice;
}

export const initialApiForm: Readonly<ApiForm> = {
  kind: '',
  name: '',
  description: '',
  endpointType: 'EDGE',
  defaultStage: 'create',
};

export function apiFormChanged(form: ApiForm): boolean {
  return (
    form.kind !== initialApiForm.kind ||
    form.name !== initialApiForm.name ||
    form.description !== initialApiForm.description ||
    form.endpointType !== initialApiForm.endpointType ||
    form.defaultStage !== initialApiForm.defaultStage
  );
}

export function apiNameRule(kind: CreateApiKind): string {
  const limit = kind === 'REST' ? REST_API_NAME_LIMIT : V2_API_NAME_LIMIT;
  return `1 to ${limit} characters.`;
}

export function apiNameError(name: string, kind: CreateApiKind): string | undefined {
  const limit = kind === 'REST' ? REST_API_NAME_LIMIT : V2_API_NAME_LIMIT;
  const length = Array.from(name).length;
  return length < 1 || length > limit ? apiNameRule(kind) : undefined;
}

export type NewApi = Pick<ApiForm, 'name' | 'description'> &
  ({ kind: 'REST'; endpointType: RestEndpointType } | { kind: 'HTTP'; defaultStage: DefaultStageChoice });
