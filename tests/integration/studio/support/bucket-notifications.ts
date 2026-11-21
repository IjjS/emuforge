// Direct local fixtures shared by the S3 rule checks and the cross-service delivery flows.
import { Agent } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketNotificationConfigurationCommand,
  PutBucketNotificationConfigurationCommand,
  ListBucketsCommand,
  type NotificationConfiguration,
} from '@aws-sdk/client-s3';
import { strToU8, zipSync } from 'fflate';
import { expect, type Ctx } from './check';
import { emulatorDir, readEmulatorFiles } from './emulator';
import {
  createdTopicArn,
  directIam,
  directLambda,
  directLogs,
  directSns,
  directSqs,
  type DirectAnswer,
} from './aws-clients-general';
import { checkPrefix } from './service-screens';

function checked(answer: DirectAnswer, operation: string, missing?: string) {
  if ('error' in answer) throw Error(operation + ': ' + answer.error);
  if (answer.status >= 200 && answer.status < 300) return answer.body;
  if (missing && answer.body.includes(missing)) return '';
  throw Error(operation + ': ' + answer.status + ' ' + answer.body);
}

export class LocalNotifications {
  readonly bucket: string;
  readonly s3: S3Client;
  constructor(
    readonly ctx: Ctx,
    readonly port: number,
    tag: string,
    private readonly ownedEmulator = false,
  ) {
    this.bucket = checkPrefix(ctx, tag);
    const dir = emulatorDir(ctx.home, port);
    const keys = readEmulatorFiles(dir);
    if (!keys) throw Error('Missing local emulator credentials');
    this.s3 = new S3Client({
      endpoint: 'https://127.0.0.1:' + port,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: keys.accessKeyId, secretAccessKey: keys.secretAccessKey },
      requestHandler: new NodeHttpHandler({ httpsAgent: new Agent({ ca: readFileSync(join(dir, 'ca.pem')) }) }),
    });
    ctx.own({ dispose: async () => this.s3.destroy() });
  }

  async createBucket() {
    await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    // A private stack disposes its whole emulator, including its old credentials after a restart.
    if (this.ownedEmulator) return;
    this.ctx.own({
      dispose: async () => {
        if (await this.exists()) await this.s3.send(new DeleteBucketCommand({ Bucket: this.bucket }));
      },
    });
  }

  async exists() {
    const { Buckets } = await this.s3.send(new ListBucketsCommand({}));
    return Buckets?.some((b) => b.Name === this.bucket) ?? false;
  }

  async read(): Promise<NotificationConfiguration> {
    const { $metadata, ...settings } = await this.s3.send(
      new GetBucketNotificationConfigurationCommand({ Bucket: this.bucket }),
    );
    return settings;
  }

  async seed(settings: NotificationConfiguration) {
    await this.s3.send(
      new PutBucketNotificationConfigurationCommand({ Bucket: this.bucket, NotificationConfiguration: settings }),
    );
  }

  trackObject(key: string) {
    this.ctx.own({
      dispose: async () => {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      },
    });
  }

  async body(key: string) {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return object.Body?.transformToString();
  }

  policy(action: string, resource: string) {
    return JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 's3.amazonaws.com' },
          Action: action,
          Resource: resource,
          Condition: { ArnEquals: { 'aws:SourceArn': 'arn:aws:s3:::' + this.bucket } },
        },
      ],
    });
  }

  async queue(allow: boolean) {
    const call = async (op: string, input: object) => checked(await directSqs(this.ctx, this.port, op, input), op);
    const { QueueUrl } = JSON.parse(await call('CreateQueue', { QueueName: this.bucket + '-q' }));
    if (!this.ownedEmulator)
      this.ctx.own({
        dispose: async () => {
          checked(await directSqs(this.ctx, this.port, 'DeleteQueue', { QueueUrl }), 'DeleteQueue', 'NonExistentQueue');
        },
      });
    const { Attributes } = JSON.parse(await call('GetQueueAttributes', { QueueUrl, AttributeNames: ['QueueArn'] }));
    const arn: string = Attributes.QueueArn;
    if (allow)
      await call('SetQueueAttributes', { QueueUrl, Attributes: { Policy: this.policy('sqs:SendMessage', arn) } });
    return arn;
  }

  async topic() {
    const call = async (op: string, input: Record<string, string>) =>
      checked(await directSns(this.ctx, this.port, op, input), op);
    const TopicArn = createdTopicArn(await call('CreateTopic', { Name: this.bucket + '-topic' }));
    this.ctx.own({
      dispose: async () => {
        await call('DeleteTopic', { TopicArn });
      },
    });
    await call('SetTopicAttributes', {
      TopicArn,
      AttributeName: 'Policy',
      AttributeValue: this.policy('sns:Publish', TopicArn),
    });
    return TopicArn;
  }

  async functionDestination() {
    const RoleName = this.bucket + '-role';
    const PolicyArn = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';
    const iam = async (op: string, input: Record<string, string>) =>
      checked(await directIam(this.ctx, this.port, op, input), op);
    const role = await iam('CreateRole', {
      RoleName,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      }),
    });
    this.ctx.own({
      dispose: async () => {
        await iam('DeleteRole', { RoleName });
      },
    });
    await iam('AttachRolePolicy', { RoleName, PolicyArn });
    this.ctx.own({
      dispose: async () => {
        await iam('DetachRolePolicy', { RoleName, PolicyArn });
      },
    });
    const name = this.bucket + '-fn';
    const base = '/2015-03-31/functions';
    const func = async (method: string, path: string, input?: object) =>
      checked(await directLambda(this.ctx, this.port, method, path, {}, input), method + ' ' + path);
    const code = zipSync({
      'index.js': strToU8('exports.handler = async event => console.log(JSON.stringify(event));'),
    });
    const { FunctionArn } = JSON.parse(
      await func('POST', base, {
        FunctionName: name,
        Role: role.match(/<Arn>([^<]+)<\/Arn>/)?.[1],
        Runtime: 'nodejs22.x',
        Handler: 'index.handler',
        Code: { ZipFile: Buffer.from(code).toString('base64') },
      }),
    );
    this.ctx.own({
      dispose: async () => {
        checked(
          await directLogs(this.ctx, this.port, 'DeleteLogGroup', { logGroupName: '/aws/lambda/' + name }),
          'DeleteLogGroup',
          'ResourceNotFoundException',
        );
      },
    });
    this.ctx.own({
      dispose: async () => {
        await func('DELETE', base + '/' + name);
      },
    });
    await expect
      .poll(async () => JSON.parse(await func('GET', base + '/' + name + '/configuration')).State)
      .toBe('Active');
    await func('POST', base + '/' + name + '/policy', {
      StatementId: 'allow-s3',
      Action: 'lambda:InvokeFunction',
      Principal: 's3.amazonaws.com',
      SourceArn: 'arn:aws:s3:::' + this.bucket,
    });
    return { name, arn: FunctionArn as string };
  }

  async logged(name: string, key: string) {
    const response = await directLogs(this.ctx, this.port, 'FilterLogEvents', { logGroupName: '/aws/lambda/' + name });
    const body = checked(response, 'FilterLogEvents', 'ResourceNotFoundException');
    const events: { message: string }[] = body ? JSON.parse(body).events : [];
    return events
      .map((e) => e.message)
      .find((msg) => msg.includes(key) && msg.includes('ObjectCreated:Put') && msg.includes(this.bucket));
  }
}

export function topicSettings(TopicArn: string): NotificationConfiguration {
  return {
    TopicConfigurations: [{ Id: 'audit', TopicArn, Events: ['s3:ObjectRemoved:*'] }],
    EventBridgeConfiguration: {},
  };
}
