const NO_IOPS_OR_THROUGHPUT = 'IOPS and throughput cannot be set.';
const REQUIRED_IOPS = 'IOPS must be set.';

const TYPES = {
  standard: { size: [1, 1024], description: NO_IOPS_OR_THROUGHPUT },
  gp2: { size: [1, 16384], description: NO_IOPS_OR_THROUGHPUT },
  gp3: {
    size: [1, 65536],
    iops: { range: [3000, 80000], required: false },
    throughput: [125, 2000],
    description: '3000 IOPS and 125 MiB/s unless you set them.',
  },
  io1: {
    size: [4, 16384],
    iops: { range: [100, 64000], required: true },
    description: REQUIRED_IOPS,
  },
  io2: {
    size: [4, 65536],
    iops: { range: [100, 256000], required: true },
    description: REQUIRED_IOPS,
  },
  st1: { size: [125, 16384], description: NO_IOPS_OR_THROUGHPUT },
  sc1: { size: [125, 16384], description: NO_IOPS_OR_THROUGHPUT },
} as const;

export type VolumeType = keyof typeof TYPES;
type Range = readonly [number, number];

interface VolumeRules {
  size: Range;
  iops?: { range: Range; required: boolean };
  throughput?: Range;
  description: string;
}

export function volumeRules(type: VolumeType): VolumeRules {
  return TYPES[type];
}

export const VOLUME_TYPE_OPTIONS = (Object.keys(TYPES) as VolumeType[]).map((type) => ({
  value: type,
  label: type,
  description: `${rangeText(TYPES[type].size)} GiB. ${TYPES[type].description}`,
}));

interface VolumeSettings {
  type: VolumeType;
  size: string;
  iops: string;
  throughput: string;
}

export const DEFAULT_VOLUME_SETTINGS: VolumeSettings = { type: 'gp2', size: '', iops: '', throughput: '' };

export function changeVolumeType(settings: VolumeSettings, type: VolumeType): VolumeSettings {
  const rules = volumeRules(type);
  return {
    ...settings,
    type,
    iops: rules.iops === undefined ? '' : settings.iops,
    throughput: rules.throughput === undefined ? '' : settings.throughput,
  };
}

export function rangeText([min, max]: Range): string {
  return `${min} to ${max}`;
}

function inRange(value: string, [min, max]: Range): boolean {
  return /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
}

export function sizeConstraint(type: VolumeType, snapshotSize: number | undefined): string {
  const [min, max] = volumeRules(type).size;
  if (snapshotSize !== undefined && snapshotSize < min) {
    return `The snapshot's ${snapshotSize} GiB is under ${type}'s minimum: enter a size.`;
  }
  if (snapshotSize !== undefined && snapshotSize <= max) {
    return `Leave empty to use the snapshot's ${snapshotSize} GiB.`;
  }
  return `Enter a whole number from ${min} to ${max}.`;
}

export function checkVolumeSettings(settings: VolumeSettings, snapshotSize: number | undefined) {
  const { type } = settings;
  const rules = volumeRules(type);
  const [min, max] = rules.size;
  const size = settings.size.trim();
  const iops = settings.iops.trim();
  const throughput = settings.throughput.trim();
  const errors: Partial<Record<keyof VolumeSettings, string>> = {};

  if (snapshotSize !== undefined && snapshotSize > max) {
    errors.type = `The snapshot's ${snapshotSize} GiB is over ${type}'s maximum: choose another volume type.`;
  } else if (size === '') {
    if (snapshotSize === undefined) errors.size = 'Enter a size.';
    else if (snapshotSize < min) errors.size = sizeConstraint(type, snapshotSize);
  } else if (!inRange(size, rules.size)) {
    errors.size = `Enter a whole number from ${min} to ${max} for ${type}.`;
  } else if (snapshotSize !== undefined && Number(size) < snapshotSize) {
    errors.size = `Enter at least ${snapshotSize} GiB, the size of the snapshot.`;
  }
  if (rules.iops !== undefined) {
    if (iops === '' && rules.iops.required) errors.iops = 'Enter the IOPS.';
    else if (iops !== '' && !inRange(iops, rules.iops.range)) {
      errors.iops = `The IOPS are a whole number from ${rangeText(rules.iops.range)}.`;
    }
  }
  if (rules.throughput !== undefined && throughput !== '' && !inRange(throughput, rules.throughput)) {
    errors.throughput = `The throughput is a whole number from ${rangeText(rules.throughput)}.`;
  }

  return {
    errors,
    values: {
      type,
      size: size === '' ? undefined : Number(size),
      iops: rules.iops === undefined || iops === '' ? undefined : Number(iops),
      throughput: rules.throughput === undefined || throughput === '' ? undefined : Number(throughput),
    },
  };
}
