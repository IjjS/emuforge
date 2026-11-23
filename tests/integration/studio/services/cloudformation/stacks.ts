import {
  CloudFormationClient,
  CreateStackCommand,
  ListStacksCommand,
  type StackSummary,
} from "@aws-sdk/client-cloudformation";
import createWrapper from "@cloudscape-design/components/test-utils/selectors";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { EnvError, expect, type Ctx } from "../../support/check";
import { emulatorDir, readEmulatorFiles } from "../../support/emulator";
import { creationDateText, SEOUL } from "../../support/service-screens";

export function directStacks(ctx: Ctx, port: number) {
  const dir = emulatorDir(ctx.home, port);
  const credentials = readEmulatorFiles(dir);
  if (!credentials)
    throw new EnvError(
      "The dedicated emulator has not supplied its credentials.",
    );
  const client = new CloudFormationClient({
    endpoint: `https://127.0.0.1:${port}`,
    region: "us-east-1",
    disableHostPrefix: true,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    requestHandler: {
      httpsAgent: { ca: readFileSync(path.join(dir, "ca.pem")) },
    },
    maxAttempts: 1,
  });
  ctx.own({ dispose: async () => client.destroy() });
  return {
    async create(name: string) {
      const result = await client.send(
        new CreateStackCommand({
          StackName: name,
          TemplateBody: JSON.stringify({
            Description: `External stack ${name}`,
            Resources: { Bucket: { Type: "AWS::S3::Bucket" } },
          }),
        }),
      );
      if (!result.StackId)
        throw new Error(`CreateStack returned no ID for ${name}`);
      return result.StackId;
    },
    async list(token?: string) {
      const result = await client.send(
        new ListStacksCommand(token ? { NextToken: token } : {}),
      );
      return { rows: result.StackSummaries ?? [], next: result.NextToken };
    },
  };
}

export async function waitUntilCreated(
  direct: ReturnType<typeof directStacks>,
  id: string,
) {
  await expect
    .poll(
      async () => {
        const row = (await direct.list()).rows.find(
          (stack) => stack.StackId === id,
        );
        if (
          row?.StackStatus &&
          !["CREATE_IN_PROGRESS", "CREATE_COMPLETE"].includes(row.StackStatus)
        ) {
          throw new Error(
            `Stack creation ended with ${row.StackStatus}: ${row.StackStatusReason ?? ""}`,
          );
        }
        return row?.StackStatus;
      },
      {
        timeout: 45_000,
        message: `Direct ListStacks reports CREATE_COMPLETE for ${id}`,
      },
    )
    .toBe("CREATE_COMPLETE");
}

export function stacksScreen(page: Page) {
  const table = createWrapper().findTable();
  const rows = page.locator(table.findRows().toSelector());
  const cell = (row: number, column: number) =>
    page.locator(table.findBodyCell(row, column).toSelector());
  return {
    title: page.locator(
      table.findHeaderSlot().findHeader().findHeadingText().toSelector(),
    ),
    empty: page.locator(table.findEmptySlot().toSelector()),
    refresh: page.getByRole("button", { name: "Refresh", exact: true }),
    filter: page.getByRole("searchbox", { name: "Filter by stack name" }),
    next: page.locator(
      table.findPagination().findNextPageButton().toSelector(),
    ),
    async expectNames(summaries: StackSummary[]) {
      await expect(rows).toHaveCount(summaries.length);
      const names = await Promise.all(
        summaries.map((_, index) => cell(index + 1, 1).innerText()),
      );
      expect(names).toEqual(summaries.map((stack) => stack.StackName));
    },
    async expectDetails(summaries: StackSummary[]) {
      await expect(rows).toHaveCount(summaries.length);
      for (const [index, stack] of summaries.entries()) {
        const values = [
          stack.StackName!,
          stack.StackStatus!,
          creationDateText(stack.CreationTime!.toISOString(), SEOUL),
          stack.TemplateDescription!,
        ];
        for (const [column, value] of values.entries())
          await expect(cell(index + 1, column + 1)).toHaveText(value);
      }
    },
    rows,
  };
}
