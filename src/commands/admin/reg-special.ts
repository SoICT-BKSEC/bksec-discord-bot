import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import { successEmbed, errorEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';
import challengeService from '../../services/challenge.service';
import {
  buildManualCTFSchedule,
  DEFAULT_MANUAL_ARCHIVE_DAYS,
  manualScheduleErrorMessage,
} from '../../utils/ctf-datetime';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-reg_special')
    .setDescription('Đăng kí giải CTF thủ công (không trên CTFTime) cho server')
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Tên của giải CTF muốn tạo')
        .setMaxLength(80)
        .setRequired(true)
    )
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
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    let createdCategoryId: string | undefined;
    let createdRoleId: string | undefined;
    let databaseId: number | undefined;

    try {
      if (!(await requireAdmin(interaction))) return;
      if (!interaction.guild) return;

      await interaction.deferReply();
      const name = interaction.options.getString('name', true).trim();
      const startInput = interaction.options.getString('start_at', true);
      const endInput = interaction.options.getString('end_at', true);
      const days = interaction.options.getInteger('hide_after') ?? DEFAULT_MANUAL_ARCHIVE_DAYS;
      if (!name) {
        await interaction.editReply({ embeds: [errorEmbed('Tên CTF không được để trống.')] });
        return;
      }

      const scheduleResult = buildManualCTFSchedule(startInput, endInput, days);
      if (!scheduleResult.ok) {
        await interaction.editReply({
          embeds: [errorEmbed(manualScheduleErrorMessage(scheduleResult.error))],
        });
        return;
      }
      const schedule = scheduleResult.schedule;
      const now = Math.floor(Date.now() / 1000);
      if (schedule.endTime <= now) {
        await interaction.editReply({
          embeds: [errorEmbed('Giờ kết thúc phải nằm trong tương lai.')],
        });
        return;
      }

      const duplicate = (await databaseService.getAllCTFs()).some(
        (ctf) => ctf.data.name.toLocaleLowerCase() === name.toLocaleLowerCase()
      );
      if (duplicate) {
        await interaction.editReply({
          embeds: [warningEmbed('CTF đã tồn tại', 'Đã có một CTF cùng tên trong database.')],
        });
        return;
      }

      const created = await discordService.createSpecialCTFCategory(interaction.guild, name);
      if (!created) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to create CTF category')] });
        return;
      }

      const { category, role, infoChannel, generalChannel } = created;
      createdCategoryId = category.id;
      createdRoleId = role.id;

      try {
        databaseId = await databaseService.addCTF({
          ctftimeid: 0,
          role: role.id,
          cate: category.id,
          name,
          infom: '0',
          channel: infoChannel.id,
          endtime: schedule.archiveAt,
          starttime: schedule.startTime,
          competitionEndtime: schedule.endTime,
        });
      } catch (error) {
        logger.error(`Core manual registration failed for ${name}:`, error);
        await discordService.rollbackCTFCreation(interaction.guild, category.id, role.id);
        await interaction.editReply({
          embeds: [
            errorEmbed('Registration failed and partial Discord resources were rolled back.'),
          ],
        });
        return;
      }

      const registeredCTF = await databaseService.findByKey(String(databaseId));
      if (registeredCTF) {
        await challengeService
          .refreshDashboard(interaction.guild, registeredCTF.key, registeredCTF.data)
          .catch((error) => logger.warn(`Initial dashboard failed for ${name}:`, error));
      }

      await discordService
        .syncEndedCTFs(interaction.guild)
        .catch((error) => logger.warn('Could not synchronize ended CTF permissions:', error));

      let archived = 0;
      let archiveFailed = 0;
      const expiredCTFs = await databaseService.getExpiredCTFs(Math.floor(Date.now() / 1000));
      for (const ctf of expiredCTFs) {
        if (!(await discordService.archiveCTFRecord(interaction.guild, ctf.key, ctf.data))) {
          archiveFailed++;
          continue;
        }
        archived++;
      }

      await interaction.editReply({
        embeds: [
          successEmbed(
            `Đã tạo channel cho <***${name}***>.\n` +
              `Bắt đầu: <t:${schedule.startTime}:F> · Kết thúc: <t:${schedule.endTime}:F>.\n` +
              `Archive: <t:${schedule.archiveAt}:F>.\n` +
              `Đăng thông tin tại <#${infoChannel.id}>; thảo luận tại <#${generalChannel.id}>.` +
              (archiveFailed ? `\nAuto-archive failed: ${archiveFailed}` : '')
          ),
        ],
      });

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
        if (logChannel?.isTextBased()) {
          await logChannel
            .send(
              `${interaction.user.username} manually created ***${name}***; start=${schedule.startTime}, end=${schedule.endTime}, archive=${schedule.archiveAt}; auto-archived=${archived}, failed=${archiveFailed}`
            )
            .catch((error) => logger.warn('Could not write manual registration log:', error));
        }
      }

      logger.info(
        `User ${interaction.user.tag} created special CTF: ${name} (${schedule.startTime}-${schedule.endTime}, archive +${days} days)`
      );
    } catch (error) {
      logger.error('Error in admin-reg_special command:', error);
      if (databaseId === undefined && interaction.guild && (createdCategoryId || createdRoleId)) {
        await discordService.rollbackCTFCreation(
          interaction.guild,
          createdCategoryId,
          createdRoleId
        );
      }

      const payload = { embeds: [errorEmbed('Không thể đăng ký CTF thủ công.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
