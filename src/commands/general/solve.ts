import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import { config } from '../../config/env';
import databaseService from '../../services/database.service';
import challengeService from '../../services/challenge.service';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embed.builder';
import { requireRole } from '../../utils/role.guard';
import logger from '../../utils/logger';
import { formatChallengeCategories } from '../../utils/challenge-category';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('solved')
    .setDescription('Đánh dấu challenge hiện tại là solved') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guild || !interaction.channel?.isThread()) {
        await interaction.reply({
          embeds: [errorEmbed('Hãy chạy `/solved` trong challenge thread.')],
          ephemeral: true,
        });
        return;
      }
      if (!(await requireRole(interaction, config.ACTIVE_CTF_ROLEID))) return;

      const challenge = await databaseService.getChallengeByThread(interaction.channel.id);
      if (!challenge) {
        await interaction.reply({
          embeds: [errorEmbed('Thread này chưa được đăng ký là challenge.')],
          ephemeral: true,
        });
        return;
      }
      if (challenge.status === 'solved') {
        await interaction.reply({
          embeds: [errorEmbed('Challenge này đã được đánh dấu solved.')],
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const ctf = await databaseService.findByKey(String(challenge.ctfId));
      if (!ctf) throw new Error('CTF not found');

      const solveTime = Math.floor(Date.now() / 1000);

      const updated = await databaseService.solveChallenge({
        challengeId: challenge.id,
        recordedBy: interaction.user.id,
        solvedAt: solveTime,
      });

      const followUpFailures: string[] = [];
      await challengeService.renameThread(interaction.guild, updated).catch((error) => {
        followUpFailures.push('đổi tên thread');
        logger.warn(`Could not rename solved thread ${challenge.threadId}:`, error);
      });

      await challengeService
        .announceSolved(
          interaction.guild,
          ctf.data,
          `[SOLVED] Chúc mừng! Challenge **${challenge.name}** đã được giải.\n` +
            `Category: **${formatChallengeCategories(challenge.categories)}**\n` +
            `Xác nhận bởi: <@${updated.solvedBy ?? interaction.user.id}>\n` +
            `Thread: <#${challenge.threadId}>`
        )
        .catch((error) => {
          followUpFailures.push('gửi thông báo');
          logger.warn(`Could not announce solve for ${challenge.name}:`, error);
        });

      await challengeService
        .refreshDashboard(interaction.guild, ctf.key, ctf.data)
        .catch((error) => {
          followUpFailures.push('cập nhật dashboard');
          logger.warn(`Could not refresh dashboard after solving ${challenge.name}:`, error);
        });

      await interaction.channel
        .send({
          content:
            `[WRITEUP TASK] **${challenge.name}** chưa có người nhận viết write-up.\n` +
            'Nhận task: `/writeup claim`\n' +
            'Nộp bài: `/writeup submit url:<link>`',
          allowedMentions: { parse: [] },
        })
        .catch((error) => {
          followUpFailures.push('tạo task write-up');
          logger.warn(`Could not create write-up task for ${challenge.name}:`, error);
        });

      await interaction.editReply({
        embeds: [
          followUpFailures.length === 0
            ? successEmbed(`Đã solve **${challenge.name}**.`)
            : warningEmbed(
                'Solve đã được lưu',
                `Không hoàn tất được: ${followUpFailures.join(', ')}.`
              ),
        ],
      });
    } catch (error) {
      logger.error('Solve failed:', error);
      const payload = { embeds: [errorEmbed('Không thể cập nhật solve.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
