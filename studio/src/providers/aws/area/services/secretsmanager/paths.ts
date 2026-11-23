export const SECRETS_MANAGER_PATH = '/aws/secretsmanager';
export const SECRETS_PATH = `${SECRETS_MANAGER_PATH}/secrets`;
export const SECRET_DETAIL_PATH = `${SECRETS_PATH}/detail`;

export function secretPath(name: string): string {
  return `${SECRET_DETAIL_PATH}?name=${encodeURIComponent(name)}`;
}

export function secretName(query: URLSearchParams): string {
  return query.get('name') ?? '';
}
