import { z } from 'zod';

import { SessionImageMediaReferenceV1Schema } from '../sessions/media/imageReferenceV1.js';
import { BrowserActiveTargetV1Schema } from '../browser/events/activeTarget.js';

const IdSchema = z.string().trim().min(1);
const PositiveSafeIntSchema = z.number().int().positive();
const CoordinateSchema = z.number().finite();
const DimensionSchema = z.number().finite().positive();
export const ComputerAccessV1Schema = z.enum(['see', 'use']);
export type ComputerAccessV1 = z.infer<typeof ComputerAccessV1Schema>;
const TargetLabelSchema = BrowserActiveTargetV1Schema.shape.label;

/** Placement is a Machine Action fact; target identity does not confer Session authority. */
export const ComputerTargetV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('window'), displayId: IdSchema, pid: PositiveSafeIntSchema, windowId: PositiveSafeIntSchema }).strict(),
  z.object({ kind: z.literal('display'), displayId: IdSchema }).strict(),
]);
export type ComputerTargetV1 = z.infer<typeof ComputerTargetV1Schema>;

/** Exact native target identity shared by capture ownership and picker selection. */
export function computerTargetKeyV1(target: ComputerTargetV1): string {
  return JSON.stringify([target.displayId, target.kind, ...(target.kind === 'window' ? [target.pid, target.windowId] : [])]);
}

export const ComputerCaptureGeometryV1Schema = z.object({
  captureWidth: PositiveSafeIntSchema,
  captureHeight: PositiveSafeIntSchema,
  nativeWidth: PositiveSafeIntSchema,
  nativeHeight: PositiveSafeIntSchema,
  originX: CoordinateSchema,
  originY: CoordinateSchema,
  scaleX: DimensionSchema,
  scaleY: DimensionSchema,
  crop: z.object({ x: CoordinateSchema, y: CoordinateSchema, width: DimensionSchema, height: DimensionSchema }).strict(),
}).strict();
export type ComputerCaptureGeometryV1 = z.infer<typeof ComputerCaptureGeometryV1Schema>;

export const ComputerInputOperationV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), x: CoordinateSchema, y: CoordinateSchema, button: z.enum(['left', 'right', 'middle']).optional() }).strict(),
  z.object({ kind: z.literal('press'), key: IdSchema }).strict(),
  z.object({ kind: z.literal('type'), text: z.string() }).strict(),
]);
export type ComputerInputOperationV1 = z.infer<typeof ComputerInputOperationV1Schema>;

export const ComputerMachineRequestV1Schema = z.object({ machineId: IdSchema }).strict();
export const ComputerTargetRequestV1Schema = ComputerMachineRequestV1Schema.extend({ target: ComputerTargetV1Schema.optional(), sourceId: IdSchema.optional() });
export type ComputerTargetRequestV1 = z.infer<typeof ComputerTargetRequestV1Schema>;
export const ComputerTargetSelectRequestV1Schema = ComputerMachineRequestV1Schema.extend({
  target: ComputerTargetV1Schema.optional(),
  access: ComputerAccessV1Schema.optional(),
  /** A proposed window title or app hint, not host-resolved display metadata. */
  requestedTarget: IdSchema.optional(),
}).refine(request => request.target !== undefined || request.requestedTarget !== undefined, {
  message: 'A native target or target suggestion is required',
});
export type ComputerTargetSelectRequestV1 = z.infer<typeof ComputerTargetSelectRequestV1Schema>;
/** Without a display the machine lists its own (the daemon's desktop display); none means no screen to share. */
export const ComputerTargetsListRequestV1Schema = z.object({ machineId: IdSchema, displayId: IdSchema.optional() }).strict();
export type ComputerTargetsListRequestV1 = z.infer<typeof ComputerTargetsListRequestV1Schema>;
export const ComputerInputRequestV1Schema = ComputerTargetRequestV1Schema.extend({
  captureId: IdSchema,
  operation: ComputerInputOperationV1Schema,
});
export type ComputerInputRequestV1 = z.infer<typeof ComputerInputRequestV1Schema>;

