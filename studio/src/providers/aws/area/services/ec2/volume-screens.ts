import type { ServiceScreen } from '../../screens';
import { VOLUMES_NAVIGATION } from './navigation';
import { CreateVolumePage } from './pages/create-volume-page';
import { VolumeListPage } from './pages/volume-list-page';
import { VolumePage } from './pages/volume-page';
import { CREATE_VOLUME_PATH, VOLUMES_PATH, VOLUME_PATTERN } from './volume-format';

const VOLUMES_CRUMB = { text: 'Volumes', href: VOLUMES_PATH };

export const VOLUME_SCREENS: readonly ServiceScreen[] = [
  {
    paths: [VOLUMES_PATH],
    title: 'Volumes',
    crumbs: [{ text: 'Volumes' }],
    navigation: VOLUMES_NAVIGATION,
    Page: VolumeListPage,
  },
  {
    paths: [CREATE_VOLUME_PATH],
    title: 'Create volume',
    crumbs: [VOLUMES_CRUMB, { text: 'Create volume' }],
    navigation: VOLUMES_NAVIGATION,
    Page: CreateVolumePage,
  },
  {
    paths: [VOLUME_PATTERN],
    title: ({ id }) => id ?? '',
    crumbs: ({ id }) => [VOLUMES_CRUMB, { text: id ?? '' }],
    navigation: VOLUMES_NAVIGATION,
    Page: VolumePage,
  },
];
