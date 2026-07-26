import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Guild,
  TextChannel,
} from 'discord.js';
import databaseService from './database.service';
import { CHALLENGE_CATEGORIES, CTFChallenge, CTFData, ChallengeStatus } from '../types';
import logger from '../utils/logger';
import { config } from '../config/env';
import { formatChallengeCategories } from '../utils/challenge-category';

export const CHALLENGE_LIST_OPEN_PREFIX = 'challenge_list_open:';
export const CHALLENGE_LIST_PAGE_PREFIX = 'challenge_list_page:';
export const CHALLENGE_LIST_ALL_CATEGORIES = '*';
export const CHALLENGE_PAGE_SIZE = 10;

export interface ChallengeListPage {
  embed: EmbedBuilder;
  controls: ActionRowBuilder<ButtonBuilder>;
  totalPages: number;
}

export const statusSymbols: Record<ChallengeStatus, string> = {
  unclaimed: '[OPEN]',
  working: '[ACTIVE]',
  idea: '[LEAD]',
  solved: '[SOLVED]',
};

export function fitDashboardLines(lines: string[], limit = 1024): string {
  if (lines.length === 0) return 'Chưa có challenge';

  const included: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const remaining = lines.length - index - 1;
    const suffix = remaining > 0 ? `\n… còn ${remaining} challenge · bấm Xem challenges` : '';
    const candidate = [...included, lines[index]].join('\n') + suffix;
    if (candidate.length > limit) break;
    included.push(lines[index]);
  }

  const omitted = lines.length - included.length;
  const suffix = omitted > 0 ? `\n… còn ${omitted} challenge · bấm Xem challenges` : '';
  return `${included.join('\n')}${suffix}`.slice(0, limit);
}

class ChallengeService {
  private readOnlyChannelCreations = new Map<string, Promise<TextChannel | null>>();

  private challengeListLine(challenge: CTFChallenge): string {
    const categories = formatChallengeCategories(challenge.categories);
    const points = challenge.points ? ` · ${challenge.points} pts` : '';
    let attribution = '';

    if (challenge.status === 'solved' && challenge.solvedBy) {
      attribution = ` · xác nhận bởi <@${challenge.solvedBy}>`;
    } else if (challenge.claimantIds.length > 0) {
      const visible = challenge.claimantIds.slice(0, 4).map((id) => `<@${id}>`);
      const remaining = challenge.claimantIds.length - visible.length;
      attribution = ` · ${visible.join(', ')}${remaining > 0 ? ` +${remaining}` : ''}`;
    }

    return `${statusSymbols[challenge.status]} <#${challenge.threadId}> · ${categories}${points}${attribution}`.slice(
      0,
      380
    );
  }

