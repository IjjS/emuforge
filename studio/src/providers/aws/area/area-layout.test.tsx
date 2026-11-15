import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AwsArea from './index';
import { AREA_ROOT_CLASS } from './styles/root-class';

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

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The operating system's colour scheme, as `matchMedia` reports it; `setDark` changes it while the page is open. */
class ColourScheme {
  dark = false;
  private readonly listeners = new Set<() => void>();

  readonly matchMedia = (query: string): MediaQueryList => {
    const list: Partial<MediaQueryList> = {
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: unknown) => {
        if (query === DARK_QUERY) {
          this.listeners.add(listener as () => void);
        }
      },
      removeEventListener: (_type: string, listener: unknown) => {
        this.listeners.delete(listener as () => void);
      },
    };
    Object.defineProperty(list, 'matches', { get: () => query === DARK_QUERY && this.dark });
    return list as MediaQueryList;
  };

  setDark(dark: boolean) {
    this.dark = dark;
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

let scheme: ColourScheme;
let titles: string[];

beforeEach(() => {
  scheme = new ColourScheme();
  vi.stubGlobal('matchMedia', scheme.matchMedia);
  titles = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string) {
  const handlePageTitle = (title: string) => {
    titles.push(title);
  };
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio's Home</p> },
      { path: '/aws/*', element: <AwsArea headerSelector="#top-bar" onPageTitle={handlePageTitle} /> },
    ],
    { initialEntries: [path] },
  );
  const result = render(<RouterProvider router={router} />);
  return { ...result, router, wrapper: createWrapper(result.container) };
}

function breadcrumbs(wrapper: ReturnType<typeof createWrapper>): [string | null, string | null][] {
  return (wrapper.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((item) => {
    const element = item.getElement();
    const link = element.closest('a[href]') ?? element.querySelector('a[href]');
    return [element.textContent, link?.getAttribute('href') ?? null];
  });
}

function areaRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(`.${AREA_ROOT_CLASS}`);
  expect(root).not.toBeNull();
  return root as HTMLElement;
}

/** Every element of the document, `html` and `body` included, that carries a class starting `awsui`. */
function cloudscapeElements(): Element[] {
  return [...document.querySelectorAll('*')].filter((element) =>
    [...element.classList].some((name) => name.startsWith('awsui')),
  );
}

describe('the AWS area', () => {
  it('on /aws: the side navigation header and the 19 services in label order, one crumb, nothing active', () => {
    const { wrapper } = open('/aws');
    const navigation = wrapper.findSideNavigation();

    const header = navigation?.findHeaderLink()?.getElement();
    expect(header).toHaveTextContent(AWS);
    expect(header).toHaveAttribute('href', '/aws');
    const section = navigation?.findItemByIndex(1);
    expect(section?.findSectionTitle()?.getElement()).toHaveTextContent('Services');
    const links = (section?.findItems() ?? []).map((item) => {
      const link = item.findLink()?.getElement();
      return [link?.textContent, link?.getAttribute('href')];
    });
    expect(links).toEqual(SERVICES);
    expect(navigation?.findItemByIndex(2)).toBeNull();
    expect(breadcrumbs(wrapper).map(([text]) => text)).toEqual([AWS]);
    expect(navigation?.findActiveLink()).toBeNull();
    expect(titles.at(-1)).toBe(AWS);
  });

  it('on /aws/s3/buckets: crumbs Amazon Web Services (to /aws) then the service, the service active', () => {
    const { wrapper } = open('/aws/s3/buckets');

    expect(breadcrumbs(wrapper)).toEqual([
      [AWS, '/aws'],
      [S3, null],
    ]);
    const active = wrapper.findSideNavigation()?.findActiveLink()?.getElement();
    expect(active).toHaveTextContent(S3);
    expect(active).toHaveAttribute('href', '/aws/s3');
    expect(screen.getByRole('heading', { level: 1, name: S3 })).toBeInTheDocument();
    expect(titles.at(-1)).toBe(S3);
  });

  it('on /aws/does-not-exist: crumbs Amazon Web Services then Page not found, nothing active', () => {
    const { wrapper } = open('/aws/does-not-exist');

    expect(breadcrumbs(wrapper).map(([text]) => text)).toEqual([AWS, 'Page not found']);
    expect(wrapper.findSideNavigation()?.findActiveLink()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(titles.at(-1)).toBe('Page not found');
  });

  it('moves to a service chosen in the side navigation without loading the page', () => {
    const { wrapper, router } = open('/aws');
    const s3 = wrapper.findSideNavigation()?.findLinkByHref('/aws/s3')?.getElement();
    expect(s3).toBeDefined();

    let followed = true;
    act(() => {
      followed = fireEvent.click(s3 as HTMLElement);
    });

    // A click whose default is prevented: the router moved, the browser did not load the address.
    expect(followed).toBe(false);
    expect(router.state.location.pathname).toBe('/aws/s3');
    expect(screen.getByRole('heading', { level: 1, name: S3 })).toBeInTheDocument();
    expect(wrapper.findSideNavigation()?.findActiveLink()?.getElement()).toHaveAttribute('href', '/aws/s3');
  });

  it('has no tools panel and no toggle for one', () => {
    const { wrapper } = open('/aws/s3');
    const layout = wrapper.findAppLayout();

    expect(layout).not.toBeNull();
    expect(layout?.findTools()).toBeNull();
    expect(layout?.findToolsToggle()).toBeNull();
    expect(screen.queryByRole('button', { name: /tools|help panel/i })).toBeNull();
  });

  it("carries Cloudscape's dark mode on the area's root only, following the scheme while open", async () => {
    scheme.dark = true;
    const { container } = open('/aws/s3');
    const root = areaRoot(container);

    expect(root).toHaveClass('awsui-dark-mode');
    expect([...document.documentElement.classList]).toEqual([]);
    expect([...document.body.classList].filter((name) => name.startsWith('awsui-'))).toEqual([]);

    scheme.setDark(false);
    expect(root).not.toHaveClass('awsui-dark-mode');
    // Cloudscape's own overlays follow the root's mode through a mutation observer, a moment later.
    await waitFor(() => {
      expect(document.querySelector('.awsui-dark-mode')).toBeNull();
    });

    scheme.setDark(true);
    expect(root).toHaveClass('awsui-dark-mode');
    expect(document.body).not.toHaveClass('awsui-dark-mode');
    expect(document.documentElement).not.toHaveClass('awsui-dark-mode');
  });

  it('leaves no Cloudscape class in the document after leaving the area for /', async () => {
    scheme.dark = true;
    const { router } = open('/aws/s3');
    expect(cloudscapeElements().length).toBeGreaterThan(0);

    await act(() => router.navigate('/'));

    expect(screen.getByText("Studio's Home")).toBeInTheDocument();
    expect(cloudscapeElements()).toEqual([]);
    expect([...document.documentElement.classList].filter((name) => name.startsWith('awsui-'))).toEqual([]);
    expect([...document.body.classList].filter((name) => name.startsWith('awsui-'))).toEqual([]);
  });
});
