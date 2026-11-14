// The suite's Playwright reporter. It prints each check's verdict from the verdict file the check wrote (already
// redacted in the worker that knows the secrets) and nothing of the raw error, so an emulator key or a session token
// an assertion saw never reaches the test output. Errors outside any check (a spec that does not compile) are
// printed as they are: they come from source files, not from a run.

import type { FullResult, Reporter, TestCase, TestError, TestResult } from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';

export default class VerdictReporter implements Reporter {
  private readonly verdicts = process.env.EMUFORGE_IT_VERDICTS ?? '';

  onTestEnd(test: TestCase, result: TestResult): void {
    const file = path.join(this.verdicts, `${test.title}.json`);
    let line: string;
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8')) as { verdict: string; message: string; seconds: number };
      const first = record.message.split('\n').find((l) => l.trim() !== '') ?? '';
      line = `${record.verdict.padEnd(7)} ${test.title} (${record.seconds}s)  ${first.slice(0, 200)}`;
    } catch {
      line = `error   ${test.title}  the check wrote no verdict (Playwright status ${result.status})`;
    }
    process.stdout.write(`studio: ${line}\n`);
  }

  onError(error: TestError): void {
    process.stdout.write(`studio: error outside any check: ${error.message ?? error.value ?? ''}\n`);
  }

  onEnd(result: FullResult): void {
    process.stdout.write(`studio: playwright run ${result.status}\n`);
  }

  printsToStdio(): boolean {
    return true;
  }
}
