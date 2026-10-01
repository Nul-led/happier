import { z } from 'zod';

export const SETTINGS_DECLARATION_ACTION_IDS_V1 = ['settings.list', 'settings.get', 'settings.set'] as const;
export type SettingsDeclarationActionIdV1 = typeof SETTINGS_DECLARATION_ACTION_IDS_V1[number];

export function isSettingsDeclarationActionIdV1(value: string): value is SettingsDeclarationActionIdV1 {
  return (SETTINGS_DECLARATION_ACTION_IDS_V1 as readonly string[]).includes(value);
}

/** The generic family exposes scalar preferences; compound editors keep their domain Actions. */
export const SettingsDeclarationValueV1Schema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const AnchorSchema = z.string().trim().min(1);
export const SettingsDeclarationDescriptorV1Schema = z.object({
  anchor: AnchorSchema,
  pageId: z.string().min(1),
  title: z.string(),
  description: z.string().optional(),
  readable: z.boolean(),
  writable: z.boolean(),
  sensitive: z.boolean(),
  storageScope: z.enum(['account', 'local']).optional(),
  allowedValues: z.array(SettingsDeclarationValueV1Schema).optional(),
  unavailableReason: z.enum(['not_bound', 'sensitive', 'read_only', 'unsupported_host', 'feature_disabled']).optional(),
}).strict();
const ValueResultSchema = z.object({ anchor: AnchorSchema, value: SettingsDeclarationValueV1Schema }).strict();

export const SettingsDeclarationActionInputSchemasV1 = {
  'settings.list': z.object({ pageId: z.string().trim().min(1).optional() }).strict(),
  'settings.get': z.object({ anchor: AnchorSchema }).strict(),
  'settings.set': z.object({ anchor: AnchorSchema, value: SettingsDeclarationValueV1Schema }).strict(),
} as const;
export const SettingsDeclarationActionOutputSchemasV1 = {
  'settings.list': z.object({ items: z.array(SettingsDeclarationDescriptorV1Schema) }).strict(),
  'settings.get': z.union([ValueResultSchema, z.object({ anchor: AnchorSchema, unset: z.literal(true) }).strict()]),
  'settings.set': ValueResultSchema,
} as const;
export type SettingsDeclarationDescriptorV1 = z.infer<typeof SettingsDeclarationDescriptorV1Schema>;
