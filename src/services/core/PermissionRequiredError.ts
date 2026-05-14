import type { SkillPermission } from '../../types';

export class PermissionRequiredError extends Error {
  readonly code = 'PERMISSION_REQUIRED';
  readonly skillId: string;
  readonly requestedPermissions: SkillPermission[];

  constructor(skillId: string, requestedPermissions: SkillPermission[]) {
    super(`权限不足: ${requestedPermissions.join(', ')}`);
    this.name = 'PermissionRequiredError';
    this.skillId = skillId;
    this.requestedPermissions = requestedPermissions;
  }
}

