import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { MODIFY_INSTANCE, modifyInstance } from './modify-api';

const PASSWORD = 'Test-Password!580';
const sent: Record<string, string>[] = [];
let port = 9885;
let responseId: string | undefined;

beforeEach(() => {
  port += 1;
  sent.length = 0;
  responseId = 'updated-db';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-580' }));
    }
    sent.push(Object.fromEntries(new URLSearchParams(await request.text())));
    const identifier = responseId === undefined ? '' : `<DBInstanceIdentifier>${responseId}</DBInstanceIdentifier>`;
    return new Response(
      `<ModifyDBInstanceResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/"><ModifyDBInstanceResult><DBInstance>${identifier}<DBInstanceStatus>modifying</DBInstanceStatus></DBInstance></ModifyDBInstanceResult></ModifyDBInstanceResponse>`,
      { headers: { 'content-type': 'text/xml' } },
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = {
  Action: MODIFY_INSTANCE,
  Version: '2014-10-31',
  ApplyImmediately: 'true',
};

describe('ModifyDBInstance', () => {
  it('U7 sends the five changed settings against the original identity and returns the result identity', async () => {
    const id = await modifyInstance(
      engineEndpoint(port),
      'original-db',
      {
        identifier: 'Updated-DB',
        instanceClass: 'db.t3.small',
        allocatedStorage: 30,
        masterPassword: PASSWORD,
        deletionProtection: false,
      },
      new AbortController().signal,
    );
    expect(id).toBe('updated-db');
    expect(sent).toEqual([
      {
        ...request,
        DBInstanceIdentifier: 'original-db',
        NewDBInstanceIdentifier: 'Updated-DB',
        DBInstanceClass: 'db.t3.small',
        AllocatedStorage: '30',
        MasterUserPassword: PASSWORD,
        DeletionProtection: 'false',
      },
    ]);
  });

  it.each([
    ['password only', 'app-db', { masterPassword: PASSWORD }, { MasterUserPassword: PASSWORD }],
    ['member class only', 'member-db', { instanceClass: 'db.r6g.xlarge' }, { DBInstanceClass: 'db.r6g.xlarge' }],
    [
      'blank replacement omitted',
      'app-db',
      { deletionProtection: true, masterPassword: '' },
      { DeletionProtection: 'true' },
    ],
  ] as const)('U8 sends %s with no other update', async (_case, id, changes, fields) => {
    responseId = id;
    await expect(modifyInstance(engineEndpoint(port), id, changes, new AbortController().signal)).resolves.toBe(id);
    expect(sent).toEqual([{ ...request, DBInstanceIdentifier: id, ...fields }]);
  });

  it('U9 refuses an answer with no identifier', async () => {
    responseId = undefined;
    await expect(
      modifyInstance(engineEndpoint(port), 'original-db', { identifier: 'requested-db' }, new AbortController().signal),
    ).rejects.toThrow('ModifyDBInstance answered with no identifier.');
  });
});
