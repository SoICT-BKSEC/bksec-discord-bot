import 'dotenv/config';
import Database from 'better-sqlite3';
import { REST, Routes } from 'discord.js';
import path from 'path';

/**
 * Nuke CTF categories by id.
 *
 * For each id in CATEGORY_IDS below: delete every channel inside the category,
 * then the category itself, then the per-CTF role recorded in the database, then
 * the ctfs row. Same order as the /admin-delete "delete all" button, so a crash
 * mid-run leaves a dangling row that check-purged.ts can reconcile — never an
 * orphaned channel that nothing can find.
 *
 * The role comes from ctfs.role. A category with no ctfs row still gets its
 * channels removed, but no role is guessed from the name.
 *
 * DRY RUN by default. Pass --apply to actually delete.
 *
 *   npx tsx scripts/nuke-categories.ts          # preview only
 *   npx tsx scripts/nuke-categories.ts --apply  # perform deletion
 */

// ---------------------------------------------------------------------------
// Categories to nuke. Every id must be a category channel — anything else is
// reported and skipped rather than deleted.
// ---------------------------------------------------------------------------
const CATEGORY_IDS: string[] = [
  // '1234567890123456789',
];

const APPLY = process.argv.includes('--apply');
const REASON = 'Bulk CTF category nuke';
const CHANNEL_TYPE_CATEGORY = 4;

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

// Config roles that must never be deleted even if a row references them.
const PROTECTED_ROLE_IDS = new Set(
  [
    guildId, // @everyone role shares the guild id
    process.env.ACTIVE_CTF_ROLEID,
    process.env.VIEW_ALL_CTF_ROLEID,
    process.env.DENY_CTF_ROLEID,
    process.env.ADMIN_ROLE_ID,
    process.env.VERIFY_REMOVE_ROLE_ID,
    process.env.VERIFY_GRANT_ROLE_ID,
    process.env.VERIFY_ALLOWED_ROLE_ID,
    process.env.TASK_ROLE_PWN,
    process.env.TASK_ROLE_REV,
    process.env.TASK_ROLE_CRYPTO,
    process.env.TASK_ROLE_ALL,
  ].filter((v): v is string => Boolean(v))
);

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'ctf.db');
const db = new Database(DB_PATH);
// solved_challenges references ctfs ON DELETE CASCADE — only honoured with this on.
db.pragma('foreign_keys = ON');

const rest = new REST({ version: '10' }).setToken(token);

interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
}

interface GuildRole {
  id: string;
  name: string;
  managed: boolean;
  position: number;
}

interface CTFRow {
  id: number;
  name: string;
  role: string;
  cate: string;
}

type RoleVerdict =
  | { action: 'delete'; role: GuildRole }
  | { action: 'skip'; message: string }
  | { action: 'none'; message: string };

/**
 * Decide what to do with a CTF's role. Mirrors the guardrails in
 * purge-stale-roles.ts: never touch config roles, integration-managed roles, or
 * roles sitting above the bot in the hierarchy (Discord rejects those anyway).
 */
function judgeRole(
  row: CTFRow | undefined,
  roleById: Map<string, GuildRole>,
  keepRoleIds: Set<string>,
  botTopPosition: number
): RoleVerdict {
  if (!row) return { action: 'none', message: 'no database row — no role to delete' };
  if (!row.role) return { action: 'none', message: 'row has no role id' };

  const role = roleById.get(row.role);
  if (!role) return { action: 'none', message: `role ${row.role} already deleted` };
  if (PROTECTED_ROLE_IDS.has(role.id))
    return { action: 'skip', message: `role "${role.name}" is a protected/config role` };
  if (keepRoleIds.has(role.id))
    return { action: 'skip', message: `role "${role.name}" is still used by another CTF` };
  if (role.managed)
    return { action: 'skip', message: `role "${role.name}" is managed by an integration` };
  if (role.position >= botTopPosition)
    return {
      action: 'skip',
      message: `role "${role.name}" is above the bot in the hierarchy (pos ${role.position} >= ${botTopPosition})`,
    };

  return { action: 'delete', role };
}

