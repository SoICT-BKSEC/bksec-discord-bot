import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function run(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bksec-challenge-'));
  process.env.DB_PATH = path.join(directory, 'test.db');
  const databaseService = (await import('../services/database.service')).default;

  try {
    const ctfId = await databaseService.addCTF({
      ctftimeid: 1,
      role: '1',
      cate: '2',
      name: 'Test CTF',
      infom: '3',
      channel: '4',
      endtime: 300,
      starttime: 100,
      competitionEndtime: 200,
    });
    const storedCTF = await databaseService.findByKey(String(ctfId));
    assert.equal(storedCTF?.data.endtime, 300, 'archive time should be stored separately');
    assert.equal(storedCTF?.data.competitionEndtime, 200);

    assert.equal(
      await databaseService.isManagedDiscordChannel('manual-category'),
      false,
      'pre-existing Discord resources must default to manual ownership'
    );
    await databaseService.registerManagedDiscordChannel({
      channelId: 'bot-category',
      kind: 'category',
    });
    await databaseService.registerManagedDiscordChannel({
      channelId: 'bot-child',
      parentCategoryId: 'bot-category',
      kind: 'system',
    });
    assert.equal(await databaseService.isManagedDiscordChannel('bot-category'), true);
    assert.deepEqual(
      await databaseService.getManagedDiscordChannelIds('bot-category'),
      new Set(['bot-child'])
    );
    await databaseService.removeManagedDiscordCategory('bot-category');
    assert.equal(await databaseService.isManagedDiscordChannel('bot-category'), false);
    assert.equal(await databaseService.isManagedDiscordChannel('bot-child'), false);

    const legacyId = await databaseService.addCTF({
      ctftimeid: 2,
      role: 'legacy-role',
      cate: 'legacy-category',
      name: 'Legacy buffered CTF',
      infom: 'legacy-message',
      channel: 'legacy-channel',
      endtime: 700_000,
    });
    databaseService.ensureDatabase();
    const migratedCTF = await databaseService.findByKey(String(legacyId));
    assert.equal(
      migratedCTF?.data.competitionEndtime,
      95_200,
      'legacy CTFtime rows should recover the actual competition end time'
    );

    const customCategory = await databaseService.registerChallengeCategory({
      ctfId,
      name: 'hardware',
      channelId: '11',
      createdBy: '97',
    });
    assert.equal(customCategory.name, 'hardware');
    assert.equal((await databaseService.findChallengeCategoryByChannel('11'))?.ctfId, ctfId);
    assert.deepEqual(
      (await databaseService.getChallengeCategories(ctfId)).map(({ name }) => name),
      ['hardware']
    );

    const challenge = await databaseService.createChallenge({
      ctfId,
      threadId: '10',
      channelId: '11',
      name: 'heap',
      category: 'hardware',
      categories: ['hardware', 'web', 'hardware'],
      points: 500,
    });
    assert.equal(challenge.status, 'unclaimed');
    assert.deepEqual(challenge.categories, ['hardware', 'web']);

    const firstClaim = await databaseService.addChallengeClaimant(challenge.id, '98');
    assert.equal(firstClaim.added, true);
    assert.deepEqual(firstClaim.challenge.claimantIds, ['98']);

    const secondClaim = await databaseService.addChallengeClaimant(challenge.id, '99');
    assert.equal(secondClaim.added, true);
    assert.deepEqual(secondClaim.challenge.claimantIds, ['98', '99']);

    const duplicateClaim = await databaseService.addChallengeClaimant(challenge.id, '99');
    assert.equal(duplicateClaim.added, false);

    const released = await databaseService.removeChallengeClaimant(challenge.id, '98');
    assert.equal(released.removed, true);
    assert.deepEqual(released.challenge.claimantIds, ['99']);

    const solved = await databaseService.solveChallenge({
      challengeId: challenge.id,
      recordedBy: '97',
      solvedAt: 150,
    });
    assert.equal(solved.status, 'solved');
    assert.deepEqual(solved.solverIds, []);
    assert.equal(solved.solvedBy, '97');
    assert.equal(solved.points, 500);
    assert.equal((await databaseService.getSolvedChallenges(ctfId)).length, 1);

    const writeupClaim = await databaseService.claimChallengeWriteup(challenge.id, '96');
    assert.equal(writeupClaim.added, true);
    assert.equal(writeupClaim.challenge.writeupOwner, '96');
    const competingWriteupClaim = await databaseService.claimChallengeWriteup(challenge.id, '95');
    assert.equal(competingWriteupClaim.added, false);
    assert.equal(competingWriteupClaim.challenge.writeupOwner, '96');
    const unauthorizedRelease = await databaseService.releaseChallengeWriteup(challenge.id, '95');
    assert.equal(unauthorizedRelease.released, false);
    assert.equal(unauthorizedRelease.challenge.writeupOwner, '96');
    const writeupRelease = await databaseService.releaseChallengeWriteup(challenge.id, '96');
    assert.equal(writeupRelease.released, true);
    assert.equal(writeupRelease.challenge.writeupOwner, undefined);
    const secondWriteupClaim = await databaseService.claimChallengeWriteup(challenge.id, '95');
    assert.equal(secondWriteupClaim.added, true);
    const adminRelease = await databaseService.releaseChallengeWriteup(challenge.id, '97', true);
    assert.equal(adminRelease.released, true);
    assert.equal(adminRelease.challenge.writeupOwner, undefined);

    await assert.rejects(
      databaseService.solveChallenge({
        challengeId: challenge.id,
        recordedBy: '97',
        solvedAt: 151,
      }),
      /already solved/
    );

    const reopened = await databaseService.undoChallengeSolve(challenge.id);
    assert.equal(reopened.status, 'working');
    assert.deepEqual(reopened.solverIds, []);
    assert.equal((await databaseService.getSolvedChallenges(ctfId)).length, 0);

    assert.equal((await databaseService.getChallengesByCTF(ctfId)).length, 1);
    await databaseService.setDashboard(ctfId, '11', '12');
    assert.equal((await databaseService.getDashboard(ctfId))?.messageId, '12');

    assert.equal(await databaseService.markReminderSent(ctfId, 'started'), true);
    assert.equal(await databaseService.markReminderSent(ctfId, 'started'), false);
    await databaseService.removeReminder(ctfId, 'started');
    assert.equal(await databaseService.markReminderSent(ctfId, 'started'), true);

    await databaseService.updateCTF(String(ctfId), { postEndOpened: true });
    await databaseService.updateCTFSchedule(String(ctfId), {
      startTime: 1_000,
      endTime: 2_000,
      archiveAt: 3_000,
    });
    const rescheduledCTF = await databaseService.findByKey(String(ctfId));
    assert.equal(rescheduledCTF?.data.starttime, 1_000);
    assert.equal(rescheduledCTF?.data.competitionEndtime, 2_000);
    assert.equal(rescheduledCTF?.data.endtime, 3_000);
    assert.equal(rescheduledCTF?.data.postEndOpened, false);
    assert.equal(
      await databaseService.markReminderSent(ctfId, 'started'),
      true,
      'rescheduling should clear persisted milestones'
    );

    console.log('challenge database tests passed');
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
