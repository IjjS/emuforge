import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'General purpose buckets',
        path: '/aws/s3/buckets',
        listedBy: 'ListBuckets',
      },
      {
        label: 'Bucket analytics configurations',
        path: '/aws/s3/bucket-analytics-configurations',
        listedBy: 'ListBucketAnalyticsConfigurations',
        listedInside: '/aws/s3/buckets',
      },
      {
        label: 'Bucket intelligent tiering configurations',
        path: '/aws/s3/bucket-intelligent-tiering-configurations',
        listedBy: 'ListBucketIntelligentTieringConfigurations',
        listedInside: '/aws/s3/buckets',
      },
      {
        label: 'Bucket inventory configurations',
        path: '/aws/s3/bucket-inventory-configurations',
        listedBy: 'ListBucketInventoryConfigurations',
        listedInside: '/aws/s3/buckets',
      },
      {
        label: 'Bucket metrics configurations',
        path: '/aws/s3/bucket-metrics-configurations',
        listedBy: 'ListBucketMetricsConfigurations',
        listedInside: '/aws/s3/buckets',
      },
      {
        label: 'Directory buckets',
        path: '/aws/s3/directory-buckets',
        listedBy: 'ListDirectoryBuckets',
      },
      {
        label: 'Multipart uploads',
        path: '/aws/s3/multipart-uploads',
        listedBy: 'ListMultipartUploads',
        listedInside: '/aws/s3/buckets',
      },
      {
        label: 'Object versions',
        path: '/aws/s3/object-versions',
        listedBy: 'ListObjectVersions',
        listedInside: '/aws/s3/buckets',
        shownIn: {
          entry: '/aws/s3/buckets',
          place: '"Show versions" in the "Objects" tab of a bucket',
        },
      },
      {
        label: 'Objects',
        path: '/aws/s3/objects',
        listedBy: 'ListObjects',
        listedInside: '/aws/s3/buckets',
        shownIn: {
          entry: '/aws/s3/buckets',
          place: 'the "Objects" tab of a bucket',
        },
      },
    ],
  },
];
