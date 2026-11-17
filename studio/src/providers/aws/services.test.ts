import { describe, expect, it } from 'vitest';

import { compareLabels, readServiceFolders, serviceListFaults, type ServiceFolder } from '../../test/service-files';
import { type Service, SERVICES } from './services';

// The nineteen services of today (requirement R3.3 of issue 45; R13.5 of issue 386): each one's route, label and
// crumb. A floor, not the list: a service lost or renamed fails, a twentieth passes.
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

/** The services of the floor that `list` lacks, or holds with another label or crumb, as `route label crumb`. */
function missingFromFloor(list: readonly Service[]): string[] {
  return SERVICE_NAMES.filter(
    ([route, label, crumb]) =>
      !list.some((service) => service.route === route && service.label === label && service.crumb === crumb),
  ).map((names) => names.join(' '));
}

/** A folder that keeps every rule, named `folder`, its label and crumb made from the name. */
function good(folder: string): ServiceFolder {
  return { folder, file: { label: `Amazon ${folder}`, crumb: folder } };
}

describe('the AWS services', () => {
  it('the real list: every folder holds a service.json and has a service name; labels and crumbs are non-empty texts, no two labels are equal, no crumb starts with "Amazon " or "AWS "', () => {
    expect(serviceListFaults(readServiceFolders())).toEqual([]);
  });

  it("the real list: each entry's route is / followed by its folder's name", () => {
    const folders = readServiceFolders();
    const routes = SERVICES.map(({ label, crumb, route }) => {
      const folder = folders.find(({ file }) => {
        const entry = file as { label?: unknown; crumb?: unknown };
        return entry.label === label && entry.crumb === crumb;
      });
      return [label, route, folder === undefined ? null : `/${folder.folder}`];
    });
    expect(routes).toEqual(SERVICES.map(({ label, route }) => [label, route, route]));
  });

  it('the real list: in the order of requirement R13.2, by label, English, ignoring case', () => {
    const labels = SERVICES.map(({ label }) => label);
    expect(labels).toEqual([...labels].sort(compareLabels));
  });

  it("the real list: each of the nineteen services of today is in it with today's label, crumb and route", () => {
    expect(missingFromFloor(SERVICES)).toEqual([]);
  });

  it('the floor: a list with a twentieth passes; one that lacks or renames one of the nineteen fails', () => {
    const twentieth: Service = { label: 'Amazon Twentieth', crumb: 'Twentieth', route: '/twentieth' };
    expect(missingFromFloor([...SERVICES, twentieth])).toEqual([]);
    expect(missingFromFloor(SERVICES.filter(({ route }) => route !== '/sqs'))).toEqual([
      '/sqs Amazon Simple Queue Service SQS',
    ]);
    expect(
      missingFromFloor(
        SERVICES.map((service) => (service.route === '/kms' ? { ...service, label: 'AWS Key Service' } : service)),
      ),
    ).toEqual(['/kms AWS Key Management Service KMS']);
    expect(
      missingFromFloor(SERVICES.map((service) => (service.route === '/ec2' ? { ...service, crumb: 'EC' } : service))),
    ).toEqual(['/ec2 Amazon Elastic Compute Cloud EC2']);
  });

  it('the rules: folders that keep every rule → accepted', () => {
    expect(serviceListFaults([good('alpha'), good('beta-2')])).toEqual([]);
  });

  it.each<[string, ServiceFolder]>([
    ['a folder without service.json', { folder: 'thing', file: undefined }],
    ['a folder named Bad_Name', { folder: 'Bad_Name', file: { label: 'Amazon Bad', crumb: 'Bad' } }],
    ['an empty label', { folder: 'thing', file: { label: '', crumb: 'Thing' } }],
    ['an empty crumb', { folder: 'thing', file: { label: 'Amazon Thing', crumb: '' } }],
    ['a label equal to another folder’s', { folder: 'thing', file: { label: 'Amazon alpha', crumb: 'Thing' } }],
    ['a crumb "AWS Thing"', { folder: 'thing', file: { label: 'AWS Thing', crumb: 'AWS Thing' } }],
    ['a crumb "Amazon Thing"', { folder: 'thing', file: { label: 'Amazon Thing', crumb: 'Amazon Thing' } }],
  ])('the rules, given %s → refused, naming the folder', (_what, bad) => {
    const faults = serviceListFaults([good('alpha'), bad, good('beta')]);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatch(new RegExp(`^${bad.folder}: `));
  });
});
