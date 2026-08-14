import 'dotenv/config';
import Database from 'better-sqlite3';
import { REST, Routes } from 'discord.js';
import path from 'path';

/**
 * Bring existing CTF categories into the active-role visibility model.
 *   live  (now <  endtime): active role only           -> post_end_opened = 0
 *   ended (now >= endtime): + per-CTF role + VIEW_ALL  -> post_end_opened = 1
 * Skips archived and purged CTFs. DRY RUN by default; pass --apply to write.
 *
 *   npx tsx scripts/fix-ctf-visibility.ts
 *   npx tsx scripts/fix-ctf-visibility.ts --apply
 */

const APPLY = process.argv.includes('--apply');
const VIEW_CHANNEL = 1 << 10; // 1024

/**
 * Read a required env var. process.exit returns never, so the return type is a
 * plain string — callers get a narrowed value without a non-null assertion,
 * which module-level `const` narrowing would not survive into function bodies.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} not set in .env`);
    process.exit(1);
  }
  return value;
}

const token = requireEnv('BOT_TOKEN');
const guildId = requireEnv('SERVER_ID');
const activeRoleId = requireEnv('ACTIVE_CTF_ROLEID');
const viewAllRoleId = requireEnv('VIEW_ALL_CTF_ROLEID');
const denyRoleId = process.env.DENY_CTF_ROLEID; // optional

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'ctf.db');
const db = new Database(DB_PATH);
const managedChannelTableExists = Boolean(
  db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bot_managed_discord_channels'"
    )
    .get()
);

function isManagedDiscordChannel(channelId: string): boolean {
  if (!managedChannelTableExists) return false;
  return Boolean(
    db.prepare('SELECT 1 FROM bot_managed_discord_channels WHERE channel_id = ?').get(channelId)
  );
}

// Ensure the column exists — the bot creates it on startup, but this script may
// run before the bot has restarted. Safe to run even if already migrated.
try {
  db.exec('ALTER TABLE ctfs ADD COLUMN post_end_opened INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already exists
}

const rest = new REST({ version: '10' }).setToken(token);

interface CTFRow {
  id: number;
  name: string;
  role: string;
  cate: string;
  channel: string;
  endtime: number;
  archived: number;
  channels_purged: number;
}

// PUT a role permission overwrite (type 0 = role).
async function putOverwrite(
  channelId: string,
  roleId: string,
  allow: number | bigint,
  deny: number | bigint
) {
  await rest.put(Routes.channelPermission(channelId, roleId), {
    body: { type: 0, allow: String(allow), deny: String(deny) },
    reason: 'CTF active-role visibility migration',
  });
}

async function deleteOverwrite(channelId: string, roleId: string) {
  try {
    await rest.delete(Routes.channelPermission(channelId, roleId), {
      reason: 'CTF active-role visibility migration',
    });
  } catch {
    // no such overwrite — fine
  }
}

/** Deny @everyone without replacing any other channel-specific permissions. */
async function denyViewPreservingOtherBits(channelId: string, roleId: string) {
  const channel = (await rest.get(Routes.channel(channelId))) as {
    permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }>;
  };
  const overwrite = channel.permission_overwrites?.find(
    (item) => item.id === roleId && item.type === 0
  );
  const viewChannel = BigInt(VIEW_CHANNEL);
  const allow = BigInt(overwrite?.allow ?? '0') & ~viewChannel;
  const deny = BigInt(overwrite?.deny ?? '0') | viewChannel;
  await putOverwrite(channelId, roleId, allow, deny);
}

async function main() {
  try {
    await rest.get(Routes.user('@me'));
  } catch {
    console.error('Invalid BOT_TOKEN — aborting.');
    db.close();
    process.exit(1);
  }

  const rows = db
    .prepare('SELECT id, name, role, cate, channel, endtime, archived, channels_purged FROM ctfs')
    .all() as CTFRow[];
  const now = Math.floor(Date.now() / 1000);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — inspecting ${rows.length} CTF(s)\n`);

  let live = 0;
  let ended = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.archived === 1 || row.channels_purged === 1 || !row.cate || row.cate === '0') {
      skipped++;
      continue;
    }
    if (!isManagedDiscordChannel(row.cate)) {
      console.log(`[SKIP ] ${row.name} — category permissions are manually managed`);
      skipped++;
      continue;
    }
    const isLive = now < row.endtime;

    if (!APPLY) {
      console.log(`[${isLive ? 'LIVE ' : 'ENDED'}] ${row.name} — cate ${row.cate}`);
      if (isLive) {
        live++;
      } else {
        ended++;
      }
      continue;
    }

    try {
      if (isLive) {
        // @everyone has ViewChannel in this guild's base perms — deny explicitly.
        await putOverwrite(row.cate, guildId, 0, VIEW_CHANNEL);
        await putOverwrite(row.cate, activeRoleId, VIEW_CHANNEL, 0);
        if (denyRoleId) await putOverwrite(row.cate, denyRoleId, 0, VIEW_CHANNEL);
        await deleteOverwrite(row.cate, row.role);
        await deleteOverwrite(row.cate, viewAllRoleId);
        db.prepare(
          "UPDATE ctfs SET post_end_opened = 0, updated_at = strftime('%s','now') WHERE id = ?"
        ).run(row.id);
        console.log(`[LIVE ] ${row.name} — active-only applied`);
        live++;
      } else {
        // @everyone stays denied so access remains role-gated.
        await putOverwrite(row.cate, guildId, 0, VIEW_CHANNEL);
        await putOverwrite(row.cate, activeRoleId, VIEW_CHANNEL, 0);
        await putOverwrite(row.cate, row.role, VIEW_CHANNEL, 0);
        await putOverwrite(row.cate, viewAllRoleId, VIEW_CHANNEL, 0);
        db.prepare(
          "UPDATE ctfs SET post_end_opened = 1, updated_at = strftime('%s','now') WHERE id = ?"
        ).run(row.id);
        console.log(`[ENDED] ${row.name} — per-CTF + VIEW_ALL granted`);
        ended++;
      }

      // Never re-sync an existing channel: that would erase intentional custom
      // denies. Only enforce the non-public invariant while preserving all other
      // channel-specific overwrites.
      if (row.channel && row.channel !== '0') {
        if (isManagedDiscordChannel(row.channel)) {
          await denyViewPreservingOtherBits(row.channel, guildId);
          if (denyRoleId) await denyViewPreservingOtherBits(row.channel, denyRoleId);
          console.log(`         info channel -> kept custom overwrites; public access denied`);
        } else {
          console.log(`         info channel -> manual permissions preserved`);
        }
      }
    } catch (err) {
      console.error(`[FAIL ] ${row.name} (cate ${row.cate}):`, err);
      failed++;
    }
  }

  console.log(`\nDone: ${live} live, ${ended} ended, ${skipped} skipped, ${failed} failed.`);
  if (!APPLY) console.log('\nRe-run with --apply to write these changes.');
  db.close();
}

main().catch((err) => {
  console.error(err);
  db.close();
  process.exit(1);
});
