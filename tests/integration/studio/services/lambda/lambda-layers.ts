import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';
import { expect, type Ctx } from '../../support';
import { checkPrefix } from '../../support/service-screens';
import { lambdaDirect, LambdaSeeded, storedZip, type Direct } from './lambda';
import { submitDialog } from './lambda-releases';
import { pythonZip, PYTHON, PYTHON_HANDLER, zipFile } from './lambda-tasks';

const base = ['2018-10-31', 'layers'];
interface Version { LayerVersionArn: string; Version: number }

function body<T>(reply: Direct, status = 200): T {
  if ('error' in reply) throw new Error(reply.error);
  expect(reply.status, reply.body).toBe(status);
  return JSON.parse(reply.body) as T;
}

export function layerFixture(ctx: Ctx, port: number, tag: string) {
  const prefix = checkPrefix(ctx, tag);
  const versionPath = (name: string) => [...base, name, 'versions'];
  const archive = (value: string) => storedZip('python/check_marker.py', 'value = ' + JSON.stringify(value));
  const versions = async (name: string) =>
    body<{ LayerVersions: Version[] }>(await lambdaDirect(ctx, port, 'GET', versionPath(name))).LayerVersions;
  const own = (name: string) => {
    ctx.own({ async dispose() {
      const listed = await lambdaDirect(ctx, port, 'GET', versionPath(name));
      if (!('error' in listed) && listed.status === 404) return;
      for (const item of body<{ LayerVersions: Version[] }>(listed).LayerVersions) {
        expect(await lambdaDirect(ctx, port, 'DELETE', [...versionPath(name), String(item.Version)])).toMatchObject({status: 204});
      }
    } });
    return name;
  };
  return {
    prefix, own, archive, versions,
    async publish(name: string, marker: string) {
      return body<Version>(await lambdaDirect(ctx, port, 'POST', versionPath(name), {}, {
        Content: { ZipFile: archive(marker).toString('base64') },
      }), 201);
    },
    async catalogue() {
      const names: string[] = [];
      let marker: string | undefined;
      do {
        const result: { Layers: { LayerName: string }[]; NextMarker?: string } = body(
          await lambdaDirect(ctx, port, 'GET', base, marker ? { Marker: marker } : {}),
        );
        names.push(...result.Layers.map(item => item.LayerName));
        marker = result.NextMarker;
      } while (marker);
      return names;
    },
    async createFunction() {
      const seeded = new LambdaSeeded(ctx, port, prefix);
      await seeded.function(prefix, { runtime: PYTHON.id, code: { handler: PYTHON_HANDLER, zip: pythonZip([
        'def lambda_handler(event, context):',
        '    try:',
        '        from check_marker import value',
        '        return value',
        '    except ModuleNotFoundError:',
        '        return "absent"',
      ].join('\n')) } });
    },
    async attachments() {
      const config = body<{ Layers?: { Arn: string }[] }>(
        await lambdaDirect(ctx, port, 'GET', ['2015-03-31', 'functions', prefix, 'configuration']),
      );
      return (config.Layers ?? []).map(item => item.Arn);
    },
  };
}

const wrap = createWrapper();
const modal = createWrapper(wrap.findModal().toSelector());
export const versionsTable = (page: Page) => page.locator(wrap.findTable().findRows().toSelector()).and(page.getByRole('table', { name: 'Versions', exact: true }).getByRole('row'));
export const attachedTable = (page: Page) => page.locator(wrap.findTable().toSelector())
  .filter({ has: page.getByRole('table', { name: 'Layers', exact: true }) });

export async function selectLayer(page: Page, name: string, latest: number) {
  const radio = page.getByRole('radio', {name, exact: true});
  const row = page.locator(wrap.findTable().findRows().toSelector()).filter({has: radio});
  await expect(row).toContainText(name);
  await expect(row).toHaveText(new RegExp(String(latest) + '$'));
  await radio.click();
}

export async function publishForm(page: Page, name: string, data: Buffer) {
  await page.getByRole('button', {name: 'Publish layer version'}).click();
  await page.locator(modal.findInput().findNativeInput().toSelector()).fill(name);
  await page.locator(modal.findFileUpload().findNativeInput().toSelector()).setInputFiles(zipFile('library.zip', data));
  await submitDialog(page, 'Publish layer version');
}

export const inlinePublicationError = (page: Page) => page.locator(modal.findAlert().toSelector());

export async function selectAttachment(page: Page, name: string, arn: string) {
  await page.getByRole('button', {name: 'Add layer version'}).click();
  for (const [index, value] of [name, arn].entries()) {
    const field = modal.findSelect();
    await page.locator(field.findTrigger().toSelector()).nth(index).click();
    await page.locator(field.findDropdown().findOptionByValue(value).toSelector()).click();
  }
}
