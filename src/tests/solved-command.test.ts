import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatInputCommandInteraction } from 'discord.js';

async function run(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bksec-solved-command-'));
  process.env.DB_PATH = path.join(directory, 'test.db');
  process.env.SERVER_ID = '100000000000000001';
  process.env.BOT_TOKEN = 'test-token';
  process.env.VIEW_ALL_CTF_ROLEID = '100000000000000002';
  process.env.ACTIVE_CTF_ROLEID = '100000000000000003';
  process.env.ADMIN_ROLE_ID = '100000000000000004';

  const databaseService = (await import('../services/database.service')).default;
  const challengeService = (await import('../services/challenge.service')).default;
  const solveCommand = (await import('../commands/general/solve')).default;
  const originalMethods = {
    renameThread: challengeService.renameThread,
    announceSolved: challengeService.announceSolved,
    refreshDashboard: challengeService.refreshDashboard,
  };

  const pendingResolvers: Array<() => void> = [];
  const pending = () =>
    new Promise<void>((resolve) => {
      pendingResolvers.push(resolve);
    });

  try {
    const ctfId = await databaseService.addCTF({
      ctftimeid: 1,
      role: 'ctf-role',
      cate: 'ctf-category',
      name: 'Responsive CTF',
      infom: 'info-message',
      channel: 'info-channel',
      endtime: 3_000,
      starttime: 1_000,
      competitionEndtime: 2_000,
    });
    await databaseService.createChallenge({
      ctfId,
      threadId: 'challenge-thread',
      channelId: 'web-channel',
      name: 'Never Block',
      category: 'web',
      points: 100,
    });

    challengeService.renameThread = async () => pending();
    challengeService.announceSolved = async () => pending();
    challengeService.refreshDashboard = async () => pending();

    const replies: unknown[] = [];
    let deferred = false;
    const interaction = {
      guild: {},
      channel: {
        id: 'challenge-thread',
        isThread: () => true,
        send: () => pending(),
      },
      member: {
        roles: { cache: { has: (roleId: string) => roleId === process.env.ACTIVE_CTF_ROLEID } },
        permissions: { has: () => false },
      },
      user: { id: 'solver-user' },
      get deferred() {
        return deferred;
      },
      replied: false,
      deferReply: async () => {
        deferred = true;
      },
      editReply: async (payload: unknown) => {
        replies.push(payload);
      },
      reply: async (payload: unknown) => {
        replies.push(payload);
      },
    } as unknown as ChatInputCommandInteraction;

    await Promise.race([
      solveCommand.execute(interaction),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('/solved waited for follow-up tasks')), 500)
      ),
    ]);

    assert.equal(replies.length, 1, '/solved should acknowledge immediately after persistence');
    assert.equal(
      (await databaseService.getChallengeByThread('challenge-thread'))?.status,
      'solved'
    );
    assert.equal(pendingResolvers.length, 4, 'all follow-up tasks should start in the background');

    for (const resolve of pendingResolvers) resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    challengeService.renameThread = originalMethods.renameThread;
    challengeService.announceSolved = originalMethods.announceSolved;
    challengeService.refreshDashboard = originalMethods.refreshDashboard;
    databaseService.close();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.DB_PATH;
  }
}

run()
  .then(() => console.log('solved command tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
