import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CTFChallenge } from '../types';

async function run(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bksec-challenge-list-'));
  process.env.DB_PATH = path.join(directory, 'test.db');
  process.env.SERVER_ID = '100000000000000001';
  process.env.BOT_TOKEN = 'test-token';
  process.env.VIEW_ALL_CTF_ROLEID = '100000000000000002';
  process.env.ACTIVE_CTF_ROLEID = '100000000000000003';
  process.env.ADMIN_ROLE_ID = '100000000000000004';

  const databaseService = (await import('../services/database.service')).default;

  try {
    const {
      default: challengeService,
      buildWriteupAnnouncementEmbed,
      CHALLENGE_LIST_OPEN_PREFIX,
      CHALLENGE_LIST_PAGE_PREFIX,
    } = await import('../services/challenge.service');
    const challenges: CTFChallenge[] = Array.from({ length: 23 }, (_, index) => ({
      id: index + 1,
      ctfId: 7,
      threadId: String(100000000000000100n + BigInt(index)),
      channelId: '100000000000000010',
      name: `Challenge ${index + 1}`,
      category: index % 2 === 0 ? 'web' : 'pwn',
      categories: [index % 2 === 0 ? 'web' : 'pwn'],
      points: 100,
      status: 'unclaimed',
      claimantIds: [],
      solverIds: [],
      createdAt: 1,
      updatedAt: 1,
    }));

    const dashboard = challengeService.dashboardControls(7).toJSON();
    assert.equal(dashboard.components.length, 1);
    assert.equal(dashboard.components[0].custom_id, `${CHALLENGE_LIST_OPEN_PREFIX}7`);
    assert.equal(dashboard.components[0].label, 'Xem challenges');

    const page = challengeService.challengeListPage(7, 'Test CTF', challenges, 2);
    assert.ok(page);
    assert.equal(page.totalPages, 3);
    const embed = page.embed.toJSON();
    assert.match(embed.footer?.text ?? '', /Trang 2\/3/);
    assert.match(embed.description ?? '', new RegExp(challenges[10].threadId));
    assert.match(embed.description ?? '', new RegExp(challenges[19].threadId));
    assert.doesNotMatch(embed.description ?? '', new RegExp(challenges[20].threadId));

    const controls = page.controls.toJSON().components;
    assert.equal(controls.length, 2);
    assert.equal(controls[0].custom_id, `${CHALLENGE_LIST_PAGE_PREFIX}7:1:*`);
    assert.equal(controls[0].disabled, false);
    assert.equal(controls[1].custom_id, `${CHALLENGE_LIST_PAGE_PREFIX}7:3:*`);
    assert.equal(controls[1].disabled, false);

    const firstFilteredPage = challengeService.challengeListPage(
      7,
      'Test CTF',
      challenges.filter((challenge) => challenge.category === 'web'),
      1,
      'web'
    );
    assert.ok(firstFilteredPage);
    assert.equal(firstFilteredPage.totalPages, 2);
    assert.equal(
      firstFilteredPage.controls.toJSON().components[1].custom_id,
      `${CHALLENGE_LIST_PAGE_PREFIX}7:2:web`
    );
    assert.equal(challengeService.challengeListPage(7, 'Test CTF', challenges, 4), null);
    assert.equal(challengeService.challengeListPage(7, 'Test CTF', [], 1), null);

    const writeupEmbed = buildWriteupAnnouncementEmbed(
      'Test CTF',
      { ...challenges[0], categories: ['web', 'misc'] },
      '100000000000000009',
      'https://example.com/writeups/challenge-1'
    ).toJSON();
    const writeupFields = Object.fromEntries(
      (writeupEmbed.fields ?? []).map((field) => [field.name, field.value])
    );
    assert.equal(writeupFields.Challenge, 'Challenge 1');
    assert.equal(writeupFields.Category, 'WEB / MISC');
    assert.equal(writeupFields['Người viết'], '<@100000000000000009>');
    assert.equal(writeupFields.Thread, `<#${challenges[0].threadId}>`);
    assert.match(writeupEmbed.description ?? '', /https:\/\/example\.com\/writeups\/challenge-1/);

    console.log('challenge list view tests passed');
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
