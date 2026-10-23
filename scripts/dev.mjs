// Starts the backend and the Vite dev server together with prefixed output.
// Ctrl+C stops both. Kept dependency-free on purpose (no `concurrently`).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('server/.env')) {
  console.error('Missing server/.env. Copy server/.env.example to server/.env and add your API keys.');
  process.exit(1);
}

const processes = [
  { name: 'server', color: '\x1b[36m', dir: 'server' },
  { name: 'client', color: '\x1b[35m', dir: 'client' },
].map(({ name, color, dir }) => {
  // shell: true so `npm` resolves to npm.cmd on Windows.
  const child = spawn('npm', ['run', 'dev'], { cwd: dir, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${color}[${name}]\x1b[0m `;
  const forward = (stream, target) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) target.write(`${prefix}${line}\n`);
      }
    });
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown();
  });
  return child;
});

console.log('\nOpen http://localhost:5173 in Chrome once both are ready. Ctrl+C to stop.\n');

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
