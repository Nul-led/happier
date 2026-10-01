import type { PersonalHomeBootstrapSnapshot } from '../bootstrap/personalHomeBootstrapTypes';

/**
 * The ordered milestones first-run setup can prove, derived from the canonical bootstrap
 * snapshot and nothing else.
 *
 * They are the readiness facts `derivePersonalHomeBootstrapSnapshot` already proves while it
 * derives those phases; this module invents no stage of its own and reads no task events,
 * timers or clocks. Progress is therefore quantised to
 * completed facts — never time-based, never a fabricated fill (lane-03 §6.5 as amended by A12).
 */
export const PERSONAL_HOME_SETUP_MILESTONES = [
    'runtime-healthy',
    'identity-verified',
    'authenticated',
    'signup-closed',
    'daemon-ready',
] as const;

export type PersonalHomeSetupMilestone = typeof PERSONAL_HOME_SETUP_MILESTONES[number];

export type PersonalHomeSetupProgress = Readonly<{
    /** Completed milestones, counted as an ordered prefix so a later one never jumps an earlier one. */
    completedMilestones: number;
    totalMilestones: number;
    /** Exactly `completedMilestones / totalMilestones`. */
    fraction: number;
    /** True while an operation is running, i.e. the activity treatment may move. */
    working: boolean;
}>;

export function derivePersonalHomeSetupProgress(
    snapshot: PersonalHomeBootstrapSnapshot,
): PersonalHomeSetupProgress {
    const milestones = snapshot.progressMilestones;
    // Older/incomplete presentation fixtures can omit the fine-grained projection. They may
    // claim only the aggregate facts the snapshot itself proves, never a fabricated phase step.
    const proven: readonly boolean[] = [
        milestones?.runtimeHealthy ?? snapshot.homeReady,
        milestones?.identityVerified ?? snapshot.homeReady,
        milestones?.authenticated ?? snapshot.homeReady,
        milestones?.signupClosed ?? snapshot.homeReady,
        snapshot.daemonReady,
    ];

    let completedMilestones = 0;
    for (const milestoneProven of proven) {
        if (!milestoneProven) break;
        completedMilestones += 1;
    }

    const totalMilestones = PERSONAL_HOME_SETUP_MILESTONES.length;
    return {
        completedMilestones,
        totalMilestones,
        fraction: completedMilestones / totalMilestones,
        working: snapshot.phase !== 'blocked' && snapshot.phase !== 'ready',
    };
}
