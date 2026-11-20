import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { TokenPage } from '../../../components/use-token-listing';
import * as choices from '../definition-choices';
import type { Service } from '../service-api';
import * as api from '../service-change-api';
import { UpdateServiceDialog } from './update-service-dialog';

// The dialog sends `UpdateService` itself; the call of `service-change-api.ts` and the page of revision choices are
// answered by the case.

vi.mock('../service-change-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../service-change-api')>();
  return { ...real, updateService: vi.fn() };
});

const readRevisions = vi.fn<() => Promise<TokenPage<choices.RevisionChoice>>>();

vi.mock('../definition-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../definition-choices')>();
  return {
    ...real,
    revisionChoices: vi.fn((endpoint: string | undefined, family: string | undefined) => ({
      ...real.revisionChoices(endpoint, family),
      read: readRevisions,
    })),
  };
});

const ENGINE = 'http://127.0.0.1:8320';

function service(changes: Partial<Service> = {}): Service {
  return {
    name: 'api',
    status: 'ACTIVE',
    desired: 2,
    running: 2,
    definition: { family: 'web', revision: 3 },
    deployments: [],
    events: [],
    ...changes,
  };
}

const revision = (number: number): choices.RevisionChoice => ({
  value: `web:${String(number)}`,
  family: 'web',
  revision: number,
});

let onUpdated: ReturnType<typeof vi.fn<(name: string) => void>>;

/** The dialog inside an area's root, opened for `given` by an opener that closes it only on "Cancel". */
function InArea({ given }: { given: Service }) {
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <UpdateServiceDialog
          service={shown ? given : undefined}
          cluster="dev"
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onUpdated={onUpdated}
          onDismiss={() => {
            setShown(false);
          }}
        />
      </AreaRootContext>
    </div>
  );
}

function open(given = service()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (shown: Service) => (
    <QueryClientProvider client={client}>
      <InArea given={shown} />
    </QueryClientProvider>
  );
  const view = render(tree(given));
  return {
    reread: (shown: Service) => {
      view.rerender(tree(shown));
    },
  };
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field(label: string) {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
  if (found === undefined) {
    throw new Error(`no field ${label}`);
  }
  return found;
}

function revisionSelect() {
  const select = createWrapper(field('Revision').getElement()).findSelect();
  if (select === null) {
    throw new Error('no select');
  }
  return select;
}

function countInput(): HTMLInputElement {
  const input = field('Desired tasks').getElement().querySelector('input');
  if (input === null) {
    throw new Error('no input');
  }
  return input;
}

function update(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  onUpdated = vi.fn();
  readRevisions.mockResolvedValue({ items: [revision(5), revision(4)] });
});

describe('"Update service"', () => {
  it('open → "Desired tasks" with its constraint text, "Revision" with "Keep web:3" first then the active revisions, and "Force a new deployment"', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(field('Desired tasks').findConstraint()?.getElement())).toBe('A whole number, 0 or more.');
    expect(countInput().value).toBe('2');
    expect(within(dialog).getByRole('checkbox', { name: 'Force a new deployment' })).not.toBeChecked();
    const select = revisionSelect();
    expect(text(select.findTrigger().getElement())).toBe('Keep web:3');
    select.openDropdown();
    await waitFor(() => {
      expect(select.findDropdown().findOptions()).toHaveLength(3);
    });
    expect(
      select
        .findDropdown()
        .findOptions()
        .map((option) => text(option.getElement())),
    ).toEqual(['Keep web:3', 'web:5', 'web:4']);
    expect(choices.revisionChoices).toHaveBeenCalledWith(ENGINE, 'web');
  });

  it('the service\'s revision is not among the active ones → "Keep web:3" is still the preset', async () => {
    readRevisions.mockResolvedValue({ items: [revision(5)] });
    open();
    await screen.findByRole('dialog');
    const select = revisionSelect();
    select.openDropdown();
    await waitFor(() => {
      expect(select.findDropdown().findOptions()).toHaveLength(2);
    });
    select.closeDropdown();
    expect(text(select.findTrigger().getElement())).toBe('Keep web:3');
    update(screen.getByRole('dialog'));
    await waitFor(() => {
      expect(api.updateService).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(api.updateService).mock.calls[0]?.slice(0, 4)).toEqual([
      ENGINE,
      'dev',
      'api',
      { desiredCount: 2 },
    ]);
  });

  it('"Update" answered → the dialog is no longer shown and its opener is told once that the service was updated', async () => {
    vi.mocked(api.updateService).mockResolvedValue(undefined);
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(countInput(), { target: { value: '3' } });
    const select = revisionSelect();
    select.openDropdown();
    await waitFor(() => {
      expect(select.findDropdown().findOptionByValue('web:5')).not.toBeNull();
    });
    select.selectOptionByValue('web:5');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Force a new deployment' }));
    update(dialog);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(onUpdated).toHaveBeenCalledWith('api');
    expect(vi.mocked(api.updateService).mock.calls[0]?.slice(0, 4)).toEqual([
      ENGINE,
      'dev',
      'api',
      { desiredCount: 3, taskDefinition: 'web:5', forceNewDeployment: true },
    ]);
  });

  it('"Update" refused → the dialog stays open with "The emulator did not update the service." and the code and message, the values kept', async () => {
    vi.mocked(api.updateService).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'UpdateService',
        code: 'InvalidParameterException',
        message: 'Task definition does not exist.',
      }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(countInput(), { target: { value: '4' } });
    update(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toContain('The emulator did not update the service.');
    expect(text(alert)).toContain('InvalidParameterException');
    expect(text(alert)).toContain('Task definition does not exist.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(countInput().value).toBe('4');
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('the service is read as DRAINING while the dialog is open → "Update" still sends UpdateService', async () => {
    vi.mocked(api.updateService).mockResolvedValue(undefined);
    const { reread } = open();
    await screen.findByRole('dialog');
    // The opener hands the dialog the service as its page read it again.
    reread(service({ status: 'DRAINING' }));
    const dialog = await screen.findByRole('dialog');
    update(dialog);
    await waitFor(() => {
      expect(api.updateService).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledTimes(1);
    });
  });

  it('a count that fails its check → its message and nothing sent', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(countInput(), { target: { value: '1.5' } });
    update(dialog);
    expect(await within(dialog).findByText('Enter a whole number, 0 or more.')).toBeInTheDocument();
    expect(api.updateService).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
