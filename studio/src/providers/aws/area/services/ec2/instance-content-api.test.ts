import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { changeInstanceContent, getInstanceUserData } from './instance-content-api';

const ENGINE = engineEndpoint(9762);
const ID = 'i-external';
const VERSION = '2016-11-15';
const TEXT = '\uFEFF#!/bin/sh\r\necho 한글\\name\rnext\n';
const requests: Record<string, string>[] = [];
let response: string;

beforeEach(() => {
  requests.length = 0;
  response = '<return>true</return>';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return Response.json({ token: 'test-instance-content' });
    }
    const fields = Object.fromEntries(new URLSearchParams(await request.text()));
    requests.push(fields);
    const root = `${fields['Action'] ?? ''}Response`;
    return new Response(`<${root} xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">${response}</${root}>`, {
      headers: { 'content-type': 'text/xml' },
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

const signal = () => new AbortController().signal;

it('reads an absent value as empty and decodes base64 without changing the UTF-8 text', async () => {
  response = '<userData/>';
  await expect(getInstanceUserData(ENGINE, ID, signal())).resolves.toEqual({ kind: 'text', text: '' });
  response = `<userData><value>${Buffer.from(TEXT, 'utf8').toString('base64')}</value></userData>`;
  await expect(getInstanceUserData(ENGINE, ID, signal())).resolves.toEqual({ kind: 'text', text: TEXT });
  response = '<userData><value>/w==</value></userData>';
  await expect(getInstanceUserData(ENGINE, ID, signal())).resolves.toEqual({ kind: 'binary' });
  const fields = { Action: 'DescribeInstanceAttribute', Version: VERSION, InstanceId: ID, Attribute: 'userData' };
  expect(requests).toEqual([fields, fields, fields]);
});

it.each([TEXT, ''])('writes the original UTF-8 bytes for %j, including an explicit empty value', async (text) => {
  await changeInstanceContent(ENGINE, ID, { kind: 'user-data', text }, signal());
  expect(requests).toEqual([
    {
      Action: 'ModifyInstanceAttribute',
      Version: VERSION,
      InstanceId: ID,
      'UserData.Value': Buffer.from(text, 'utf8').toString('base64'),
    },
  ]);
});

it('puts one key on each write and removes that key without a value filter', async () => {
  await changeInstanceContent(ENGINE, ID, { kind: 'put-tag', tag: { key: 'Name', value: 'first' } }, signal());
  await changeInstanceContent(ENGINE, ID, { kind: 'put-tag', tag: { key: 'Name', value: '' } }, signal());
  await changeInstanceContent(ENGINE, ID, { kind: 'delete-tag', key: 'Name' }, signal());
  const tag = { Version: VERSION, 'ResourceId.1': ID, 'Tag.1.Key': 'Name' };
  expect(requests).toEqual([
    { ...tag, Action: 'CreateTags', 'Tag.1.Value': 'first' },
    { ...tag, Action: 'CreateTags', 'Tag.1.Value': '' },
    { ...tag, Action: 'DeleteTags' },
  ]);
});