  dashboardControls(ctfId: number, disabled = false): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CHALLENGE_LIST_OPEN_PREFIX}${ctfId}`)
        .setLabel('Xem challenges')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    );
  }

  challengeListPage(
    ctfId: number,
    ctfName: string,
    challenges: CTFChallenge[],
    page: number,
    categoryFilter: string | null = null
  ): ChallengeListPage | null {
    if (challenges.length === 0) return null;

    const totalPages = Math.ceil(challenges.length / CHALLENGE_PAGE_SIZE);
    if (!Number.isInteger(page) || page < 1 || page > totalPages) return null;

    const start = (page - 1) * CHALLENGE_PAGE_SIZE;
    const lines = challenges
      .slice(start, start + CHALLENGE_PAGE_SIZE)
      .map((challenge) => this.challengeListLine(challenge))
      .join('\n');
    const categoryToken = categoryFilter ?? CHALLENGE_LIST_ALL_CATEGORIES;
    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CHALLENGE_LIST_PAGE_PREFIX}${ctfId}:${page - 1}:${categoryToken}`)
        .setLabel('Trang trước')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 1),
      new ButtonBuilder()
        .setCustomId(`${CHALLENGE_LIST_PAGE_PREFIX}${ctfId}:${page + 1}:${categoryToken}`)
        .setLabel('Trang sau')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === totalPages)
    );
    const embed = new EmbedBuilder()
      .setTitle(`${ctfName} — Challenges`)
      .setColor(0xd50000)
      .setDescription(lines)
      .setFooter({
        text: `Trang ${page}/${totalPages} · ${challenges.length} challenge${
          categoryFilter ? ` · ${categoryFilter.toUpperCase()}` : ''
        }`,
      });

    return { embed, controls, totalPages };
  }

  async dashboardChannel(guild: Guild, ctf: CTFData): Promise<TextChannel | null> {
    if (ctf.channel !== '0') {
      const infoChannel = await guild.channels.fetch(ctf.channel).catch(() => null);
      if (infoChannel?.type === ChannelType.GuildText) return infoChannel;
    }
    return this.notificationChannel(guild, ctf);
  }

  private async configureReadOnlyChannel(
    guild: Guild,
    channel: TextChannel,
    ctf: CTFData
  ): Promise<void> {
    const readOnlyRoleIds = [config.ACTIVE_CTF_ROLEID, config.VIEW_ALL_CTF_ROLEID, ctf.role].filter(
      Boolean
    );

    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    for (const roleId of new Set(readOnlyRoleIds)) {
      await channel.permissionOverwrites.edit(roleId, { SendMessages: false });
    }

    if (guild.members.me) {
      await channel.permissionOverwrites.edit(guild.members.me, {
        ViewChannel: true,
        SendMessages: true,
      });
    }
  }

  private async readOnlyChannel(
    guild: Guild,
    ctf: CTFData,
    channelName: 'announcements' | 'solved'
  ): Promise<TextChannel | null> {
    const category = await guild.channels.fetch(ctf.cate).catch(() => null);
    if (category?.type !== ChannelType.GuildCategory) return null;

    const existingChannel = category.children.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.name === channelName
    );
    let targetChannel: TextChannel | null =
      existingChannel?.type === ChannelType.GuildText ? existingChannel : null;

    if (!targetChannel) {
      const creationKey = `${category.id}:${channelName}`;
      let pending = this.readOnlyChannelCreations.get(creationKey);
      if (!pending) {
        pending = guild.channels
          .create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            reason: `CTF ${channelName} for ${ctf.name}`,
          })
          .then((channel) => channel)
          .catch((error) => {
            logger.warn(`Could not create ${channelName} channel for ${ctf.name}:`, error);
            return null;
          });
        this.readOnlyChannelCreations.set(creationKey, pending);
      }

      targetChannel = await pending;
      this.readOnlyChannelCreations.delete(creationKey);
    }

    if (!targetChannel || targetChannel.type !== ChannelType.GuildText) return null;
    await this.configureReadOnlyChannel(guild, targetChannel, ctf).catch((error) => {
      logger.warn(`Could not make ${channelName} read-only for ${ctf.name}:`, error);
    });
    return targetChannel;
  }

  async notificationChannel(guild: Guild, ctf: CTFData): Promise<TextChannel | null> {
    return this.readOnlyChannel(guild, ctf, 'announcements');
  }

  async solvedChannel(guild: Guild, ctf: CTFData): Promise<TextChannel | null> {
    return this.readOnlyChannel(guild, ctf, 'solved');
  }

  threadName(challenge: CTFChallenge): string {
    const claimCount =
      challenge.status !== 'solved' && challenge.claimantIds.length > 0
        ? ` (${challenge.claimantIds.length})`
        : '';
    return `${statusSymbols[challenge.status]} ${challenge.name}${claimCount}`.slice(0, 100);
  }

  async refreshDashboard(guild: Guild, ctfKey: string, ctf: CTFData): Promise<void> {
    const ctfId = Number(ctfKey);
    const challenges = await databaseService.getChallengesByCTF(ctfId);
    const now = Math.floor(Date.now() / 1000);
    const end = ctf.competitionEndtime || ctf.endtime;
    const solved = challenges.filter((challenge) => challenge.status === 'solved');
    const working = challenges.filter(
      (challenge) => challenge.status === 'working' || challenge.status === 'idea'
    );

    const dashboardCategories = [
      ...new Set([...CHALLENGE_CATEGORIES, ...challenges.flatMap(({ categories }) => categories)]),
    ];
    const categoryLines = dashboardCategories
      .map((category) => {
        const categoryChallenges = challenges.filter((challenge) =>
          challenge.categories.includes(category)
        );
        if (categoryChallenges.length === 0) return null;
        const categorySolved = categoryChallenges.filter(
          (challenge) => challenge.status === 'solved'
        ).length;
        return `**${category.toUpperCase()}**: ${categorySolved}/${categoryChallenges.length}`;
      })
      .filter((line): line is string => line !== null)
      .join('\n');

    const challengeLines = challenges.map((challenge) => {
      const attribution =
        challenge.status === 'solved'
          ? challenge.solvedBy
            ? ` — xác nhận bởi <@${challenge.solvedBy}>`
            : ''
          : challenge.claimantIds.length
            ? ` — ${challenge.claimantIds.map((id) => `<@${id}>`).join(', ')}`
            : '';
      const points = challenge.points ? ` (${challenge.points} pts)` : '';
      return `${statusSymbols[challenge.status]} <#${challenge.threadId}>${attribution}${points}`;
    });

    const time = end > now ? `Kết thúc <t:${end}:R> · <t:${end}:f>` : 'Đã kết thúc';
    const embed = new EmbedBuilder()
      .setTitle(`${ctf.name} — Progress ${solved.length}/${challenges.length}`.slice(0, 256))
      .setColor(0xd50000)
      .setDescription(
        `${time}\n\n[SOLVED] **${solved.length}** · [ACTIVE] **${working.length}** · [TOTAL] **${challenges.length}**`
      )
      .addFields(
        { name: 'Theo category', value: categoryLines || 'Chưa có challenge' },
        { name: 'Challenges', value: fitDashboardLines(challengeLines) }
      )
      .setTimestamp();

    const targetChannel = await this.dashboardChannel(guild, ctf);
    if (!targetChannel) throw new Error('Dashboard channel not found');
    await this.solvedChannel(guild, ctf).catch((error) => {
      logger.warn(`Could not ensure solved channel for ${ctf.name}:`, error);
    });
    const components = [this.dashboardControls(ctfId, challenges.length === 0)];

    const existing = await databaseService.getDashboard(ctfId);
    if (existing?.channelId === targetChannel.id) {
      const message = await targetChannel.messages.fetch(existing.messageId).catch(() => null);
      if (message) {
        await message.edit({ embeds: [embed], components });
        return;
      }
    }

    const message = await targetChannel.send({ embeds: [embed], components });
    await message.pin().catch((error) => {
      logger.warn(`Could not pin dashboard for ${ctf.name}:`, error);
    });
    await databaseService.setDashboard(ctfId, targetChannel.id, message.id);

    if (existing && existing.messageId !== message.id) {
      const oldChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
      if (oldChannel?.type === ChannelType.GuildText) {
        const oldMessage = await oldChannel.messages.fetch(existing.messageId).catch(() => null);
        await oldMessage?.delete().catch(() => undefined);
      }
    }
  }

  async renameThread(guild: Guild, challenge: CTFChallenge): Promise<void> {
    const channel = await guild.channels.fetch(challenge.threadId).catch(() => null);
    if (channel?.isThread()) await channel.setName(this.threadName(challenge));
  }

  async announce(guild: Guild, ctf: CTFData, content: string): Promise<void> {
    const channel = await this.notificationChannel(guild, ctf);
    if (!channel) throw new Error(`No announcement channel for ${ctf.name}`);
    await channel.send({ content, allowedMentions: { parse: ['users'] } });
  }

  async announceSolved(guild: Guild, ctf: CTFData, content: string): Promise<void> {
    const channel = await this.solvedChannel(guild, ctf);
    if (!channel) throw new Error(`No solved channel for ${ctf.name}`);
    await channel.send({ content, allowedMentions: { parse: ['users'] } });
  }
}

export default new ChallengeService();
