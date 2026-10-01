import { z } from 'zod';

export const ReviewTriageStatusSchema = z.enum(['accept', 'reject', 'defer', 'needs_refinement']);
export type ReviewTriageStatus = z.infer<typeof ReviewTriageStatusSchema>;
