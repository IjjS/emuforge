import { AWS_PATH } from '../../../identity';
import { fillPattern } from '../../screen-paths';

export const KEYS_PATH = `${AWS_PATH}/kms`;
export const KEY_PATH = `${KEYS_PATH}/keys/{keyid}`;
export const KEYS_TITLE = 'Customer managed keys';

export function keyPath(keyId: string): string {
  return fillPattern(KEY_PATH, { keyid: keyId });
}
