import assert from 'node:assert/strict';
import { runBestEffortTasks } from '../utils/best-effort';

async function run(): Promise<void> {
  const never = new Promise<void>(() => undefined);
  const startedAt = Date.now();
  const results = await runBestEffortTasks(
    [
      { name: 'success', run: async () => undefined },
      {
        name: 'failure',
        run: async () => {
          throw new Error('expected failure');
        },
      },
      { name: 'timeout', run: () => never },
    ],
    25
  );

  assert.ok(Date.now() - startedAt < 500, 'a stuck task must not block the batch indefinitely');
  assert.equal(results[0]?.error, undefined);
  assert.equal(results[0]?.timedOut, false);
  assert.match(String(results[1]?.error), /expected failure/);
  assert.equal(results[1]?.timedOut, false);
  assert.equal(results[2]?.timedOut, true);
  assert.match(String(results[2]?.error), /timed out/);

  await assert.rejects(() => runBestEffortTasks([], 0), /positive finite/);
  console.log('best-effort tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
