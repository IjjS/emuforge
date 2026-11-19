// Invoking a Lambda function from its page in the built app, in front of a real engine and the run's emulator
// (issue 516, test-criteria.md, "Integration"; requirement "Test (task 2)"): the event a developer types reaches the
// function, and what the function returns and the end of its log are shown as they came; a function that fails and
// an invocation the emulator refuses each say so.
//
// `studio.lambda-invoke-shows-result-and-log-tail`, `studio.lambda-invoke-shows-function-errors-and-refusals`.
//
// Every function is the check's own code, made directly under the check's prefix `<p>`. Words and readers:
// `services/lambda/lambda-tasks.ts`; direct calls: `services/lambda/lambda.ts`.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { deleteFunctionDirect, invokeDirect, LambdaSeeded } from './services/lambda/lambda';
import { functionPage, NOT_FOUND } from './services/lambda/lambda-page';
import {
  echoZip,
  FUNCTION_ERROR,
  invokeWith,
  LOG_TAIL,
  MARKUP,
  markupZip,
  NODE_ECHO,
  NOT_INVOKED,
  NOT_JSON,
  openOnTest,
  outputText,
  PYTHON,
  PYTHON_HANDLER,
  raisesZip,
  REFUSED,
  RESPONSE,
  resultText,
  Sent,
  slowZip,
  SUCCEEDED,
  testTab,
} from './services/lambda/lambda-tasks';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';

