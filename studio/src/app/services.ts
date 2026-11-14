// The services Studio will cover (requirement 2.2): the shell's navigation, not data read from the emulator. Each
// label is the service's `serviceFullName` from the AWS CLI service model, verbatim; the list is sorted by label.
// The issue that builds a service's first screen turns its entry into that screen.

export interface Service {
  label: string;
  /** The service's route, `/<name>`; every path below it belongs to the service too. */
  route: string;
}

export const SERVICES: readonly Service[] = [
  { label: 'Amazon API Gateway', route: '/apigateway' },
  { label: 'Amazon CloudWatch', route: '/cloudwatch' },
  { label: 'Amazon CloudWatch Logs', route: '/logs' },
  { label: 'Amazon DynamoDB', route: '/dynamodb' },
  { label: 'Amazon Elastic Compute Cloud', route: '/ec2' },
  { label: 'Amazon Elastic Container Registry', route: '/ecr' },
  { label: 'Amazon EventBridge', route: '/events' },
  { label: 'Amazon Kinesis', route: '/kinesis' },
  { label: 'Amazon Route 53', route: '/route53' },
  { label: 'Amazon Simple Notification Service', route: '/sns' },
  { label: 'Amazon Simple Queue Service', route: '/sqs' },
  { label: 'Amazon Simple Storage Service', route: '/s3' },
  { label: 'Amazon Simple Systems Manager (SSM)', route: '/ssm' },
  { label: 'AWS CloudFormation', route: '/cloudformation' },
  { label: 'AWS Identity and Access Management', route: '/iam' },
  { label: 'AWS Key Management Service', route: '/kms' },
  { label: 'AWS Lambda', route: '/lambda' },
  { label: 'AWS Secrets Manager', route: '/secretsmanager' },
  { label: 'AWS Step Functions', route: '/states' },
];
