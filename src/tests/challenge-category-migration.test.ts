import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

async function run(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bksec-category-migration-'));
  const databasePath = path.join(directory, 'legacy.db');
  const legacyDatabase = new Database(databasePath);

  legacyDatabase.exec(`
    CREATE TABLE ctf_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ctf_id INTEGER NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unclaimed',
      claimed_by TEXT,
      claimed_at INTEGER,
      claimant_ids TEXT NOT NULL DEFAULT '[]',
      solver_ids TEXT NOT NULL DEFAULT '[]',
      solved_by TEXT,
      solved_at INTEGER,
      writeup_owner TEXT,
      writeup_url TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    INSERT INTO ctf_challenges
      (ctf_id, thread_id, channel_id, name, category)
    VALUES (1, 'legacy-thread', 'legacy-channel', 'legacy-web', 'web');
  `);
  legacyDatabase.close();

  process.env.DB_PATH = databasePath;
  const databaseService = (await import('../services/database.service')).default;

  try {
    const challenge = await databaseService.getChallengeByThread('legacy-thread');
    assert.deepEqual(
      challenge?.categories,
      ['web'],
      'legacy primary category should be migrated into the categories array'
    );
    console.log('challenge category migration tests passed');
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