/** Computer-owner presentation facts; native target identities never belong in this shape. */
export const ComputerApprovalDisplayV1Schema = z.object({
  machineDisplayName: IdSchema,
  requiresTargetSelection: z.boolean(),
  appName: IdSchema.optional(),
  access: ComputerAccessV1Schema.optional(),
  target: z.object({ kind: z.enum(['window', 'display']), title: z.string() }).strict().optional(),
  captureMedia: SessionImageMediaReferenceV1Schema.required({ file: true }).optional(),
}).strict();
export type ComputerApprovalDisplayV1 = z.infer<typeof ComputerApprovalDisplayV1Schema>;

export const ComputerSelectedTargetResponseV1Schema = z.object({
  approvalDisplay: ComputerApprovalDisplayV1Schema,
  consentGranted: z.boolean(),
  access: ComputerAccessV1Schema.optional(),
  selectedTarget: ComputerTargetV1Schema.optional(),
  sourceId: IdSchema.optional(),
}).strict();
export type ComputerSelectedTargetResponseV1 = z.infer<typeof ComputerSelectedTargetResponseV1Schema>;

export const ComputerOpenSettingsRequestV1Schema = ComputerMachineRequestV1Schema.extend({ permission: z.enum(['capture', 'input']) });
export const ComputerOpenSettingsResponseV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('dispatched') }).strict(),
  z.object({ status: z.literal('failed'), code: IdSchema }).strict(),
]);

const IdentityShape = { target: ComputerTargetV1Schema, sourceId: IdSchema };
const InputPresentationShape = { ...IdentityShape, targetLabel: TargetLabelSchema };
const FailedResultSchema = z.object({ ...IdentityShape, status: z.literal('failed'), code: IdSchema }).strict();
const TargetSelectionRequiredResultSchema = z.object({ status: z.literal('target_selection_required'),
  approvalDisplay: ComputerApprovalDisplayV1Schema }).strict();

export const ComputerActionResultV1Schema = z.discriminatedUnion('status', [
  TargetSelectionRequiredResultSchema,
  z.object({ ...InputPresentationShape, status: z.literal('dispatched') }).strict(),
  z.object({ ...InputPresentationShape, status: z.literal('verified'), property: IdSchema }).strict(),
  FailedResultSchema.extend({ targetLabel: TargetLabelSchema }),
  z.object({ ...InputPresentationShape, status: z.literal('interrupted'), completion: z.enum(['known', 'unknown']) }).strict(),
]);
export type ComputerActionResultV1 = z.infer<typeof ComputerActionResultV1Schema>;

export const ComputerCaptureResponseV1Schema = z.discriminatedUnion('status', [
  TargetSelectionRequiredResultSchema,
  z.object({
    ...IdentityShape, status: z.literal('captured'), captureId: IdSchema,
    geometry: ComputerCaptureGeometryV1Schema,
    media: SessionImageMediaReferenceV1Schema.required({ file: true }),
  }).strict(),
  FailedResultSchema,
]);
export type ComputerCaptureResponseV1 = z.infer<typeof ComputerCaptureResponseV1Schema>;

export const ComputerAccessibilityNodeV1Schema = z.object({
  id: IdSchema,
  role: IdSchema,
  name: z.string().optional(),
  value: z.string().optional(),
  bounds: z.object({ x: CoordinateSchema, y: CoordinateSchema, width: DimensionSchema, height: DimensionSchema }).strict().optional(),
}).strict();
export type ComputerAccessibilityNodeV1 = z.infer<typeof ComputerAccessibilityNodeV1Schema>;
export const ComputerQueryResponseV1Schema = z.discriminatedUnion('status', [
  TargetSelectionRequiredResultSchema,
  z.object({ ...IdentityShape, status: z.literal('queried'), accessibility: z.object({
    status: z.enum(['complete', 'partial', 'unavailable']),
    reason: IdSchema.optional(),
    nodes: z.array(ComputerAccessibilityNodeV1Schema),
  }).strict() }).strict(),
  FailedResultSchema,
]);
export type ComputerQueryResponseV1 = z.infer<typeof ComputerQueryResponseV1Schema>;

