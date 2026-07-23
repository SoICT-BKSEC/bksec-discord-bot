import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function run(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bksec-command-schema-'));
  process.env.DB_PATH = path.join(directory, 'test.db');
  process.env.SERVER_ID = '100000000000000001';
  process.env.BOT_TOKEN = 'test-token';
  process.env.VIEW_ALL_CTF_ROLEID = '100000000000000002';
  process.env.ACTIVE_CTF_ROLEID = '100000000000000003';
  process.env.ADMIN_ROLE_ID = '100000000000000004';

  const databaseService = (await import('../services/database.service')).default;

  try {
    const challengeCommand = (await import('../commands/general/challenge')).default.data.toJSON();
    const solveCommand = (await import('../commands/general/solve')).default.data.toJSON();
    const create = challengeCommand.options?.find((option) => option.name === 'create');
    const createOptions = 'options' in (create ?? {}) ? (create?.options ?? []) : [];
    const extraCategory = createOptions.find((option) => option.name === 'extra_category');

    assert.equal(
      createOptions.some((option) => option.name === 'category'),
      false,
      'create should not require selecting the primary category'
    );
    assert.ok(extraCategory, 'create should expose an optional extra category');
    assert.notEqual(extraCategory.required, true, 'extra category should be optional');
    assert.equal(solveCommand.name, 'solved', 'solve command should be registered as /solved');
    assert.deepEqual(solveCommand.options ?? [], [], '/solved should not require any options');

    console.log('challenge command schema tests passed');
  } finally {
    databaseService.close();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.DB_PATH;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
