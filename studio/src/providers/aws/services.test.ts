import { describe, expect, it } from 'vitest';

import { SERVICES } from './services';

// Requirement R3.3 of issue 45: each service's route, its label (unchanged) and its crumb, in the list's order.
const SERVICE_NAMES: [string, string, string][] = [
  ['/apigateway', 'Amazon API Gateway', 'API Gateway'],
  ['/cloudwatch', 'Amazon CloudWatch', 'CloudWatch'],
  ['/logs', 'Amazon CloudWatch Logs', 'CloudWatch Logs'],
  ['/dynamodb', 'Amazon DynamoDB', 'DynamoDB'],
  ['/ec2', 'Amazon Elastic Compute Cloud', 'EC2'],
  ['/ecr', 'Amazon Elastic Container Registry', 'ECR'],
  ['/events', 'Amazon EventBridge', 'EventBridge'],
  ['/kinesis', 'Amazon Kinesis', 'Kinesis'],
  ['/route53', 'Amazon Route 53', 'Route 53'],
  ['/sns', 'Amazon Simple Notification Service', 'SNS'],
  ['/sqs', 'Amazon Simple Queue Service', 'SQS'],
  ['/s3', 'Amazon Simple Storage Service', 'S3'],
  ['/ssm', 'Amazon Simple Systems Manager (SSM)', 'Systems Manager'],
  ['/cloudformation', 'AWS CloudFormation', 'CloudFormation'],
  ['/iam', 'AWS Identity and Access Management', 'IAM'],
  ['/kms', 'AWS Key Management Service', 'KMS'],
  ['/lambda', 'AWS Lambda', 'Lambda'],
  ['/secretsmanager', 'AWS Secrets Manager', 'Secrets Manager'],
  ['/states', 'AWS Step Functions', 'Step Functions'],
];

describe('the AWS services', () => {
  it.each(SERVICE_NAMES)('%s has the crumb name of requirement R3.3', (route, _label, crumb) => {
    expect(SERVICES.find((service) => service.route === route)?.crumb).toBe(crumb);
  });

  it('are 19, and no crumb name starts with "Amazon " or "AWS "', () => {
    expect(SERVICES).toHaveLength(19);
    expect(SERVICES.filter(({ crumb }) => /^(Amazon|AWS) /.test(crumb)).map(({ crumb }) => crumb)).toEqual([]);
  });

  it('keep the labels of main, in the same order', () => {
    expect(SERVICES.map(({ route, label }) => [route, label])).toEqual(
      SERVICE_NAMES.map(([route, label]) => [route, label]),
    );
  });
});
