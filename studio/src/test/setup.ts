/// <reference types="node" />
import '@testing-library/jest-dom/vitest';
import process from 'node:process';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// Under Vitest the SDK clients take their Node configuration, which reads the shared files AWS_CONFIG_FILE and
// AWS_SHARED_CREDENTIALS_FILE name, or $HOME/.aws/config and $HOME/.aws/credentials when they are unset. Every test
// file points both at a fixed absolute path that does not exist and lies outside every home directory, whatever the
// starting shell held, so no unit test reads a developer's or the emulator's files.
const SHARED_FILES = {
  AWS_CONFIG_FILE: '/nonexistent/emuforge-studio-unit-tests/config',
  AWS_SHARED_CREDENTIALS_FILE: '/nonexistent/emuforge-studio-unit-tests/credentials',
} as const;

// Assigned, not stubbed: vi.unstubAllEnvs() in a test file restores what was here before its own stubs, which is the
// redirect, so the redirect holds after it as well.
function redirectSharedFiles(): void {
  for (const [name, path] of Object.entries(SHARED_FILES)) {
    process.env[name] = path;
  }
}

// Before the file's own hooks, its beforeAll included.
redirectSharedFiles();

// A test that sets either variable itself keeps its value for that test; the next test is redirected again.
beforeEach(() => {
  redirectSharedFiles();
});

afterEach(() => {
  cleanup();
});
