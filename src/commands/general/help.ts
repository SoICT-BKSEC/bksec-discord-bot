import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../types';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hướng dẫn sử dụng các lệnh CTF cơ bản'),

  async execute(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
      .setTitle('BKSEC CTF Bot - Hướng dẫn nhanh')
      .setColor(0xd50000)
      .setDescription('Tham số trong `<...>` là bắt buộc; tham số trong `[...]` là tùy chọn.')
      .addFields(
        {
          name: 'Tra cứu CTF',
          value:
            '`/ct-info_find search-key:<ID hoặc tên>` - Tìm giải trên CTFTime.\n' +
            '`/ct-info_ongo` - Xem các giải đang diễn ra.\n' +
            '`/ct-info_upco [page] [step]` - Xem các giải sắp diễn ra.\n' +
            '`/c-list [order] [page] [step]` - Xem các giải đã đăng ký trong server.\n' +
            '`/c-view ctf-name:<role>` - Hiện hoặc ẩn khu vực của một CTF.',
        },
        {
          name: 'Challenge',
          value:
            '`/challenge create name:<tên> [extra_category] [points]` - Tạo và tự tham gia thread; chưa tự claim.\n' +
            '`/challenge category-add name:<tên>` - Admin tạo category riêng như hardware hoặc blockchain.\n' +
            '`/challenge list [page] [category]` - Xem toàn bộ challenge; có nút đổi trang.\n' +
            '`/challenge claim` - Tham gia làm challenge hiện tại.\n' +
            '`/challenge release` - Rời challenge hiện tại.\n' +
            '`/challenge status value:<trạng thái>` - Cập nhật tiến độ.\n' +
            '`/challenge dashboard` - Làm mới dashboard của giải.\n' +
            '`/solved` - Đánh dấu challenge đã giải và tạo task write-up.',
        },
        {
          name: 'Write-up',
          value:
            '`/writeup claim` - Nhận viết write-up trong thread đã solved.\n' +
            '`/writeup release` - Trả lại task nếu claim nhầm; admin có thể gỡ giúp.\n' +
            '`/writeup submit url:<https://...>` - Nộp bài và đăng thông tin tại #writeups.',
        },
        {
          name: 'Đăng ký giải - Admin',
          value:
            '`/ct-reg ctftime-id:<ID>` - Đăng ký giải từ CTFTime.\n' +
            '`/admin-reg_special name:<tên> start_at:<giờ> end_at:<giờ>` - Đăng ký giải thủ công hoặc HTB.\n' +
            '`/ct-regacc username:<tên> password:<mật khẩu> [cate_id]` - Cập nhật tài khoản dùng chung.\n' +
            '`/admin-set-time start_at:<giờ> end_at:<giờ> [hide_after]` - Sửa lịch giải.',
        },
        {
          name: 'Quy trình cơ bản',
          value:
            '`Đăng ký giải -> tạo challenge -> claim -> /solved -> claim write-up -> submit URL`\n' +
            'Các lệnh challenge cần role CTF đang hoạt động hoặc quyền Administrator.',
        }
      )
      .setFooter({ text: 'Dùng lệnh trong đúng channel hoặc challenge thread tương ứng.' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default command;
