// The AWS services Studio will cover: the AWS area's navigation and Home's list, not data read from the emulator. Each
// label is the service's `serviceFullName` from the AWS CLI service model, verbatim; the list is sorted by label.
// The issue that builds a service's first screen turns its entry into that screen.

export interface Service {
  label: string;
  /**
   * The service's crumb in the area's breadcrumbs, its short name: the label without a leading "Amazon " or "AWS ",
   * the acronym where the route abbreviates the name (`S3`, `EC2`, `IAM`), "Systems Manager" for `ssm`.
   */
  crumb: string;
  /** The service's route inside the AWS area, `/<name>`; every path below it belongs to the service too. */
  route: string;
}

export const SERVICES: readonly Service[] = [
  { label: 'Amazon API Gateway', crumb: 'API Gateway', route: '/apigateway' },
  { label: 'Amazon CloudWatch', crumb: 'CloudWatch', route: '/cloudwatch' },
  { label: 'Amazon CloudWatch Logs', crumb: 'CloudWatch Logs', route: '/logs' },
  { label: 'Amazon DynamoDB', crumb: 'DynamoDB', route: '/dynamodb' },
  { label: 'Amazon Elastic Compute Cloud', crumb: 'EC2', route: '/ec2' },
  { label: 'Amazon Elastic Container Registry', crumb: 'ECR', route: '/ecr' },
  { label: 'Amazon EventBridge', crumb: 'EventBridge', route: '/events' },
  { label: 'Amazon Kinesis', crumb: 'Kinesis', route: '/kinesis' },
  { label: 'Amazon Route 53', crumb: 'Route 53', route: '/route53' },
  { label: 'Amazon Simple Notification Service', crumb: 'SNS', route: '/sns' },
  { label: 'Amazon Simple Queue Service', crumb: 'SQS', route: '/sqs' },
  { label: 'Amazon Simple Storage Service', crumb: 'S3', route: '/s3' },
  { label: 'Amazon Simple Systems Manager (SSM)', crumb: 'Systems Manager', route: '/ssm' },
  { label: 'AWS CloudFormation', crumb: 'CloudFormation', route: '/cloudformation' },
  { label: 'AWS Identity and Access Management', crumb: 'IAM', route: '/iam' },
  { label: 'AWS Key Management Service', crumb: 'KMS', route: '/kms' },
  { label: 'AWS Lambda', crumb: 'Lambda', route: '/lambda' },
  { label: 'AWS Secrets Manager', crumb: 'Secrets Manager', route: '/secretsmanager' },
  { label: 'AWS Step Functions', crumb: 'Step Functions', route: '/states' },
];
