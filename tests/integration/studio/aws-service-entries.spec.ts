// A service's entry points to its sub-services and resource kinds, built or not, in the built app served by
// `bun run serve`, in front of a real engine started for that Studio and an emulator (test-criteria.md, issue 650,
// Integration; requirement R3 to R5): the side navigation of every service holds the inventory's entries, an entry
// with a screen opens it, and an entry without one opens a page that says what it is, where its kind is listed or
// shown today, and calls nothing.
//
// `studio.aws-entries-navigation-holds-every-entry-of-the-inventory`,
// `studio.aws-entries-navigation-names-groups-and-marks-entries-without-a-screen`,
// `studio.aws-entries-entry-with-a-screen-opens-it-from-another-screen`,
// `studio.aws-entries-kind-without-a-screen-opens-its-page`,
// `studio.aws-entries-kind-shown-inside-another-says-where`,
// `studio.aws-entries-kind-listed-inside-a-parent-leads-to-the-parent`,
// `studio.aws-entries-sub-service-page-links-its-kinds`,
// `studio.aws-entries-path-below-an-entry-shows-the-generic-page`.
//
// These are checks of the area's shared way, over fourteen services, and carry no `service` in the manifest; so they
// import no service's support, and a list screen they arrive at is known by its `h1` or its crumbs and by its own
// columns (`LISTS`). No check makes or
// changes a resource: the navigation and the page of an entry read nothing of the emulator, so what other checks hold
// on the run's emulator at the same time does not reach them.
//
// The inventory and the readers of the navigation and of the page: `support/aws-entries.ts`. The generic "No screen
// yet" page: `support/no-screen-part.ts`.

import type { BrowserContext, Page } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import { connectedAt, crumbs, expectLine, noticeParts } from './support/aws-area';
import {
  acrossStatement,
  entryAt,
  entryLinkProblems,
  expectOneCurrent,
  expectPairs,
  expectSettledList,
  groupLinks,
  groupsOf,
  INVENTORY,
  type ListIdentity,
  LISTS,
  navigationLink,
  navigationTree,
  NO_SCREEN_FOR_THIS,
  NO_SCREEN_STATUS,
  openEverySection,
  openSection,
  resourceKindLinks,
  resourceKinds,
  routeOf,
  shownInStatement,
  statement,
} from './support/aws-entries';
import { ACTION, addressOf, expectHome, heading, SIDE_NAVIGATION_ACTIVE, titleOf } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { Lines } from './support/lines';
import {
  action,
  actions,
  expectCrumbs,
  expectNoScreenPart,
  expectPath,
  GO_HOME,
  goTo,
  nothingChanged,
} from './support/no-screen-part';
import { Traffic } from './support/traffic';

/** The paths the lines name, each an entry of the inventory. */
const EC2_INSTANCES = '/aws/ec2/instances';
const EC2_VOLUMES = '/aws/ec2/volumes';
const EC2_LOAD_BALANCERS = '/aws/ec2/load-balancers';
const EC2_ELB = '/aws/ec2/elastic-load-balancing';

const ELB = 'Elastic Load Balancing';

/** The `h1` of the page shown now is `name`, at `path`. */
async function expectScreen(page: Page, path: string, name: string): Promise<void> {
  await expect(page).toHaveURL(addressOf(path));
  await expect(heading(page, name), `the h1 "${name}" at ${path}`).toBeVisible();
}

/** The page of an entry without a screen: the address, the `h1` and the document title are the entry's. */
async function expectEntryPage(page: Page, path: string, label: string): Promise<void> {
  await expectScreen(page, path, label);
  await expect(page).toHaveTitle(titleOf(label));
  await expect(nothingChanged(page), 'the sentence that opening the page changed nothing').toBeVisible();
}

/** A list screen: its address (when the line names it), its `h1`, and its own list settled, read and not failed. */
async function expectList(page: Page, path: string | null, name: string, list: ListIdentity): Promise<void> {
  if (path !== null) await expect(page).toHaveURL(addressOf(path));
  await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
  await expectSettledList(page, `the list "${name}"`, list);
}

