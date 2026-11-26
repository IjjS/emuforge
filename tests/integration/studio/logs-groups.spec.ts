// The log group list (S1) of CloudWatch Logs, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 71).
//
// `studio.logs-groups-made-outside-are-listed`, `studio.logs-group-list-pages`.
//
// Each check names its log groups with its own prefix `<p>` and deletes every log group under it when it ends
// (`LogsSeeded`). What the emulator holds is read directly. Words, direct calls and readers: `services/logs/logs.ts`.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  classText,
  dateText,
  expectEmpty,
  expectGroups,
  expectRows,
  filterGroups,
  groupList,
  groupsDirect,
  LOG_GROUPS,
  LOG_GROUPS_PATH,
  LogsSeeded,
  NO_GROUPS_MATCH,
  open,
  protectionText,
  retentionText,
  rowsOf,
} from './services/logs/logs';

test('studio.logs-groups-made-outside-are-listed', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lg-list');
  const seeded = new LogsSeeded(ctx, port, p);
  const app = await seeded.group(`${p}/app`, { logClass: 'STANDARD' });
  const cold = await seeded.group(`${p}/cold`, { logClass: 'INFREQUENT_ACCESS', retention: 7 });
  const kept = await seeded.group(`${p}/Kept`, { protection: true });
  const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  await lines.line(
    'Open Log groups and filter by `<p>` → the three rows show their name, "Never expire" or "7 days", "Standard" or "Infrequent Access", deletion protection "On" or "Off" and a creation time, as the emulator reports them',
    async () => {
      const direct = await groupsDirect(ctx, port, p);
      expect(
        direct
          .map((g) => ({
            name: g.logGroupName,
            retention: g.retentionInDays ?? null,
            logClass: g.logGroupClass,
            protection: g.deletionProtectionEnabled === true,
          }))
          .sort(byName),
        'the three log groups, directly',
      ).toEqual(
        [
          { name: app, retention: null, logClass: 'STANDARD', protection: false },
          { name: cold, retention: 7, logClass: 'INFREQUENT_ACCESS', protection: false },
          { name: kept, retention: null, logClass: 'STANDARD', protection: true },
        ].sort(byName),
      );
      for (const group of direct) {
        expect(typeof group.creationTime, `the creation time of ${group.logGroupName}, directly`).toBe('number');
      }
      const want = direct
        .map((g) => ({
          name: g.logGroupName,
          retention: retentionText(g.retentionInDays),
          logClass: classText(g.logGroupClass),
          protection: protectionText(g.deletionProtectionEnabled),
          created: dateText(g.creationTime),
        }))
        .sort(byName);

      await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
      await filterGroups(page, p);
      await expect
        .poll(
          async () =>
            (await rowsOf(groupList(page).table))
              .map((r) => ({
                name: r['Log group name'],
                retention: r.Retention,
                logClass: r.Class,
                protection: r['Deletion protection'],
                created: r['Creation time'],
              }))
              .sort(byName),
          { message: 'the three rows, as the emulator reports them', timeout: 15_000 },
        )
        .toEqual(want);
    },
  );

  await lines.line(
    'Filter by `<p>/kept` (lower case) → "No log groups match"; filter by `<p>/Kept` → that one row',
    async () => {
      await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
      await filterGroups(page, `${p}/kept`);
      await expectEmpty(groupList(page).table, NO_GROUPS_MATCH);
      await filterGroups(page, kept);
      await expectGroups(page, [kept]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-group-list-pages', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lg-pages');
  const seeded = new LogsSeeded(ctx, port, p);
  const names: string[] = [];
  for (let i = 0; i < 26; i++) names.push(await seeded.group(`${p}-${String(i).padStart(2, '0')}`));
  const first = names.slice(0, 25);
  const last = names[25] ?? '';

  await lines.line(
    'Filter by `<p>-` → the first page shows 25 groups in name order; the next page shows `<p>-25`; going back shows the first 25 again',
    async () => {
      const s = groupList(page);
      await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
      await filterGroups(page, `${p}-`);
      await expectGroups(page, first);
      await s.next.click(ACTION);
      await expectRows(s.table, (r) => r['Log group name'], [last], `the next page shows ${last}`);
      await s.previous.click(ACTION);
      await expectGroups(page, first);
    },
  );

  lines.end();
});
