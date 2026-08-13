import { spawn } from 'node:child_process';

const MAX_RAPID_RESTARTS = 5;
const STABLE_UPTIME_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

let child = null;
let stopping = false;
let rapidRestarts = 0;
let restartTimer = null;

function startBot() {
  const startedAt = Date.now();
  child = spawn(process.execPath, ['--enable-source-maps', 'dist/index.js'], {
    env: process.env,
    stdio: 'inherit',
  });

  child.once('error', (error) => {
    console.error('[supervisor] Could not start the bot process:', error);
  });

  child.once('close', (code, signal) => {
    child = null;
    if (stopping) {
      process.exitCode = code ?? 0;
      return;
    }

    const uptime = Date.now() - startedAt;
    rapidRestarts = uptime >= STABLE_UPTIME_MS ? 0 : rapidRestarts + 1;
    if (rapidRestarts > MAX_RAPID_RESTARTS) {
      console.error(
        `[supervisor] Bot stopped ${rapidRestarts} times in under ${STABLE_UPTIME_MS / 1000}s; giving up to avoid an infinite restart loop.`
      );
      process.exitCode = code ?? 1;
      return;
    }

    const delay = Math.min(1000 * 2 ** Math.max(rapidRestarts - 1, 0), MAX_BACKOFF_MS);
    console.error(
      `[supervisor] Bot exited unexpectedly (${signal ?? `code ${code ?? 'unknown'}`}); restarting in ${delay}ms.`
    );
    restartTimer = setTimeout(startBot, delay);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);

  if (!child) {
    process.exitCode = 0;
    return;
  }

  child.kill(signal);
  const forceTimer = setTimeout(() => child?.kill('SIGKILL'), 10_000);
  forceTimer.unref();
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

startBot();
