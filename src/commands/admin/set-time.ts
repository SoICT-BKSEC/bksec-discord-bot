import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import challengeService from '../../services/challenge.service';
import { config } from '../../config/env';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embed.builder';
import { requireAdmin } from '../../utils/role.guard';
import {
  buildManualCTFSchedule,
  DEFAULT_MANUAL_ARCHIVE_DAYS,
  manualScheduleErrorMessage,
} from '../../utils/ctf-datetime';
import logger from '../../utils/logger';

async function currentCategoryId(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const channel = interaction.channel;
  if (!channel || !interaction.guild) return null;

  if (channel.isThread()) {
    if (!channel.parentId) return null;
    const parent = await interaction.guild.channels.fetch(channel.parentId).catch(() => null);
    return parent && 'parentId' in parent ? parent.parentId : null;
  }

  return 'parentId' in channel ? channel.parentId : null;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-set-time')
    .setDescription('Sửa lịch cho một CTF thủ công đã đăng ký')
    .addStringOption((option) =>
      option
        .setName('start_at')
        .setDescription('Bắt đầu: YYYY-MM-DD HH:mm (UTC+7), ISO hoặc Unix timestamp')
        .setMaxLength(64)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('end_at')
        .setDescription('Kết thúc: YYYY-MM-DD HH:mm (UTC+7), ISO hoặc Unix timestamp')
        .setMaxLength(64)
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('hide_after')
        .setDescription('Số ngày sau khi kết thúc trước khi archive (mặc định 7)')
        .setMinValue(0)
        .setMaxValue(365)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('cate_id')
        .setDescription('Discord Category ID; tự nhận diện nếu bỏ trống')
        .setMaxLength(20)
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;
      if (!interaction.guild) return;

      await interaction.deferReply({ ephemeral: true });

      const categoryId =
        interaction.options.getString('cate_id')?.trim() || (await currentCategoryId(interaction));
      if (!categoryId || !/^\d{17,20}$/.test(categoryId)) {
        await interaction.editReply({
          embeds: [
            errorEmbed('Không tìm thấy Category ID hợp lệ. Hãy chạy lệnh trong category CTF.'),
          ],
        });
        return;
      }

      const ctf = await databaseService.findByCategoryId(categoryId);
      if (!ctf) {
        await interaction.editReply({
          embeds: [errorEmbed('Category này chưa được đăng ký trong database.')],
        });
        return;
      }
      if (ctf.data.ctftimeid !== 0) {
        await interaction.editReply({
          embeds: [errorEmbed('Lệnh này chỉ sửa CTF thủ công không thuộc CTFtime.')],
        });
        return;
      }
      if (ctf.data.archived || ctf.data.channelsPurged) {
        await interaction.editReply({
          embeds: [errorEmbed('Không thể sửa lịch của CTF đã archive hoặc đã xóa channel.')],
        });
        return;
      }

      const archiveAfterDays =
        interaction.options.getInteger('hide_after') ?? DEFAULT_MANUAL_ARCHIVE_DAYS;
      const scheduleResult = buildManualCTFSchedule(
        interaction.options.getString('start_at', true),
        interaction.options.getString('end_at', true),
        archiveAfterDays
      );
      if (!scheduleResult.ok) {
        await interaction.editReply({
          embeds: [errorEmbed(manualScheduleErrorMessage(scheduleResult.error))],
        });
        return;
      }

      const schedule = scheduleResult.schedule;
      if (schedule.endTime <= Math.floor(Date.now() / 1000)) {
        await interaction.editReply({
          embeds: [errorEmbed('Giờ kết thúc phải nằm trong tương lai.')],
        });
        return;
      }

      await databaseService.updateCTFSchedule(ctf.key, schedule);

      const followUpFailures: string[] = [];
      await discordService
        .applyLivePermissions(interaction.guild, ctf.data.cate, ctf.data.role)
        .catch((error) => {
          followUpFailures.push('cập nhật quyền category');
          logger.warn(
            `Permission refresh failed after schedule update for ${ctf.data.name}:`,
            error
          );
        });
      await challengeService
        .refreshDashboard(interaction.guild, ctf.key, {
          ...ctf.data,
          starttime: schedule.startTime,
          competitionEndtime: schedule.endTime,
          endtime: schedule.archiveAt,
          postEndOpened: false,
        })
        .catch((error) => {
          followUpFailures.push('cập nhật dashboard');
          logger.warn(
            `Dashboard refresh failed after schedule update for ${ctf.data.name}:`,
            error
          );
        });
      await challengeService
        .announce(
          interaction.guild,
          ctf.data,
          `[SCHEDULE UPDATED] **${ctf.data.name}**\n` +
            `Starts: <t:${schedule.startTime}:F> (<t:${schedule.startTime}:R>)\n` +
            `Ends: <t:${schedule.endTime}:F> (<t:${schedule.endTime}:R>)`
        )
        .catch((error) => {
          followUpFailures.push('gửi thông báo lịch mới');
          logger.warn(`Schedule announcement failed for ${ctf.data.name}:`, error);
        });

      const summary =
        `**${ctf.data.name}**\n` +
        `Bắt đầu: <t:${schedule.startTime}:F>\n` +
        `Kết thúc: <t:${schedule.endTime}:F>\n` +
        `Archive: <t:${schedule.archiveAt}:F>\n` +
        'Các reminder cũ đã được reset.';

      await interaction.editReply({
        embeds: [
          followUpFailures.length
            ? warningEmbed(
                'Đã lưu lịch nhưng còn cảnh báo',
                `${summary}\nChưa hoàn tất: ${followUpFailures.join(', ')}.`
              )
            : successEmbed(summary),
        ],
      });

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
        if (logChannel?.isTextBased()) {
          await logChannel
            .send(
              `${interaction.user.username} updated schedule for ***${ctf.data.name}***; start=${schedule.startTime}, end=${schedule.endTime}, archive=${schedule.archiveAt}`
            )
            .catch((error) => logger.warn('Could not write schedule-update audit log:', error));
        }
      }
    } catch (error) {
      logger.error('Error in admin-set-time command:', error);
      const payload = { embeds: [errorEmbed('Không thể cập nhật lịch CTF.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
