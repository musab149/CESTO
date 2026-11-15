#!/usr/bin/env node
/**
 * Free a TCP port on Windows or POSIX before starting a dev server.
 *
 * Why this exists: ts-node-dev and Vite both orphan child processes on
 * Windows when the parent terminal closes without a proper SIGINT (VS Code
 * tab close, force-quit, terminal crash). The orphans keep holding the
 * port, so the next `npm run dev` either fails or silently binds to a
 * different port — both surface as "nothing works locally" the next day.
 *
 * Usage:
 *   node scripts/kill-port.mjs 3000
 *   node scripts/kill-port.mjs 3000 5174 5199   # multi-port ok
 *
 * Safe: if the port is already free, this is a no-op. If the holder is a
 * legit dev server, killing it is the correct thing — you're about to
 * start a fresh one on the same port.
 */
import { execSync } from 'node:child_process';

const ports = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
if (ports.length === 0) {
  console.log('[kill-port] no ports given, nothing to do');
  process.exit(0);
}

const isWindows = process.platform === 'win32';

for (const port of ports) {
  const pids = findPidsOnPort(port);
  if (pids.length === 0) {
    console.log(`[kill-port] ${port} is already free`);
    continue;
  }
  for (const pid of pids) {
    try {
      if (isWindows) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } else {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      }
      console.log(`[kill-port] ${port}: killed PID ${pid}`);
    } catch {
      // Process already gone or permission denied — either way, move on.
    }
  }
}

function findPidsOnPort(port) {
  try {
    if (isWindows) {
      // netstat -ano outputs columns like:
      //   TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12345
      const out = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pids = new Set();
      const target = `:${port}`;
      for (const line of out.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        if (!line.includes(target)) continue;
        // Last token on the line is the PID.
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      return [...pids];
    }
    // POSIX
    const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
