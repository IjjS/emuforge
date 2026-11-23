import { AWS_PATH } from '../../identity';

export const KEYS_PATH = `${AWS_PATH}/kms`;
export const KEY_PATH = `${KEYS_PATH}/keys/:keyId`;
export const KEYS_TITLE = 'Customer managed keys';

export function keyPath(keyId: string): string {
  return `${KEYS_PATH}/keys/${encodeURIComponent(keyId)}`;
}
