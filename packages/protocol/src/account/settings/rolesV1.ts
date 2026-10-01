import { z } from 'zod';

import { RoleInstructionsOverrideV1Schema } from '../../prompts/roles/rolesV1.js';
import { ACCOUNT_SETTINGS_MAX_DOCUMENT_BYTES, withAccountSettingBounds } from './catalog/accountSettingBounds.js';

/** Account preferences only; role documents live in the Artifact store. */
export const RolesV1Schema = withAccountSettingBounds(z.object({
  overrides: z.record(z.string().min(1), RoleInstructionsOverrideV1Schema),
}).strict().superRefine((value, context) => {
  for (const [roleId, override] of Object.entries(value.overrides)) {
    if (roleId !== override.roleId) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['overrides', roleId, 'roleId'],
      message: 'Role override id must match its record key',
    });
  }
}), ACCOUNT_SETTINGS_MAX_DOCUMENT_BYTES);
export type RolesV1 = z.infer<typeof RolesV1Schema>;
