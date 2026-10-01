import { t } from '@/text';

/**
 * The outcome a widening save asks about, most consequential first. It only
 * picks the confirmation's words: whether a save widens anything at all is the
 * Home's answer (`home_policy_widening_unconfirmed`), never the client's.
 */
export type HomePolicyWideningIntent =
    | Readonly<{ kind: 'admission_anyone' }>
    | Readonly<{ kind: 'admission_invited' }>
    | Readonly<{ kind: 'method'; methodId: string; methodName: string }>
    | Readonly<{ kind: 'anonymous_signup' }>
    | Readonly<{ kind: 'unencrypted' }>
    | Readonly<{ kind: 'other' }>;

type WideningCopy = Readonly<{ title: string; exposure: string; confirm: string }>;

function wideningCopy(intent: HomePolicyWideningIntent, host: string): WideningCopy {
    switch (intent.kind) {
        case 'admission_anyone':
            return {
                title: t('homeGovernance.signInPolicy.widening.titleAnyone'),
                exposure: t('homeGovernance.signInPolicy.widening.exposureAnyone', { host }),
                confirm: t('homeGovernance.signInPolicy.widening.confirmAnyone'),
            };
        case 'admission_invited':
            return {
                title: t('homeGovernance.signInPolicy.widening.titleInvited'),
                exposure: t('homeGovernance.signInPolicy.widening.exposureInvited', { host }),
                confirm: t('homeGovernance.signInPolicy.widening.confirmInvited'),
            };
        case 'method':
            return {
                title: t('homeGovernance.signInPolicy.widening.titleMethod', { method: intent.methodName }),
                exposure: t('homeGovernance.signInPolicy.widening.exposureMethod', { host, method: intent.methodName }),
                confirm: t('homeGovernance.signInPolicy.widening.confirmMethod', { method: intent.methodName }),
            };
        case 'anonymous_signup':
            return {
                title: t('homeGovernance.signInPolicy.widening.titleAnonymous'),
                exposure: t('homeGovernance.signInPolicy.widening.exposureAnonymous', { host }),
                confirm: t('homeGovernance.signInPolicy.widening.confirmAnonymous'),
            };
        case 'unencrypted':
            return {
                title: t('homeGovernance.signInPolicy.widening.titleUnencrypted'),
                exposure: t('homeGovernance.signInPolicy.widening.exposureUnencrypted', { host }),
                confirm: t('homeGovernance.signInPolicy.widening.confirmUnencrypted'),
            };
        case 'other':
            return {
                title: t('homeGovernance.signInPolicy.widening.titleOther'),
                exposure: t('homeGovernance.signInPolicy.widening.exposureOther', { host }),
                confirm: t('homeGovernance.signInPolicy.widening.confirmOther'),
            };
    }
}

/**
 * Show–Guide–Confirm for a save the Home refused as widening (lab `hcPolicies-W`), as the words of
 * the page's inline consequence card: the title states the outcome, then who can now reach it at
 * this Home's own address, that existing accounts and invitations stay as they are, and that the
 * change is recorded in Activity. The primary action names the outcome.
 */
export function homePolicyWideningCopy(intent: HomePolicyWideningIntent, host: string): Readonly<{
    title: string;
    lines: readonly string[];
    confirm: string;
}> {
    const copy = wideningCopy(intent, host);
    return {
        title: copy.title,
        lines: [copy.exposure, t('homeGovernance.signInPolicy.widening.unchanged'), t('homeGovernance.signInPolicy.widening.recorded')],
        confirm: copy.confirm,
    };
}
