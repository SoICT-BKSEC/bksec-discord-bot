export interface ManagedVisibilityPolicy {
  allowedRoleIds: string[];
  deniedRoleIds: string[];
}

export interface ChildVisibilityPlan {
  enforceEveryoneDeny: boolean;
  allowedRoleIds: string[];
  deniedRoleIds: string[];
}

function uniqueRoleIds(roleIds: readonly (string | undefined)[]): string[] {
  return [...new Set(roleIds.filter((roleId): roleId is string => Boolean(roleId)))];
}

export function buildManagedVisibilityPolicy(
  managedRoleIds: readonly (string | undefined)[],
  categoryAllowedRoleIds: readonly string[],
  denyRoleId?: string
): ManagedVisibilityPolicy {
  const managed = uniqueRoleIds(managedRoleIds);
  const denied = new Set(denyRoleId ? [denyRoleId] : []);
  const allowed = new Set(
    uniqueRoleIds(categoryAllowedRoleIds).filter((roleId) => !denied.has(roleId))
  );

  for (const roleId of managed) {
    if (!allowed.has(roleId)) denied.add(roleId);
  }

  return {
    allowedRoleIds: [...allowed],
    deniedRoleIds: [...denied],
  };
}

/**
 * Synced ordinary channels already follow their category and must not be touched.
 * Unsynced ordinary channels keep all custom overwrites; only unsafe managed-role
 * allows are denied. Bot-owned read-only channels mirror the category policy.
 */
export function buildChildVisibilityPlan(options: {
  managedByBot: boolean;
  permissionsLocked: boolean;
  isSystemChannel: boolean;
  currentAllowedRoleIds: readonly string[];
  policy: ManagedVisibilityPolicy;
}): ChildVisibilityPlan {
  if (!options.managedByBot) {
    return { enforceEveryoneDeny: false, allowedRoleIds: [], deniedRoleIds: [] };
  }

  if (options.permissionsLocked && !options.isSystemChannel) {
    return { enforceEveryoneDeny: false, allowedRoleIds: [], deniedRoleIds: [] };
  }

  const currentAllows = new Set(options.currentAllowedRoleIds);
  return {
    enforceEveryoneDeny: true,
    allowedRoleIds: options.isSystemChannel ? options.policy.allowedRoleIds : [],
    deniedRoleIds: options.isSystemChannel
      ? options.policy.deniedRoleIds
      : options.policy.deniedRoleIds.filter((roleId) => currentAllows.has(roleId)),
  };
}
