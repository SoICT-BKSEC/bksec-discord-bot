const VIETNAM_UTC_OFFSET_SECONDS = 7 * 60 * 60;
const MAX_UNIX_SECONDS = 32_503_680_000; // 3000-01-01T00:00:00Z

export const DEFAULT_MANUAL_ARCHIVE_DAYS = 7;

export interface ManualCTFSchedule {
  startTime: number;
  endTime: number;
  archiveAt: number;
  archiveAfterDays: number;
}

export type ManualScheduleResult =
  | { ok: true; schedule: ManualCTFSchedule }
  | {
      ok: false;
      error: 'invalid_start' | 'invalid_end' | 'invalid_archive_days' | 'end_not_after_start';
    };

export function manualScheduleErrorMessage(
  error: Exclude<ManualScheduleResult, { ok: true }>['error']
): string {
  switch (error) {
    case 'invalid_start':
      return 'Giờ bắt đầu không hợp lệ. Dùng `YYYY-MM-DD HH:mm` (UTC+7), ISO 8601 hoặc Unix timestamp.';
    case 'invalid_end':
      return 'Giờ kết thúc không hợp lệ. Dùng `YYYY-MM-DD HH:mm` (UTC+7), ISO 8601 hoặc Unix timestamp.';
    case 'end_not_after_start':
      return 'Giờ kết thúc phải sau giờ bắt đầu.';
    case 'invalid_archive_days':
      return 'Số ngày chờ archive phải từ 0 đến 365.';
  }
}

function validUnixSeconds(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 && value < MAX_UNIX_SECONDS ? value : null;
}

function validDateParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): boolean {
  if (
    year < 1970 ||
    year > 2999 ||
    month < 1 ||
    month > 12 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return false;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Parse a CTF date supplied as:
 * - Unix seconds or a Discord timestamp (`<t:...>`)
 * - ISO 8601 with an explicit timezone
 * - `YYYY-MM-DD HH:mm[:ss]`, interpreted as Asia/Ho_Chi_Minh (UTC+7)
 */
export function parseCTFDateTime(input: string): number | null {
  const value = input.trim();
  if (!value) return null;

  const discordTimestamp = value.match(/^<t:(\d{1,11})(?::[tTdDfFR])?>$/);
  if (discordTimestamp) {
    return validUnixSeconds(Number(discordTimestamp[1]));
  }

  if (/^\d{1,11}$/.test(value)) {
    return validUnixSeconds(Number(value));
  }

  const localDateTime = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localDateTime) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] = localDateTime;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (!validDateParts(year, month, day, hour, minute, second)) {
      return null;
    }

    return validUnixSeconds(
      Math.floor(
        Date.UTC(year, month - 1, day, hour, minute, second) / 1000 - VIETNAM_UTC_OFFSET_SECONDS
      )
    );
  }

  const isoDateTime = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/
  );
  if (isoDateTime) {
    const [, year, month, day, hour, minute, second = '0', zone, offsetHour, offsetMinute] =
      isoDateTime;
    if (
      !validDateParts(
        Number(year),
        Number(month),
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      ) ||
      (zone !== 'Z' && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))
    ) {
      return null;
    }

    const milliseconds = Date.parse(value);
    if (Number.isFinite(milliseconds)) {
      return validUnixSeconds(Math.floor(milliseconds / 1000));
    }
  }

  return null;
}

export function buildManualCTFSchedule(
  startInput: string,
  endInput: string,
  archiveAfterDays = DEFAULT_MANUAL_ARCHIVE_DAYS
): ManualScheduleResult {
  const startTime = parseCTFDateTime(startInput);
  if (startTime === null) return { ok: false, error: 'invalid_start' };

  const endTime = parseCTFDateTime(endInput);
  if (endTime === null) return { ok: false, error: 'invalid_end' };

  if (!Number.isInteger(archiveAfterDays) || archiveAfterDays < 0 || archiveAfterDays > 365) {
    return { ok: false, error: 'invalid_archive_days' };
  }
  if (endTime <= startTime) return { ok: false, error: 'end_not_after_start' };

  return {
    ok: true,
    schedule: {
      startTime,
      endTime,
      archiveAt: endTime + archiveAfterDays * 86_400,
      archiveAfterDays,
    },
  };
}