async function main() {
  const ids = [...new Set(CATEGORY_IDS.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    console.error('CATEGORY_IDS is empty — edit the array at the top of this script.');
    db.close();
    process.exit(1);
  }

  // 1. Validate token / identity.
  let botUserId: string;
  try {
    const me = (await rest.get(Routes.user('@me'))) as { id: string };
    botUserId = me.id;
  } catch {
    console.error('Invalid BOT_TOKEN — aborting.');
    db.close();
    process.exit(1);
  }

  // 2. Fetch the guild's channels and roles once, rather than per category.
  const channels = (await rest.get(Routes.guildChannels(guildId))) as GuildChannel[];
  const channelById = new Map(channels.map((c) => [c.id, c]));
  const childrenByParent = new Map<string, GuildChannel[]>();
  for (const channel of channels) {
    if (!channel.parent_id) continue;
    const siblings = childrenByParent.get(channel.parent_id) ?? [];
    siblings.push(channel);
    childrenByParent.set(channel.parent_id, siblings);
  }

  const guildRoles = (await rest.get(Routes.guildRoles(guildId))) as GuildRole[];
  const roleById = new Map(guildRoles.map((r) => [r.id, r]));

  // 3. The bot cannot delete roles at or above its own highest role.
  const member = (await rest.get(Routes.guildMember(guildId, botUserId))) as { roles: string[] };
  const botTopPosition = member.roles.reduce((max, rid) => {
    const r = roleById.get(rid);
    return r && r.position > max ? r.position : max;
  }, 0);

  // 4. Database rows for the targets, plus the roles that survive this run.
  // Computed across the whole target set first: two listed categories can point
  // at the same role, and a role shared with an untouched CTF must be kept.
  const allRows = db.prepare('SELECT id, name, role, cate FROM ctfs').all() as CTFRow[];
  const targetIds = new Set(ids);
  const rowByCate = new Map(allRows.filter((r) => targetIds.has(r.cate)).map((r) => [r.cate, r]));
  const keepRoleIds = new Set(
    allRows.filter((r) => !targetIds.has(r.cate) && r.role).map((r) => r.role)
  );

  console.log(
    `${APPLY ? 'APPLY' : 'DRY RUN'} — ${ids.length} categor${ids.length === 1 ? 'y' : 'ies'} on guild ${guildId}\n`
  );

  let categoriesDeleted = 0;
  let categoriesGone = 0;
  let channelsDeleted = 0;
  let rolesDeleted = 0;
  let rowsDeleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const categoryId of ids) {
    const row = rowByCate.get(categoryId);
    const category = channelById.get(categoryId);
    const label = row?.name ?? categoryId;

    // A mistyped id that lands on a real text channel must never be deleted.
    if (category && category.type !== CHANNEL_TYPE_CATEGORY) {
      console.log(
        `[SKIP]  ${label} — ${categoryId} is "${category.name}" (channel type ${category.type}), not a category`
      );
      skipped++;
      continue;
    }

    try {
      // Channels first, then the category: deleting a category does not cascade,
      // it orphans its children to the guild root.
      if (category) {
        const children = childrenByParent.get(categoryId) ?? [];
        if (!APPLY) {
          console.log(
            `[WOULD] ${label} — delete category "${category.name}" + ${children.length} channel(s)`
          );
          for (const child of children) console.log(`          #${child.name}`);
        } else {
          for (const child of children) {
            await rest.delete(Routes.channel(child.id), { reason: REASON });
            console.log(`          deleted #${child.name}`);
            channelsDeleted++;
          }
          await rest.delete(Routes.channel(categoryId), { reason: REASON });
          console.log(
            `[DEL]   ${label} — deleted category "${category.name}" + ${children.length} channel(s)`
          );
        }
        categoriesDeleted++;
      } else {
        console.log(`[GONE]  ${label} — category ${categoryId} already absent`);
        categoriesGone++;
      }

      // Role, from the database only — never guessed from the category name.
      const verdict = judgeRole(row, roleById, keepRoleIds, botTopPosition);
      if (verdict.action === 'delete') {
        if (!APPLY) {
          console.log(`          would delete role "${verdict.role.name}" (${verdict.role.id})`);
        } else {
          await rest.delete(Routes.guildRole(guildId, verdict.role.id), { reason: REASON });
          console.log(`          deleted role "${verdict.role.name}" (${verdict.role.id})`);
        }
        rolesDeleted++;
      } else {
        console.log(`          role: ${verdict.message}`);
        if (verdict.action === 'skip') skipped++;
      }

      // Database last: only once Discord is in the requested state.
      if (row) {
        if (!APPLY) {
          console.log(`          would delete ctfs row #${row.id}`);
        } else {
          db.prepare('DELETE FROM ctfs WHERE id = ?').run(row.id);
          console.log(`          deleted ctfs row #${row.id}`);
        }
        rowsDeleted++;
      }
    } catch (err) {
      console.error(`[FAIL]  ${label} — ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  const verb = APPLY ? 'deleted' : 'to delete';
  console.log(
    `\nDone: ${categoriesDeleted} categor${categoriesDeleted === 1 ? 'y' : 'ies'} ${verb}` +
      (APPLY ? `, ${channelsDeleted} channels deleted` : '') +
      `, ${rolesDeleted} role(s) ${verb}, ${rowsDeleted} row(s) ${verb}, ` +
      `${categoriesGone} already gone, ${skipped} skipped, ${failed} failed.`
  );
  if (!APPLY) {
    console.log('\nRe-run with --apply to actually delete.');
  }
  db.close();
}

main().catch((err) => {
  console.error(err);
  db.close();
  process.exit(1);
});
