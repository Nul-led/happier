import { z } from 'zod';

export const ReviewFindingSeveritySchema = z.enum(['blocker', 'high', 'medium', 'low', 'nit']);
export type ReviewFindingSeverity = z.infer<typeof ReviewFindingSeveritySchema>;
export const ReviewFindingCategorySchema = z.enum(['correctness', 'security', 'performance', 'maintainability', 'testing', 'style', 'docs']);
export type ReviewFindingCategory = z.infer<typeof ReviewFindingCategorySchema>;
