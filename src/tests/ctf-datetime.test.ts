import assert from 'node:assert/strict';
import {
  buildManualCTFSchedule,
  DEFAULT_MANUAL_ARCHIVE_DAYS,
  parseCTFDateTime,
} from '../utils/ctf-datetime';

const localExpected = Math.floor(Date.parse('2026-08-15T19:30:00+07:00') / 1000);
assert.equal(parseCTFDateTime('2026-08-15 19:30'), localExpected);
assert.equal(parseCTFDateTime('2026-08-15T19:30:00+07:00'), localExpected);
assert.equal(parseCTFDateTime(`<t:${localExpected}:F>`), localExpected);
assert.equal(parseCTFDateTime(String(localExpected)), localExpected);

assert.equal(parseCTFDateTime('2026-02-29 10:00'), null);
assert.equal(parseCTFDateTime('2026-02-29T10:00:00+07:00'), null);
assert.equal(parseCTFDateTime('2026-08-15'), null);
assert.equal(parseCTFDateTime('not-a-date'), null);

const scheduleResult = buildManualCTFSchedule('2026-08-15 19:30', '2026-08-16 19:30');
assert.equal(scheduleResult.ok, true);
if (scheduleResult.ok) {
  assert.equal(scheduleResult.schedule.startTime, localExpected);
  assert.equal(scheduleResult.schedule.endTime - scheduleResult.schedule.startTime, 86_400);
  assert.equal(
    scheduleResult.schedule.archiveAt - scheduleResult.schedule.endTime,
    DEFAULT_MANUAL_ARCHIVE_DAYS * 86_400
  );
}

assert.deepEqual(buildManualCTFSchedule('bad', '2026-08-16 19:30'), {
  ok: false,
  error: 'invalid_start',
});
assert.deepEqual(buildManualCTFSchedule('2026-08-15 19:30', 'bad'), {
  ok: false,
  error: 'invalid_end',
});
assert.deepEqual(buildManualCTFSchedule('2026-08-16 19:30', '2026-08-15 19:30'), {
  ok: false,
  error: 'end_not_after_start',
});
assert.deepEqual(buildManualCTFSchedule('2026-08-15 19:30', '2026-08-16 19:30', 366), {
  ok: false,
  error: 'invalid_archive_days',
});

console.log('ctf datetime tests passed');
