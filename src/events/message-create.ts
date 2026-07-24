import { ChannelType, Message } from 'discord.js';
import databaseService from '../services/database.service';
import challengeService from '../services/challenge.service';
import { ChallengeCategory } from '../types';
import logger from '../utils/logger';
import {
  isDefaultChallengeCategory,
  normalizeChallengeCategoryName,
} from '../utils/challenge-category';

function cleanThreadName(name: string): string {
  return name
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\s(?:\(\d+\)|\[\d+\])$/, '')
    .trim();
}

export async function handleChallengeMessage(message: Message): Promise<void> {
  if (!message.guild || message.author.bot || !message.channel.isThread()) return;

  try {
    const thread = message.channel;
    const parent = thread.parentId
      ? await message.guild.channels.fetch(thread.parentId).catch(() => null)
      : null;
    if (!parent || parent.type !== ChannelType.GuildText || !parent.parentId) return;

    const ctf = await databaseService.findByCategoryId(parent.parentId);
    if (!ctf) return;

    const normalizedName = normalizeChallengeCategoryName(parent.name);
    let inferred: ChallengeCategory | null =
      normalizedName && isDefaultChallengeCategory(normalizedName) ? normalizedName : null;
    if (!inferred) {
      const registered = await databaseService.findChallengeCategoryByChannel(parent.id);
      if (registered?.ctfId !== Number(ctf.key)) return;
      inferred = registered.name;
    }

    let challenge = await databaseService.getChallengeByThread(thread.id);
    if (!challenge) {
      try {
        challenge = await databaseService.createChallenge({
          ctfId: Number(ctf.key),
          threadId: thread.id,
          channelId: parent.id,
          name: cleanThreadName(thread.name) || 'untitled-challenge',
          category: inferred,
          categories: [inferred],
          points: 0,
        });
      } catch {
        // Another message may have registered the thread concurrently.
        challenge = await databaseService.getChallengeByThread(thread.id);
      }
    }
    if (!challenge || challenge.status === 'solved') return;

    const result = await databaseService.addChallengeClaimant(challenge.id, message.author.id);
    if (!result.added) return;

    await challengeService.renameThread(message.guild, result.challenge);
    await challengeService.refreshDashboard(message.guild, ctf.key, ctf.data);
  } catch (error) {
    logger.error('Failed to auto-claim challenge from first message:', error);
  }
}
