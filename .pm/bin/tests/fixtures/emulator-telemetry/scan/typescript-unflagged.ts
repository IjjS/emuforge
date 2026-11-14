import { execFileSync } from 'node:child_process';

export function start(port: number): void {
  execFileSync('docker', ['run', '-d', '-p', `127.0.0.1:${port}:${port}`, 'aws-emulator', '-p', `${port}`]);
  const unused = ['-t', 'off'];
}
