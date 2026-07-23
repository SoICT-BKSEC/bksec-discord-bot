import { CTFData, CTFEmbedData } from '../types';

export interface LoginField {
  name: string;
  value: string;
  inline?: boolean;
}

export function buildLoginField(username?: string, password?: string): LoginField {
  const safeUsername = username
    ?.replace(/`/g, 'ˋ')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const safePassword = password?.replace(/\|/g, '∣').replace(/[\r\n]+/g, '↵');

  return {
    name: 'Login',
    value:
      safeUsername && safePassword
        ? `Username: \`${safeUsername}\`\nPassword: ||${safePassword}||`
        : 'Đang chờ quản trị viên cập nhật bằng `/ct-regacc`.',
  };
}

export function buildManualCredentialEmbed(
  ctf: CTFData,
  username: string,
  password: string
): CTFEmbedData {
  const start = ctf.starttime ?? 0;
  const end = ctf.competitionEndtime || ctf.endtime;
  const fields: CTFEmbedData['fields'] = [buildLoginField(username, password)];

  if (start > 0 && end > start) {
    fields.push({
      name: 'Time',
      value: `Start: <t:${start}:F>\nEnd: <t:${end}:F>`,
    });
  }

  fields.push({ name: 'Source', value: 'Manual / non-CTFtime event' });

  return {
    title: `${ctf.name} — Shared Account`,
    description: 'Tài khoản dùng chung cho thành viên tham gia CTF.',
    color: 0xd50000,
    footer: 'Credentials are removed automatically when the competition ends.',
    fields,
  };
}
