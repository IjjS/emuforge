import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Providers } from './providers';
import { routes } from './routes';

const AWS = 'Amazon Web Services';
const S3 = 'Amazon Simple Storage Service';

// providers/aws/services.ts, in label order, each under /aws.
const SERVICES: [string, string][] = [
  ['Amazon API Gateway', '/aws/apigateway'],
  ['Amazon CloudWatch', '/aws/cloudwatch'],
  ['Amazon CloudWatch Logs', '/aws/logs'],
  ['Amazon DynamoDB', '/aws/dynamodb'],
  ['Amazon Elastic Compute Cloud', '/aws/ec2'],
  ['Amazon Elastic Container Registry', '/aws/ecr'],
  ['Amazon EventBridge', '/aws/events'],
  ['Amazon Kinesis', '/aws/kinesis'],
  ['Amazon Route 53', '/aws/route53'],
  ['Amazon Simple Notification Service', '/aws/sns'],
  ['Amazon Simple Queue Service', '/aws/sqs'],
  ['Amazon Simple Storage Service', '/aws/s3'],
  ['Amazon Simple Systems Manager (SSM)', '/aws/ssm'],
  ['AWS CloudFormation', '/aws/cloudformation'],
  ['AWS Identity and Access Management', '/aws/iam'],
  ['AWS Key Management Service', '/aws/kms'],
  ['AWS Lambda', '/aws/lambda'],
  ['AWS Secrets Manager', '/aws/secretsmanager'],
  ['AWS Step Functions', '/aws/states'],
];

/** The AWS area's first import is real work (Cloudscape's modules), not a timer; a cold run takes a while. */
const AREA_LOAD_MS = 10_000;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new TypeError('no network in this test')));
  vi.stubGlobal('fetch', fetchSpy);
  // The AWS area follows the operating system's scheme, which jsdom does not report: light here.
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

/** True when the element, or an element around it, carries a Cloudscape class: it is inside the AWS area. */
function inCloudscape(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if ([...at.classList].some((name) => name.startsWith('awsui'))) {
      return true;
    }
  }
  return false;
}

function cloudscapeElements(): Element[] {
  return [...document.querySelectorAll('*')].filter((element) =>
    [...element.classList].some((name) => name.startsWith('awsui')),
  );
}

/** The page's `h1`, once the page (the AWS area loads on first opening) is there. */
async function heading(name: string): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name }, { timeout: AREA_LOAD_MS });
}

function main(): HTMLElement {
  return screen.getByRole('main');
}

async function expectNoScreenYet(label: string) {
  const h1 = await heading(label);
  expect(inCloudscape(h1)).toBe(true);
  expect(main()).toHaveTextContent(`Studio has no screen for ${label} yet.`);
  expect(within(main()).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
}

describe('routes', () => {
  it('opens Home at /', () => {
    open('/');

    expect(within(main()).getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });

  it('opens /aws as the AWS area index: "Services" (19), its line, and the 19 services in label order', async () => {
    open('/aws');

    expect(inCloudscape(await heading(AWS))).toBe(true);
    const container = createWrapper(main()).findContainer();
    expect(container).not.toBeNull();
    const header = container?.findHeader()?.getElement();
    expect(header).toHaveTextContent('Services');
    expect(header).toHaveTextContent('(19)');
    expect(header).toHaveTextContent('No service has a Studio screen yet.');
    const links = within(container?.findContent().getElement() as HTMLElement)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual(SERVICES);
  });

  it('opens /aws/s3 as the "no screen yet" page of Amazon Simple Storage Service, sending nothing to the engine', async () => {
    open('/aws/s3');

    await expectNoScreenYet(S3);
    const engineCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('127.0.0.1'));
    expect(engineCalls).toEqual([]);
  });

  it('opens a path below a service, /aws/s3/buckets/my-bucket, as the same "no screen yet" page', async () => {
    open('/aws/s3/buckets/my-bucket');

    await expectNoScreenYet(S3);
  });

  it.each(SERVICES)('opens the route of %s, %s, as its "no screen yet" page', async (label, path) => {
    open(path);

    await expectNoScreenYet(label);
  });

  it('opens /aws/does-not-exist/today as the AWS area’s "Page not found", with the path as text', async () => {
    open('/aws/does-not-exist/today');

    expect(inCloudscape(await heading('Page not found'))).toBe(true);
    expect(main()).toHaveTextContent('/aws/does-not-exist/today');
    expect(within(main()).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });

  it.each(['/s3', '/dynamodb/tables', '/does-not-exist/today'])(
    'opens %s as Studio’s "Page not found", outside any AWS area',
    async (path) => {
      open(path);

      expect(await heading('Page not found')).toBeInTheDocument();
      expect(main()).toHaveTextContent(`Studio has no page at ${path}.`);
      expect(within(main()).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
      expect(cloudscapeElements()).toEqual([]);
    },
  );

  it.each(['/<img src=x onerror=alert(1)>', '/aws/<img src=x onerror=alert(1)>'])(
    'shows the path %s as those characters, creating no element from it',
    async (path) => {
      const { container } = open(path);

      expect(await heading('Page not found')).toBeInTheDocument();
      expect(main()).toHaveTextContent(path);
      expect(container.querySelector('img')).toBeNull();
    },
  );

  it.each([
    ['/', 'Home'],
    ['/aws', AWS],
    ['/aws/s3', S3],
    ['/aws/s3/buckets/my-bucket', S3],
    ['/aws/does-not-exist/today', 'Page not found'],
    ['/s3', 'Page not found'],
    ['/dynamodb/tables', 'Page not found'],
    ['/does-not-exist/today', 'Page not found'],
    ['/<img src=x onerror=alert(1)>', 'Page not found'],
    ['/aws/<img src=x onerror=alert(1)>', 'Page not found'],
  ])('on %s: exactly one main landmark, and the frame’s banner is not inside it', async (path, h1) => {
    open(path);
    await heading(h1);

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'EmuForge Studio' })).toBeInTheDocument();
    expect(mains[0]?.contains(banner)).toBe(false);
    expect(banner.contains(mains[0] as HTMLElement)).toBe(false);
  });
});
