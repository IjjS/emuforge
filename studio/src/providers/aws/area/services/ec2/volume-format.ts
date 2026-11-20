import { EC2_PATH } from './format';

export const VOLUMES_PATH = `${EC2_PATH}/volumes`;
export const CREATE_VOLUME_PATH = `${VOLUMES_PATH}/create`;
export const VOLUME_PATTERN = `${VOLUMES_PATH}/volume/{id}`;
export const VOLUMES_WORD = 'volumes';

export function volumeHref(id: string): string {
  return `${VOLUMES_PATH}/volume/${encodeURIComponent(id)}`;
}

export function volumeSizeText(size: number | undefined): string | undefined {
  return size === undefined ? undefined : `${String(size)} GiB`;
}
