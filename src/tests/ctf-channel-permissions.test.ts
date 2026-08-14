import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildChildVisibilityPlan,
  buildManagedVisibilityPolicy,
} from '../utils/ctf-channel-permissions';

const livePolicy = buildManagedVisibilityPolicy(
  ['active', 'view-all', 'per-ctf'],
  ['active'],
  'denied'
);
assert.deepEqual(livePolicy.allowedRoleIds, ['active']);
assert.deepEqual(new Set(livePolicy.deniedRoleIds), new Set(['view-all', 'per-ctf', 'denied']));

const hiddenCustomChannel = buildChildVisibilityPlan({
  managedByBot: true,
  permissionsLocked: false,
  isSystemChannel: false,
  currentAllowedRoleIds: ['view-all', 'custom-role'],
  policy: livePolicy,
});
assert.equal(hiddenCustomChannel.enforceEveryoneDeny, true);
assert.deepEqual(hiddenCustomChannel.allowedRoleIds, []);
assert.deepEqual(hiddenCustomChannel.deniedRoleIds, ['view-all']);
assert.equal(
  hiddenCustomChannel.deniedRoleIds.includes('custom-role'),
  false,
  'custom role overwrites must be preserved'
);

const syncedChallengeChannel = buildChildVisibilityPlan({
  managedByBot: true,
  permissionsLocked: true,
  isSystemChannel: false,
  currentAllowedRoleIds: [],
  policy: livePolicy,
});
assert.deepEqual(syncedChallengeChannel, {
  enforceEveryoneDeny: false,
  allowedRoleIds: [],
  deniedRoleIds: [],
});

const systemChannel = buildChildVisibilityPlan({
  managedByBot: true,
  permissionsLocked: false,
  isSystemChannel: true,
  currentAllowedRoleIds: [],
  policy: livePolicy,
});
assert.deepEqual(systemChannel.allowedRoleIds, ['active']);
assert.deepEqual(new Set(systemChannel.deniedRoleIds), new Set(livePolicy.deniedRoleIds));

for (const isSystemChannel of [false, true]) {
  const manualChannel = buildChildVisibilityPlan({
    managedByBot: false,
    permissionsLocked: false,
    isSystemChannel,
    currentAllowedRoleIds: ['view-all'],
    policy: livePolicy,
  });
  assert.deepEqual(
    manualChannel,
    { enforceEveryoneDeny: false, allowedRoleIds: [], deniedRoleIds: [] },
    'manual channels must never receive permission edits, including system-name channels'
  );
}

const sharedRolePolicy = buildManagedVisibilityPolicy(
  ['active-and-view-all', 'active-and-view-all', 'per-ctf'],
  ['active-and-view-all']
);
assert.deepEqual(sharedRolePolicy.allowedRoleIds, ['active-and-view-all']);
assert.deepEqual(sharedRolePolicy.deniedRoleIds, ['per-ctf']);

for (const relativePath of [
  'src/services/discord.service.ts',
  'src/commands/general/challenge.ts',
]) {
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  assert.doesNotMatch(
    source,
    /\.lockPermissions\s*\(/,
    `${relativePath} must not destructively sync custom channel overwrites`
  );
}

function typescriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

const discordServicePath = path.join(process.cwd(), 'src/services/discord.service.ts');
const permissionWritePattern = /permissionOverwrites\s*\.\s*(?:edit|create|set|delete)\s*\(/;
const permissionBypassPattern =
  /\.lockPermissions\s*\(|permissionOverwrites\s*:|permission_overwrites|Routes\.channelPermission/;
for (const runtimeDirectory of ['commands', 'components', 'events', 'services']) {
  for (const filePath of typescriptFiles(path.join(process.cwd(), 'src', runtimeDirectory))) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(
      source,
      permissionBypassPattern,
      `${path.relative(process.cwd(), filePath)} must not bypass ownership-guarded permission writes`
    );
    if (filePath === discordServicePath) continue;
    assert.doesNotMatch(
      source,
      permissionWritePattern,
      `${path.relative(process.cwd(), filePath)} must route permission writes through DiscordService`
    );
  }
}

const discordServiceSource = fs.readFileSync(discordServicePath, 'utf8');
assert.equal(
  discordServiceSource.match(new RegExp(permissionWritePattern.source, 'g'))?.length,
  2,
  'DiscordService must keep raw permission writes inside its guarded edit/delete wrappers'
);
const ownershipGuardPattern =
  /if \(!\(await this\.mayManagePermissions\(channel\.id, channel\.name\)\)\) return false;/g;
assert.equal(
  discordServiceSource.match(ownershipGuardPattern)?.length,
  2,
  'both raw permission wrappers must be protected by persisted bot ownership'
);

console.log('ctf channel permission tests passed');