test('studio.lambda-invoke-shows-result-and-log-tail', async ({ ctx, page, context }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfi-result');
  const seeded = new LambdaSeeded(ctx, port, p);
  const sent = Sent.attach(context, stack.engine.url);
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });
  const echo = `${p}-echo`;
  const node = `${p}-node`;
  const markup = `${p}-markup`;
  await seeded.function(echo, { runtime: PYTHON.id, code: { zip: echoZip('v1'), handler: PYTHON_HANDLER } });
  await seeded.function(node, { runtime: NODE_ECHO.runtime, code: { zip: NODE_ECHO.zip(), handler: NODE_ECHO.handler } });
  await seeded.function(markup, { runtime: PYTHON.id, code: { zip: markupZip(), handler: PYTHON_HANDLER } });
  const t = testTab(page);

  await lines.line(
    'Open S2 of echo → the tab "Test" is selected, "Event JSON" holds `{}`, "Result" says "Not invoked yet"; "Invoke" → "Succeeded", "Response" is the text the function returned (`{"got": {}, "version": "v1"}` as the emulator wrote it), "Log tail" holds the function\'s own line and a line starting `REPORT`',
    async () => {
      await openOnTest(page, echo);
      await expect(functionPage(page, echo).tab('Test'), 'the tab "Test"').toHaveAttribute('aria-selected', 'true');
      await expect(t.event, '"Event JSON" as the page opens').toHaveValue('{}');
      await expect(t.notInvoked, `"${NOT_INVOKED}"`).toBeVisible();
      const direct = await invokeDirect(ctx, port, echo, {});
      expect(direct.status, `a direct Invoke ${echo}`).toBe(200);
      await invokeWith(page, echo);
      await expect.poll(() => resultText(page), { message: 'the outcome' }).toContain(SUCCEEDED);
      const response = await outputText(page, RESPONSE);
      ctx.log(`"${RESPONSE}": ${JSON.stringify(response)}; a direct Invoke returned ${JSON.stringify(direct.payload)}`);
      expect(response, `"${RESPONSE}" is what a direct Invoke returns`).toBe(direct.payload);
      expect(JSON.parse(response ?? 'null'), `"${RESPONSE}" as JSON`).toEqual({ got: {}, version: 'v1' });
      const log = (await outputText(page, LOG_TAIL)) ?? '';
      const logLines = log.split('\n');
      expect(logLines, `"${LOG_TAIL}" holds the function's own line`).toContain('echo-line None');
      expect(
        logLines.some((l) => l.startsWith('REPORT')),
        `"${LOG_TAIL}" holds a line starting REPORT: ${JSON.stringify(log)}`,
      ).toBe(true);
    },
  );

  await lines.line(
    'The event `{"tag": "<prefix>-a", "n": [1, 2]}`, "Invoke" → the response holds that event as the function got it, and the log tail the line `echo-line <prefix>-a`',
    async () => {
      await openOnTest(page, echo);
      const event = { tag: `${p}-a`, n: [1, 2] };
      await invokeWith(page, echo, `{"tag": "${p}-a", "n": [1, 2]}`);
      await expect.poll(() => resultText(page), { message: 'the outcome' }).toContain(SUCCEEDED);
      const response = await outputText(page, RESPONSE);
      expect(JSON.parse(response ?? 'null'), `"${RESPONSE}"`).toEqual({ got: event, version: 'v1' });
      const log = (await outputText(page, LOG_TAIL)) ?? '';
      expect(log.split('\n'), `"${LOG_TAIL}"`).toContain(`echo-line ${p}-a`);
    },
  );

  await lines.line(
    'The event `"just text"` (a JSON string), "Invoke" → "Succeeded" and the response holds `"just text"`',
    async () => {
      await openOnTest(page, echo);
      await invokeWith(page, echo, '"just text"');
      await expect.poll(() => resultText(page), { message: 'the outcome' }).toContain(SUCCEEDED);
      expect(JSON.parse((await outputText(page, RESPONSE)) ?? 'null'), `"${RESPONSE}"`).toEqual({
        got: 'just text',
        version: 'v1',
      });
    },
  );

  await lines.line(
    'S2 of node echo, the event `{"k": "v"}`, "Invoke" → "Succeeded" and the response holds `{"k":"v"}` as that function got it',
    async () => {
      await openOnTest(page, node);
      await invokeWith(page, node, '{"k": "v"}');
      await expect.poll(() => resultText(page), { message: 'the outcome' }).toContain(SUCCEEDED);
      const response = (await outputText(page, RESPONSE)) ?? '';
      expect(response, `"${RESPONSE}" holds the event as written by the function`).toContain('{"k":"v"}');
      expect(JSON.parse(response), `"${RESPONSE}" as JSON`).toEqual({ got: { k: 'v' } });
    },
  );

  await lines.line(
    'The event text `{"tag": ` (cut short), "Invoke" → "Enter the event as one JSON value." at the field, the result of the invoke before it is still shown, and no request to invoke left the page',
    async () => {
      await openOnTest(page, echo);
      await invokeWith(page, echo, `{"tag": "${p}-before"}`);
      await expect.poll(() => outputText(page, LOG_TAIL), { message: 'the result before' }).toContain(
        `echo-line ${p}-before`,
      );
      const before = sent.invokes(echo);
      await t.event.fill('{"tag": ', ACTION);
      await t.invoke.click(ACTION);
      await expect(t.notJson, `"${NOT_JSON}"`).toBeVisible();
      expect(await outputText(page, LOG_TAIL), 'the result of the invoke before, still shown').toContain(
        `echo-line ${p}-before`,
      );
      // A request the click had sent would have left by the time the message is drawn; one more turn of the page
      // (a read of the document) comes after it.
      await page.evaluate(() => document.title);
      expect(sent.invokes(echo), `Invoke requests for ${echo} after the refused text`).toBe(before);
    },
  );

  await lines.line(
    '"Invoke" (markup) → the response and the log tail show `<img src=x onerror=alert(1)>` as text; the page holds no image made from it and no dialog opened',
    async () => {
      await openOnTest(page, markup);
      await invokeWith(page, markup);
      await expect.poll(() => resultText(page), { message: 'the outcome' }).toContain(SUCCEEDED);
      expect(await outputText(page, RESPONSE), `"${RESPONSE}"`).toContain(MARKUP);
      expect(await outputText(page, LOG_TAIL), `"${LOG_TAIL}"`).toContain(MARKUP);
      const images = await page.evaluate(() =>
        [...document.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? ''),
      );
      expect(images, 'images of the page').not.toContain('x');
      expect(dialogs, 'dialogs the page opened').toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-invoke-shows-function-errors-and-refusals', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfi-errors');
  const seeded = new LambdaSeeded(ctx, port, p);
  const raises = `${p}-raises`;
  const slow = `${p}-slow`;
  const java = `${p}-java`;
  const echo = `${p}-echo`;
  const boom = `boom-${p}`;
  await seeded.function(raises, { runtime: PYTHON.id, code: { zip: raisesZip(boom), handler: PYTHON_HANDLER } });
  await seeded.function(slow, { runtime: PYTHON.id, timeout: 1, code: { zip: slowZip(), handler: PYTHON_HANDLER } });
  await seeded.function(java, { runtime: 'java21', code: { zip: echoZip('v1'), handler: 'example.Handler' } });
  await seeded.function(echo, { runtime: PYTHON.id, code: { zip: echoZip('v1'), handler: PYTHON_HANDLER } });

  await lines.line(
    'S2 of raises, "Invoke" → "The function returned an error" with `Unhandled`; the response holds `boom-<prefix>`; the log tail holds the traceback\'s line with `boom-<prefix>`',
    async () => {
      await openOnTest(page, raises);
      await invokeWith(page, raises);
      await expect.poll(() => resultText(page), { message: 'the outcome' }).toContain(`${FUNCTION_ERROR}: Unhandled`);
      expect(await outputText(page, RESPONSE), `"${RESPONSE}"`).toContain(boom);
      const log = (await outputText(page, LOG_TAIL)) ?? '';
      expect(
        log.split('\n').some((l) => l.includes(boom)),
        `"${LOG_TAIL}" holds a line with ${boom}: ${JSON.stringify(log)}`,
      ).toBe(true);
    },
  );

  await lines.line(
    'S2 of slow, "Invoke" → "The function returned an error" with `Unhandled`, and the response holds `Sandbox.Timedout` and "Task timed out after 1.00 seconds"',
    async () => {
      await openOnTest(page, slow);
      await invokeWith(page, slow);
      await expect.poll(() => resultText(page), { message: 'the outcome' }).toContain(`${FUNCTION_ERROR}: Unhandled`);
      const response = (await outputText(page, RESPONSE)) ?? '';
      expect(response, `"${RESPONSE}"`).toContain('Sandbox.Timedout');
      expect(response, `"${RESPONSE}"`).toContain('Task timed out after 1.00 seconds');
    },
  );

  await lines.line(
    'S2 of the `java21` function, "Invoke" → "The invocation was refused" with `InvalidRuntimeException` and the emulator\'s message that it runs the Python and node runtimes; no response and no log tail are shown',
    async () => {
      const direct = await invokeDirect(ctx, port, java, {});
      ctx.log(`a direct Invoke ${java}: ${String(direct.status)} ${String(direct.errorType)} ${direct.payload}`);
      expect(direct.errorType, `a direct Invoke ${java}`).toBe('InvalidRuntimeException');
      const refusal = JSON.parse(direct.payload) as { message?: string; Message?: string };
      const message = refusal.message ?? refusal.Message ?? '';
      expect(message, "the emulator's message").toContain('Python and node runtimes');
      await openOnTest(page, java);
      await invokeWith(page, java);
      await expect.poll(() => resultText(page), { message: 'the outcome' }).toContain(REFUSED);
      const shown = await resultText(page);
      expect(shown, 'the code as it came').toContain('InvalidRuntimeException');
      expect(shown, 'the message as it came').toContain(message);
      expect(await outputText(page, RESPONSE), `"${RESPONSE}"`).toBeNull();
      expect(await outputText(page, LOG_TAIL), `"${LOG_TAIL}"`).toBeNull();
    },
  );

  await lines.line(
    'S2 of echo open, the function deleted directly, "Invoke" → "The invocation was refused" with `ResourceNotFoundException`, and the page then shows "Function not found"',
    async () => {
      await openOnTest(page, echo);
      const deleted = await deleteFunctionDirect(ctx, port, echo);
      expect('error' in deleted ? deleted.error : deleted.status, `direct DeleteFunction ${echo}`).toBe(204);
      const refused = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/2015-03-31/functions/${echo}/invocations`,
        { timeout: 20_000 },
      );
      await testTab(page).invoke.click(ACTION);
      // The refusal is on the page only until the read it causes answers, so its code is read from the answer the
      // page got; what stays to be seen is "Function not found".
      const answer = await refused;
      const code = `${answer.headers()['x-amzn-errortype'] ?? ''} ${await answer.text().catch(() => '')}`;
      expect(code, "the refusal the page got for the invoke").toContain('ResourceNotFoundException');
      await expect(functionPage(page, echo).notFound, `"${NOT_FOUND}" after the refusal`).toBeVisible();
    },
  );

  lines.end();
});
