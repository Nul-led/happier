import { z } from 'zod';

import { MentionRefV1Schema } from '../runtime/input/mentionRefV1.js';
import { PortableComposerAttachmentV1Schema } from '../runtime/input/composerAttachmentV1.js';

/**
 * The saved, portable half of a Composer document: literal text, positionless
 * canonical references and contentless portable attachment records. A
 * transfer-owned staged-media claim is device-local and is deliberately not
 * durable definition content.
 */
export const WorkflowStepComposerDocumentSchema = z.object({
  text: z.string().min(1),
  references: z.array(MentionRefV1Schema).default([]),
  attachments: z.array(PortableComposerAttachmentV1Schema).default([]),
}).strict();
export type WorkflowStepComposerDocument = z.infer<typeof WorkflowStepComposerDocumentSchema>;