export const ComputerGrantStatusV1Schema = z.object({
  capture: z.enum(['granted', 'denied', 'unknown']),
  input: z.enum(['granted', 'denied', 'unknown']),
}).strict();
export type ComputerGrantStatusV1 = z.infer<typeof ComputerGrantStatusV1Schema>;

export const ComputerTargetsListResponseV1Schema = z.object({
  targets: z.array(z.object({ target: ComputerTargetV1Schema, title: z.string().optional(), appName: IdSchema.optional(),
    label: IdSchema.optional(), width: PositiveSafeIntSchema.optional(), height: PositiveSafeIntSchema.optional(),
    thumbnail: z.object({ mimeType: z.literal('image/png'), base64: IdSchema,
      width: PositiveSafeIntSchema, height: PositiveSafeIntSchema }).strict().optional(),
  }).strict()),
  displays: z.discriminatedUnion('status', [
    z.object({ status: z.literal('available') }).strict(),
    z.object({ status: z.literal('unavailable'), code: IdSchema }).strict(),
  ]).optional(),
  grants: ComputerGrantStatusV1Schema,
  settingsDeepLink: z.string().url().optional(),
}).strict();
export type ComputerTargetsListResponseV1 = z.infer<typeof ComputerTargetsListResponseV1Schema>;

export const ComputerControlStatusResponseV1Schema = z.object({
  ...IdentityShape,
  controller: z.enum(['agent', 'human', 'idle']),
  controlEpoch: z.number().int().nonnegative(),
  stopping: z.boolean(),
  uncertain: z.boolean(),
  activity: z.object({ kind: z.enum(['capture', 'click', 'type', 'press']), targetLabel: TargetLabelSchema }).strict().optional(),
  activeTarget: BrowserActiveTargetV1Schema.optional(),
}).strict();
export type ComputerControlStatusResponseV1 = z.infer<typeof ComputerControlStatusResponseV1Schema>;

/**
 * The computer Actions a person performs from Happier (choose, look, stop, hand back, permission pane),
 * over the owner-scoped machine RPC. Agent input never takes this route: the person's own clicks and keys
 * travel as live-stream sideband controls, and agent Actions run through their Session's dispatch.
 */
export const COMPUTER_PRESENT_USER_ACTION_IDS = [
  'computer.targets.list',
  'computer.target.get',
  'computer.target.select',
  'computer.permissions.openSettings',
  'computer.capture',
  'computer.control.status',
  'computer.control.interrupt',
  'computer.control.handBack',
  'computer.target.close',
] as const;
export type ComputerPresentUserActionId = (typeof COMPUTER_PRESENT_USER_ACTION_IDS)[number];

export const DaemonComputerActionExecuteRequestV1Schema = z.object({
  sessionId: IdSchema,
  actionId: z.enum(COMPUTER_PRESENT_USER_ACTION_IDS),
  /** Validated by the Action's own input schema at the daemon's computer owner. */
  input: z.unknown(),
}).strict();
export type DaemonComputerActionExecuteRequestV1 = z.infer<typeof DaemonComputerActionExecuteRequestV1Schema>;

export const DaemonComputerActionExecuteResponseV1Schema = z.object({
  protocolVersion: z.literal(1),
  /** The Action's declared payload, or the owner's `{ ok: false, errorCode }` refusal envelope. */
  result: z.unknown(),
}).strict();
export type DaemonComputerActionExecuteResponseV1 = z.infer<typeof DaemonComputerActionExecuteResponseV1Schema>;
