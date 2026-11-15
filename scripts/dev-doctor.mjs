#!/usr/bin/env node
/**
 * One-shot local dev environment diagnosis.
 *
 * Answers these three questions in ~1 second:
 *   1. Which dev ports are taken and by whom?
 *   2. Are there orphaned node processes (holding no port, no attached TTY)?
 *   3. Does the local API respond on /api/health?
 *
 * Usage:  npm run dev:doctor
 * Also available as:  node scripts/dev-doctor.mjs
 */
import { execSync } from 'node:child_process';
import { request } from 'node:http';

const PORTS = {
  3000: 'API (packages/api)',
  5199: 'Web (apps/web)',
  5174: 'Admin (apps/admin)',
  8081: 'Mobile Metro (apps/mobile)',
  5432: 'Postgres',
};

const isWindows = process.platform === 'win32';

console.log('\n=== DEV DOCTOR ===\n');

// ── 1. Port occupancy ─────────────────────────────────
console.log('Ports of interest:\n');
for (const [port, label] of Object.entries(PORTS)) {
  const pids = findPidsOnPort(Number(port));
  if (pids.length === 0) {
    console.log(`  ${port}  free            ${label}`);
  } else if (pids.length === 1) {
    console.log(`  ${port}  PID ${pids[0].padEnd(6)}    ${label}`);
  } else {
    console.log(`  ${port}  ⚠ ${pids.length} listeners (${pids.join(', ')})  ${label}`);
  }
}

// ── 2. Node process summary ────────────────────────────
console.log('\nNode processes:\n');
try {
  if (isWindows) {
    const out = execSync(
      'powershell -NoProfile "Get-Process node -ErrorAction SilentlyContinue | Sort-Object StartTime | ForEach-Object { \\"{0},{1},{2},{3}\\" -f $_.Id,$_.StartTime,[math]::Round($_.CPU,1),[math]::Round($_.WorkingSet64/1MB,0) }"',
      { encoding: 'utf8' },
    );
    let count = 0;
    for (const line of out.trim().split(/\r?\n/)) {
      if (!line) continue;
      const [pid, startTime, cpu, mem] = line.split(',');
      const started = new Date(startTime);
      const ageMs = Date.now() - started.getTime();
      const ageHrs = Math.floor(ageMs / 3_600_000);
      const ageMin = Math.floor((ageMs % 3_600_000) / 60_000);
      const flag = ageHrs >= 6 ? ' ⚠ old' : '';
      console.log(`  PID ${pid.padEnd(6)}  age ${String(ageHrs).padStart(2, '0')}:${String(ageMin).padStart(2, '0')}  cpu ${String(cpu).padStart(6)}s  mem ${String(mem).padStart(4)}MB${flag}`);
      count++;
    }
    if (count === 0) console.log('  (none)');
  } else {
    const out = execSync('ps -o pid,etime,rss,command -C node --no-headers', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    console.log(out.trim() || '  (none)');
  }
} catch {
  console.log('  (unable to enumerate)');
}

// ── 3. API health check ────────────────────────────────
console.log('\nAPI health:');
const healthy = await ping('http://localhost:3000/api/health', 1500);
console.log(`  http://localhost:3000/api/health  →  ${healthy}`);

// ── Suggestions ────────────────────────────────────────
console.log('\nHints:');
console.log('  • Zombies eating CPU or memory?     npm run dev:clean');
console.log('  • DB schema changed since API boot? npm run dev:reset');
console.log('  • Vite serving stale code?          hard-reload the browser (Ctrl+Shift+R)');
console.log('');

function findPidsOnPort(port) {
  try {
    if (isWindows) {
      const out = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pids = new Set();
      const target = `:${port}`;
      for (const line of out.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        if (!line.includes(target)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function ping(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8').slice(0, 80);
        resolve(`HTTP ${res.statusCode} — ${body}`);
      });
    });
    req.on('error', (err) => resolve(`unreachable (${err.code || err.message})`));
    req.on('timeout', () => {
      req.destroy();
      resolve('timed out (server hung?)');
    });
    req.end();
  });
}