/** A list screen known by its crumbs and its own columns: both, and its list settled; its heading and columns. */
async function expectListByCrumbs(
  page: Page,
  trail: string[],
  identity: ListIdentity,
): Promise<{ heading: string | null; columns: string[] }> {
  await expect.poll(() => crumbs(page), { message: `the crumbs ${trail.join(' > ')}`, ...ACTION }).toEqual(trail);
  const list = await expectSettledList(page, `the list at ${trail.join(' > ')}`, identity);
  return { heading: list.heading, columns: list.columns };
}

/**
 * Logs the requests the browser sent to the engine's AWS endpoint during the check, each once: the list reads of the
 * screens the check opened, which its manifest row names as `operations`.
 */
function awsRequestLog(ctx: Ctx, context: BrowserContext, engineOrigin: string): () => void {
  const seen = new Set<string>();
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== engineOrigin || url.pathname.startsWith('/__emuforge/') || request.method() === 'OPTIONS')
      return;
    const headers = request.headers();
    const action = /(?:^|&)Action=([A-Za-z0-9]+)/.exec(request.postData() ?? '')?.[1] ?? '';
    seen.add(
      [request.method(), url.pathname + url.search, headers['x-amz-target'] ?? '', action]
        .filter((part) => part !== '')
        .join(' '),
    );
  });
  return () => ctx.log(`requests to the engine's AWS endpoint: ${JSON.stringify([...seen].sort())}`);
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-entries-navigation-holds-every-entry-of-the-inventory', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const logRequests = awsRequestLog(ctx, context, stack.engine.url);
  const lines = new Lines(ctx);

  await lines.line(
    "For each of the fourteen services, open its route (`/aws/<service>`) and open every group of the side navigation that is closed → the navigation's links below its header, as pairs of text and address, are exactly the inventory's entries of that service (each resource kind's label and path, and each sub-service's name and path), none twice by its address",
    async () => {
      const problems: string[] = [];
      for (const service of Object.keys(INVENTORY)) {
        const route = routeOf(service);
        await page.goto(route);
        // The service's navigation is there once its current entry is: the first entry, whose screen the route opens.
        await expect(page.locator(SIDE_NAVIGATION_ACTIVE), `the current link at ${route}`).toHaveCount(1);
        await openEverySection(page);
        const tree = await navigationTree(page);
        const found = entryLinkProblems(tree, service);
        ctx.log(`${route}: ${String(tree.links.length)} links, ${String(tree.sections.length)} sections`);
        if (found.length > 0) problems.push(`${route}: ${found.join(' | ')}`);
      }
      expect(problems, 'the navigation of each service against the inventory').toEqual([]);
    },
  );

  logRequests();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-entries-navigation-names-groups-and-marks-entries-without-a-screen', async ({
  ctx,
  page,
  context,
}) => {
  const stack = await startStack(ctx);
  const logRequests = awsRequestLog(ctx, context, stack.engine.url);
  const lines = new Lines(ctx);
  const ec2Groups = groupsOf('ec2');
  const elb = ec2Groups.find((group) => group.name === ELB);

  await lines.line(
    'Open `/aws/ec2` → the navigation shows the group names "Amazon EC2", "Elastic Load Balancing", "Classic Load Balancing" and "EC2 Auto Scaling"; the entry "Elastic Load Balancing" and "Load balancers", "Target groups", "Trust stores" and "Listeners" are in the group of that name; "Instances" is the one current link and its group is open',
    async () => {
      await page.goto('/aws/ec2');
      await expectOneCurrent(page, 'Instances');
      const tree = await navigationTree(page);
      ctx.log(`sections: ${JSON.stringify(tree.sections)}`);
      const groups = tree.sections.filter((section) => section.outermost);
      expect(
        groups.map((section) => section.title),
        'the group names',
      ).toEqual(['Amazon EC2', ELB, 'Classic Load Balancing', 'EC2 Auto Scaling']);
      expect(
        groups.find((section) => section.title === 'Amazon EC2')?.open,
        'the group of the current link is open',
      ).toBe(true);
      const current = tree.links.find((link) => link.current);
      expect(current?.sections[0], 'the group of "Instances"').toBe('Amazon EC2');
      for (const text of [ELB, 'Load balancers', 'Target groups', 'Trust stores', 'Listeners']) {
        const pair = groupLinks(elb ?? ec2Groups[0]).find((link) => link.text === text);
        const link = tree.links.find((shown) => shown.href === pair?.href);
        expect(link?.text, `the link at ${String(pair?.href)}`).toBe(text);
        expect(link?.sections[0], `the group of "${text}"`).toBe(ELB);
      }
    },
  );

  await lines.line(
    'On the same navigation → "Load balancers" (no screen) is followed by the text "No screen yet"; "Volumes" (a screen) is not',
    async () => {
      await page.goto('/aws/ec2');
      await expectOneCurrent(page, 'Instances');
      await openSection(page, ELB);
      const loadBalancers = navigationLink(page, EC2_LOAD_BALANCERS);
      await expect(loadBalancers, 'the link "Load balancers"').toHaveText('Load balancers');
      await expect(loadBalancers, '"Load balancers" is described by "No screen yet"').toHaveAccessibleDescription(
        NO_SCREEN_STATUS,
      );
      const volumes = navigationLink(page, EC2_VOLUMES);
      await expect(volumes, 'the link "Volumes"').toHaveText('Volumes');
      await expect(volumes, '"Volumes" has no such words').toHaveAccessibleDescription('');
      const tree = await navigationTree(page);
      expect(
        tree.links.filter((link) => link.href === EC2_LOAD_BALANCERS || link.href === EC2_VOLUMES),
        'the two links as read from the navigation',
      ).toEqual([
        expect.objectContaining({ href: EC2_VOLUMES, description: '', beside: '' }),
        expect.objectContaining({
          href: EC2_LOAD_BALANCERS,
          description: NO_SCREEN_STATUS,
          beside: NO_SCREEN_STATUS,
          descriptionDrawn: true,
        }),
      ]);
    },
  );

  await lines.line(
    'Open `/aws/sqs` → the navigation shows no group name; its links are "Queues" (current) and "Message move tasks", the second with "No screen yet"',
    async () => {
      await page.goto('/aws/sqs');
      await expectOneCurrent(page, 'Queues');
      const tree = await navigationTree(page);
      ctx.log(`side navigation: ${JSON.stringify(tree)}`);
      expect(tree.sections, 'no group name').toEqual([]);
      expect(
        tree.links.map((link) => ({
          text: link.text,
          description: link.description,
          beside: link.beside,
          descriptionDrawn: link.descriptionDrawn,
          current: link.current,
        })),
        'the links',
      ).toEqual([
        { text: 'Queues', description: '', beside: '', descriptionDrawn: false, current: true },
        {
          text: 'Message move tasks',
          description: NO_SCREEN_STATUS,
          beside: NO_SCREEN_STATUS,
          descriptionDrawn: true,
          current: false,
        },
      ]);
    },
  );

  logRequests();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-entries-entry-with-a-screen-opens-it-from-another-screen', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const logRequests = awsRequestLog(ctx, context, stack.engine.url);
  const lines = new Lines(ctx);

  await lines.line(
    'On `/aws/ec2/instances`, follow "Volumes" in the navigation → the address is `/aws/ec2/volumes`, the `h1` is the volume list\'s, and "Volumes" is the one current link',
    async () => {
      await page.goto(EC2_INSTANCES);
      await expectList(page, EC2_INSTANCES, 'Instances', LISTS.instances);
      const volumes = navigationLink(page, EC2_VOLUMES);
      await expect(volumes, 'the link "Volumes"').toHaveText('Volumes');
      await volumes.click(ACTION);
      await expectList(page, EC2_VOLUMES, 'Volumes', LISTS.volumes);
      await expectOneCurrent(page, 'Volumes');
    },
  );

  /** A service whose list screen has a second path: the route opens the list, the entry takes the second path. */
  async function listWithSecondPath(
    route: string,
    entryPath: string,
    entry: string,
    trail: string[],
    identity: ListIdentity,
  ) {
    await page.goto(route);
    await expect(page).toHaveURL(addressOf(route));
    const atRoute = await expectListByCrumbs(page, trail, identity);
    const link = navigationLink(page, entryPath);
    await expect(link, `the link at ${entryPath}`).toHaveText(entry);
    await expectOneCurrent(page, entry);
    await markPage(page);
    await link.click(ACTION);
    await expect(page).toHaveURL(addressOf(entryPath));
    expect(await expectListByCrumbs(page, trail, identity), 'the same list: its heading and its columns').toEqual(
      atRoute,
    );
    await expectOneCurrent(page, entry);
    expect(await stillSamePage(page), 'no document was loaded').toBe(true);
  }

  await lines.line(
    'Open `/aws/kms` → the key list; the navigation\'s "Customer managed keys" has the address `/aws/kms/keys` and is current, and exactly one link of the whole navigation, its header included, is current; follow it → the address is `/aws/kms/keys` and the same list is shown, the same one link current',
    async () => {
      await listWithSecondPath(
        '/aws/kms',
        '/aws/kms/keys',
        'Customer managed keys',
        ['EmuForge', 'AWS', 'KMS', 'Customer managed keys'],
        LISTS.keys,
      );
    },
  );

  await lines.line(
    'Open `/aws/ssm` → the parameter list; "Parameter Store" has the address `/aws/ssm/parameters` and is current, exactly one link of the whole navigation, its header included; follow it → `/aws/ssm/parameters`, the same list',
    async () => {
      await listWithSecondPath(
        '/aws/ssm',
        '/aws/ssm/parameters',
        'Parameter Store',
        ['EmuForge', 'AWS', 'Systems Manager', 'Parameter Store'],
        LISTS.parameters,
      );
    },
  );

  logRequests();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-entries-kind-without-a-screen-opens-its-page', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const logRequests = awsRequestLog(ctx, context, stack.engine.url);
  const lines = new Lines(ctx);
  const traffic = Traffic.attach(ctx, context, page);
  const loadBalancers = entryAt('ec2', EC2_LOAD_BALANCERS);

  /** The browser's requests to the engine's AWS endpoint from the `from`th on: every path but the engine's own. */
  function awsRequests(from: number): string[] {
    return traffic.requests
      .slice(from)
      .filter((request) => {
        const url = new URL(request.url);
        return url.origin === stack.engine.url && !url.pathname.startsWith('/__emuforge/');
      })
      .map((request) => `${request.method} ${request.url}`);
  }

  await lines.line(
    'On `/aws/ec2/instances`, open the group "Elastic Load Balancing" in the navigation and follow "Load balancers" → the address is `/aws/ec2/load-balancers`; the `h1` is "Load balancers"; the document title is "Load balancers | EmuForge Studio"; the crumbs are "EmuForge", "AWS", "EC2", "Load balancers"; the statement "Studio has no screen for this yet."; the values "Resource kind" "Load balancers", "Part of" "Elastic Load Balancing", "Listed by" `DescribeLoadBalancers`; the sentence "Opening this page changed nothing in your local emulator."; the actions "Go to Instances" and "Go to Home"; "Load balancers" is the one current link and its group is open',
    async () => {
      await page.goto(EC2_INSTANCES);
      await expectList(page, EC2_INSTANCES, 'Instances', LISTS.instances);
      await openSection(page, ELB);
      const link = navigationLink(page, EC2_LOAD_BALANCERS);
      await expect(link, 'the link "Load balancers"').toHaveText('Load balancers');
      await link.click(ACTION);
      await expectEntryPage(page, EC2_LOAD_BALANCERS, 'Load balancers');
      await expectCrumbs(page, ['EmuForge', 'AWS', 'EC2', 'Load balancers']);
      await expect(statement(page, NO_SCREEN_FOR_THIS), 'the statement').toBeVisible();
      await expectPairs(page, {
        'Resource kind': 'Load balancers',
        'Part of': ELB,
        'Listed by': loadBalancers.listedBy,
      });
      expect(loadBalancers.listedBy, "the inventory's list read").toBe('DescribeLoadBalancers');
      expect(
        (await actions(page)).map((shown) => shown.name),
        'the actions',
      ).toEqual([goTo('Instances'), GO_HOME]);
      await expectOneCurrent(page, 'Load balancers');
      const tree = await navigationTree(page);
      expect(
        tree.sections.find((section) => section.title === ELB),
        'the group of the current link',
      ).toEqual({ title: ELB, outermost: true, open: true });
    },
  );

  await lines.line(
    'On that page → the emulator line reads "Connected at `<endpoint>`"; there is no local-emulator notice and no "About the local emulator" control',
    async () => {
      await page.goto(EC2_LOAD_BALANCERS);
      await expectEntryPage(page, EC2_LOAD_BALANCERS, 'Load balancers');
      await expectLine(page, connectedAt(stack.emulatorPort));
      expect(await noticeParts(page), 'the notice and its (i) control').toEqual({ notices: 0, about: 0 });
    },
  );

  await lines.line(
    'From a fresh load of `/aws/ec2/load-balancers` until the line reads "Connected" → the browser sent no request to the engine\'s AWS endpoint',
    async () => {
      // A page with nothing of the area on it first, so no request of an earlier line's screen is still leaving.
      await page.goto('/');
      await expectHome(page);
      const from = traffic.requests.length;
      await page.goto(EC2_LOAD_BALANCERS);
      await expectEntryPage(page, EC2_LOAD_BALANCERS, 'Load balancers');
      await expectLine(page, connectedAt(stack.emulatorPort));
      await traffic.settle();
      const sent = awsRequests(from);
      ctx.log(
        `requests since the load: ${String(traffic.requests.length - from)}, to the AWS endpoint: ${JSON.stringify(sent)}`,
      );
      expect(sent, "requests to the engine's AWS endpoint").toEqual([]);
    },
  );

  await lines.line(
    '"Go to Instances" → the address is `/aws/ec2` (the service\'s first screen, at its route) and the instance list is shown',
    async () => {
      await page.goto(EC2_LOAD_BALANCERS);
      await expectEntryPage(page, EC2_LOAD_BALANCERS, 'Load balancers');
      await action(page, goTo('Instances')).click(ACTION);
      await expectList(page, '/aws/ec2', 'Instances', LISTS.instances);
    },
  );

  await lines.line(
    'On `/aws/ec2/load-balancers`, "Go to Home" → the address is `/` and Home is shown, without a document load',
    async () => {
      await page.goto(EC2_LOAD_BALANCERS);
      await expectEntryPage(page, EC2_LOAD_BALANCERS, 'Load balancers');
      await markPage(page);
      await action(page, GO_HOME).click(ACTION);
      await expectHome(page);
      expect(await stillSamePage(page), 'no document was loaded').toBe(true);
    },
  );

  await lines.line('Open `/aws/sqs/message-move-tasks` → no value "Part of" (a service of one group)', async () => {
    const path = '/aws/sqs/message-move-tasks';
    const tasks = entryAt('sqs', path);
    await page.goto(path);
    await expectEntryPage(page, path, tasks.label);
    await expectPairs(page, { 'Resource kind': tasks.label, 'Listed by': tasks.listedBy }, ['Part of']);
  });

  await lines.line(
    'On `/aws/s3`, follow "Directory buckets" in the navigation (the link issue 480 took out, an entry again) → the address is `/aws/s3/directory-buckets`, the `h1` is "Directory buckets", the value "Listed by" is `ListDirectoryBuckets`, and "Directory buckets" is the one current link',
    async () => {
      const path = '/aws/s3/directory-buckets';
      await page.goto('/aws/s3');
      await expectList(page, '/aws/s3', 'Buckets', LISTS.buckets);
      const link = navigationLink(page, path);
      await expect(link, 'the link "Directory buckets"').toHaveText('Directory buckets');
      await link.click(ACTION);
      await expectEntryPage(page, path, 'Directory buckets');
      await expectPairs(page, { 'Listed by': 'ListDirectoryBuckets' });
      await expectOneCurrent(page, 'Directory buckets');
    },
  );

  logRequests();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-entries-kind-shown-inside-another-says-where', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const logRequests = awsRequestLog(ctx, context, stack.engine.url);
  const lines = new Lines(ctx);

  await lines.line(
    'Open `/aws/ecs/services` → `h1` "Services"; the statement "Studio has no screen that lists these across ECS yet." and "It shows them in the "Services" section of a cluster."; the value "Listed inside" "Clusters"; the primary action "Go to Clusters" leads to `/aws/ecs/clusters`, the cluster list',
    async () => {
      const path = '/aws/ecs/services';
      await page.goto(path);
      await expectEntryPage(page, path, 'Services');
      await expect(statement(page, acrossStatement('ECS')), 'the statement').toBeVisible();
      await expect(
        statement(page, shownInStatement('the "Services" section of a cluster')),
        'where they are shown',
      ).toBeVisible();
      await expectPairs(page, { 'Listed inside': 'Clusters' });
      expect((await actions(page))[0], 'the primary action').toEqual({
        name: goTo('Clusters'),
        href: '/aws/ecs/clusters',
      });
      await action(page, goTo('Clusters')).click(ACTION);
      await expectList(page, '/aws/ecs/clusters', 'Clusters', LISTS.clusters);
    },
  );

  await lines.line(
    'Open `/aws/ec2/security-group-rules` (a list of the account) → the statement "Studio has no screen that lists these across EC2 yet." and "It shows them in the "Rules" section of a security group."; no value "Listed inside"; "Go to Security groups" leads to `/aws/ec2/security-groups`',
    async () => {
      const path = '/aws/ec2/security-group-rules';
      await page.goto(path);
      await expectEntryPage(page, path, entryAt('ec2', path).label);
      await expect(statement(page, acrossStatement('EC2')), 'the statement').toBeVisible();
      await expect(
        statement(page, shownInStatement('the "Rules" section of a security group')),
        'where they are shown',
      ).toBeVisible();
      await expectPairs(page, { 'Resource kind': entryAt('ec2', path).label }, ['Listed inside']);
      await action(page, goTo('Security groups')).click(ACTION);
      await expectList(page, '/aws/ec2/security-groups', 'Security groups', LISTS.securityGroups);
    },
  );

  logRequests();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-entries-kind-listed-inside-a-parent-leads-to-the-parent', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const logRequests = awsRequestLog(ctx, context, stack.engine.url);
  const lines = new Lines(ctx);

  await lines.line(
    'Open `/aws/s3/bucket-analytics-configurations` → the statement "Studio has no screen for this yet."; the value "Listed inside" "General purpose buckets"; no sentence beginning "It shows them"; "Go to General purpose buckets" leads to `/aws/s3/buckets`, the bucket list',
    async () => {
      const path = '/aws/s3/bucket-analytics-configurations';
      await page.goto(path);
      await expectEntryPage(page, path, entryAt('s3', path).label);
      await expect(statement(page, NO_SCREEN_FOR_THIS), 'the statement').toBeVisible();
      await expectPairs(page, { 'Listed inside': 'General purpose buckets' });
      await expect(page.getByRole('main').getByText(/^It shows them/), 'no sentence "It shows them …"').toHaveCount(0);
      await action(page, goTo('General purpose buckets')).click(ACTION);
      await expectList(page, '/aws/s3/buckets', 'Buckets', LISTS.buckets);
    },
  );

  await lines.line(
    'Open `/aws/iam/user-policies` (its parent "Users" has no screen either) → "Go to Users" leads to `/aws/iam/users`, the page of the entry "Users"',
    async () => {
      const path = '/aws/iam/user-policies';
      await page.goto(path);
      await expectEntryPage(page, path, entryAt('iam', path).label);
      await action(page, goTo('Users')).click(ACTION);
      await expectEntryPage(page, '/aws/iam/users', 'Users');
      await expect(statement(page, NO_SCREEN_FOR_THIS), 'the statement of the page of "Users"').toBeVisible();
      await expectPairs(page, { 'Resource kind': 'Users' });
    },
  );

  logRequests();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-entries-sub-service-page-links-its-kinds', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const logRequests = awsRequestLog(ctx, context, stack.engine.url);
  const lines = new Lines(ctx);
  const elb = groupsOf('ec2').find((group) => group.name === ELB);

  await lines.line(
    'Open `/aws/ec2/elastic-load-balancing` → `h1` "Elastic Load Balancing"; the values "Sub-service" "Elastic Load Balancing" and "Part of" "EC2"; under the heading "Resource kinds" the links are exactly the inventory\'s kinds of that group, each with "No screen yet"; "Elastic Load Balancing" is the one current link of the navigation',
    async () => {
      await page.goto(EC2_ELB);
      await expectEntryPage(page, EC2_ELB, ELB);
      await expectPairs(page, { 'Sub-service': ELB, 'Part of': 'EC2' });
      const wanted = (elb?.entries ?? [])
        .map((entry) => ({
          text: entry.label,
          href: entry.path,
          description: NO_SCREEN_STATUS,
          beside: NO_SCREEN_STATUS,
          descriptionDrawn: true,
        }))
        .sort((a, b) => a.href.localeCompare(b.href));
      expect(wanted.length, 'the inventory holds kinds of the group').toBeGreaterThan(0);
      await expect
        .poll(async () => (await resourceKindLinks(page)).sort((a, b) => a.href.localeCompare(b.href)), {
          message: 'the links under "Resource kinds"',
          ...ACTION,
        })
        .toEqual(wanted);
      await expectOneCurrent(page, ELB);
    },
  );

  await lines.line(
    'Follow "Target groups" there → the address is `/aws/ec2/target-groups` and the `h1` is "Target groups"',
    async () => {
      await page.goto(EC2_ELB);
      await expectEntryPage(page, EC2_ELB, ELB);
      // The area's `main` holds the side navigation too, which has a link of the same name: the page's own list.
      await resourceKinds(page).getByRole('link', { name: 'Target groups', exact: true }).click(ACTION);
      await expectEntryPage(page, '/aws/ec2/target-groups', 'Target groups');
    },
  );

  await lines.line(
    'Open `/aws/dynamodb/dax` → `h1` "DynamoDB Accelerator (DAX)"; "Go to Tables" leads to the table list',
    async () => {
      const path = '/aws/dynamodb/dax';
      await page.goto(path);
      await expectEntryPage(page, path, 'DynamoDB Accelerator (DAX)');
      await action(page, goTo('Tables')).click(ACTION);
      await expectList(page, null, 'Tables', LISTS.tables);
      await expect
        .poll(() => crumbs(page), { message: 'the crumbs of the table list', ...ACTION })
        .toEqual(['EmuForge', 'AWS', 'DynamoDB', 'Tables']);
    },
  );

  logRequests();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-entries-path-below-an-entry-shows-the-generic-page', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const logRequests = awsRequestLog(ctx, context, stack.engine.url);
  const lines = new Lines(ctx);

  /** The generic page at `path` for the service `label`, with no link of the navigation current. */
  async function expectGeneric(path: string, label: string): Promise<void> {
    await page.goto(path);
    await expectNoScreenPart(page, label, path);
    await expectPath(page, path);
    await expect
      .poll(async () => (await navigationTree(page)).header !== null, { message: 'the side navigation', ...ACTION })
      .toBe(true);
    await expect(page.locator(SIDE_NAVIGATION_ACTIVE), `no current navigation link at ${path}`).toHaveCount(0);
    const tree = await navigationTree(page);
    expect(
      tree.links.filter((link) => link.current).map((link) => link.text),
      'no link of the navigation is current',
    ).toEqual([]);
    expect(tree.headerCurrent, 'the header is not current').toBe(false);
  }

  await lines.line(
    'Open `/aws/ec2/load-balancers/x` → the `h1` is "No screen yet", the statement "Studio has no screen for this part of Amazon Elastic Compute Cloud yet." and the value "Path" `/aws/ec2/load-balancers/x`, as today; no link of the navigation is current',
    async () => {
      await expectGeneric('/aws/ec2/load-balancers/x', 'Amazon Elastic Compute Cloud');
    },
  );

  await lines.line(
    'Open `/aws/s3/directory-buckets/x` → the same page for Amazon Simple Storage Service, "Path" `/aws/s3/directory-buckets/x`; no link of the navigation is current',
    async () => {
      await expectGeneric('/aws/s3/directory-buckets/x', 'Amazon Simple Storage Service');
    },
  );

  logRequests();
  lines.end();
});
