import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Providers } from './providers';
import { routes } from './routes';

const S3 = 'Amazon Simple Storage Service';

// Requirement 2.2, in label order.
const SERVICES: [string, string][] = [
  ['Amazon API Gateway', '/apigateway'],
  ['Amazon CloudWatch', '/cloudwatch'],
  ['Amazon CloudWatch Logs', '/logs'],
  ['Amazon DynamoDB', '/dynamodb'],
  ['Amazon Elastic Compute Cloud', '/ec2'],
  ['Amazon Elastic Container Registry', '/ecr'],
  ['Amazon EventBridge', '/events'],
  ['Amazon Kinesis', '/kinesis'],
  ['Amazon Route 53', '/route53'],
  ['Amazon Simple Notification Service', '/sns'],
  ['Amazon Simple Queue Service', '/sqs'],
  ['Amazon Simple Storage Service', '/s3'],
  ['Amazon Simple Systems Manager (SSM)', '/ssm'],
  ['AWS CloudFormation', '/cloudformation'],
  ['AWS Identity and Access Management', '/iam'],
  ['AWS Key Management Service', '/kms'],
  ['AWS Lambda', '/lambda'],
  ['AWS Secrets Manager', '/secretsmanager'],
  ['AWS Step Functions', '/states'],
];

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new TypeError('no network in this test')));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...result, wrapper: createWrapper(result.container) };
}

function breadcrumbTexts(wrapper: ReturnType<typeof createWrapper>): string[] {
  const group = wrapper.findBreadcrumbGroup();
  expect(group).not.toBeNull();
  return (group?.findBreadcrumbLinks() ?? []).map((item) => item.getElement().textContent);
}

function main(): HTMLElement {
  return screen.getByRole('main');
}

function expectNoScreenYet(label: string) {
  expect(within(main()).getByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  expect(main()).toHaveTextContent(`Studio has no screen for ${label} yet.`);
  expect(within(main()).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
}

describe('routes', () => {
  it('opens Home at /, with the breadcrumb EmuForge Studio and Home active in the navigation', () => {
    const { wrapper } = open('/');

    expect(within(main()).getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(breadcrumbTexts(wrapper)).toEqual(['EmuForge Studio']);
    const active = wrapper.findSideNavigation()?.findActiveLink();
    expect(active?.getElement()).toHaveTextContent(/^Home$/);
    expect(active?.getElement()).toHaveAttribute('href', '/');
  });

  it('opens /s3 as the "no screen yet" page of Amazon Simple Storage Service, sending nothing to the engine', () => {
    const { wrapper } = open('/s3');

    expectNoScreenYet(S3);
    expect(breadcrumbTexts(wrapper)).toEqual(['EmuForge Studio', S3]);
    const active = wrapper.findSideNavigation()?.findActiveLink();
    expect(active?.getElement()).toHaveTextContent(S3);
    expect(active?.getElement()).toHaveAttribute('href', '/s3');
    const engineCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('127.0.0.1'));
    expect(engineCalls).toEqual([]);
  });

  it('opens a path below a service, /s3/buckets/my-bucket, as the same "no screen yet" page', () => {
    const { wrapper } = open('/s3/buckets/my-bucket');

    expectNoScreenYet(S3);
    expect(breadcrumbTexts(wrapper)).toEqual(['EmuForge Studio', S3]);
    expect(wrapper.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute('href', '/s3');
  });

  it.each(SERVICES)('opens the route of %s, %s, as its "no screen yet" page', (label, route) => {
    const { wrapper } = open(route);

    expectNoScreenYet(label);
    expect(breadcrumbTexts(wrapper)).toEqual(['EmuForge Studio', label]);
    expect(wrapper.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute('href', route);
  });

  it('opens an unknown path as "Page not found", with the path as text and the last breadcrumb not a link', () => {
    const { wrapper } = open('/does-not-exist/today');

    expect(within(main()).getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(main()).toHaveTextContent('/does-not-exist/today');
    expect(within(main()).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(breadcrumbTexts(wrapper)).toEqual(['EmuForge Studio', 'Page not found']);
    const breadcrumbs = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    expect(within(breadcrumbs).getByRole('link', { name: 'EmuForge Studio' })).toBeInTheDocument();
    // The last item is the current page: it carries no address to follow.
    const current = wrapper.findBreadcrumbGroup()?.findBreadcrumbLinks().at(-1)?.getElement();
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveTextContent('Page not found');
    expect(current).not.toHaveAttribute('href');
    expect(current?.closest('a[href]')).toBeNull();
    expect(current?.querySelector('a[href]')).toBeNull();
    expect(wrapper.findSideNavigation()?.findActiveLink()).toBeNull();
  });

  it('shows a path that looks like HTML as those characters, creating no element from it', () => {
    const path = '/<img src=x onerror=alert(1)>';
    const { container } = open(path);

    expect(within(main()).getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(main()).toHaveTextContent(path);
    expect(container.querySelector('img')).toBeNull();
  });

  it('lists in the side navigation the header, Home, and the 19 services in label order, each to its route', () => {
    const { wrapper } = open('/');
    const navigation = wrapper.findSideNavigation();

    const header = navigation?.findHeaderLink()?.getElement();
    expect(header).toHaveTextContent('EmuForge Studio');
    expect(header).toHaveAttribute('href', '/');
    expect(navigation?.findLinkByHref('/')?.getElement()).toHaveTextContent(/^Home$/);

    // Items: Home, a divider, then the section.
    const section = navigation?.findItemByIndex(3);
    expect(section?.findSectionTitle()?.getElement()).toHaveTextContent('Services');
    const links = (section?.findItems() ?? []).map((item) => {
      const link = item.findLink()?.getElement();
      return [link?.textContent, link?.getAttribute('href')];
    });
    expect(links).toEqual(SERVICES);
  });

  it('shows the identity EmuForge Studio in the top navigation, linking to /', () => {
    const { wrapper } = open('/s3');

    const identity = wrapper.findTopNavigation()?.findIdentityLink()?.getElement();
    expect(identity).toHaveTextContent('EmuForge Studio');
    expect(identity).toHaveAttribute('href', '/');
  });
});
