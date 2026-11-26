export const PARAMETER_STORE_PATH = '/aws/ssm';
export const PARAMETERS_PATH = `${PARAMETER_STORE_PATH}/parameters`;
export const PARAMETER_CREATE_PATH = `${PARAMETERS_PATH}/create`;
export const PARAMETER_DETAIL_PATH = `${PARAMETERS_PATH}/detail`;
export const PARAMETER_EDIT_PATH = `${PARAMETERS_PATH}/edit`;

function namedPath(path: string, name: string): string {
  return `${path}?${new URLSearchParams({ name }).toString()}`;
}

export function parameterPath(name: string): string {
  return namedPath(PARAMETER_DETAIL_PATH, name);
}

export function parameterEditPath(name: string): string {
  return namedPath(PARAMETER_EDIT_PATH, name);
}

export function parameterName(query: URLSearchParams): string {
  return query.get('name') ?? '';
}
