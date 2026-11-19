import { NO_SUCH_BUCKET } from '../api';
import { useBucketProperty, type BucketProperty, type BucketPropertyValue, type BucketRead } from '../queries';

// The reads of a bucket's sections (issue 256, requirement R5.1, R5.3): each its own operation, all sent at once in
// parallel once the page has found the bucket, and again with every "Refresh". Issue 480 keeps six sections, five of
// them read.

/** Every section's read, by the part of the bucket's configuration it reads. */
export type BucketSectionReads = { [P in BucketProperty]: BucketRead<BucketPropertyValue<P>> };

/** The reads of the sections of bucket `name`, sent once `enabled`, again with each new `generation`. */
export function useBucketSections(
  endpoint: string | undefined,
  name: string,
  { generation, enabled }: { generation: number; enabled: boolean },
): BucketSectionReads {
  const options = { generation, enabled };
  return {
    versioning: useBucketProperty(endpoint, name, 'versioning', options),
    tags: useBucketProperty(endpoint, name, 'tags', options),
    encryption: useBucketProperty(endpoint, name, 'encryption', options),
    notifications: useBucketProperty(endpoint, name, 'notifications', options),
    website: useBucketProperty(endpoint, name, 'website', options),
  };
}

/** Whether a section's read answered that the emulator holds no such bucket (R5.5). */
export function anySectionMissing(reads: BucketSectionReads): boolean {
  return Object.values(reads).some((read) => read.value === NO_SUCH_BUCKET);
}
