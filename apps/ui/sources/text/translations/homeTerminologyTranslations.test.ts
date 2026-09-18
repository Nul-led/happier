import { describe, expect, it } from 'vitest';

import { ca } from './ca';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it as itTranslations } from './it';
import { ja } from './ja';
import { pl } from './pl';
import { pt } from './pt';
import { ru } from './ru';
import { zhHans } from './zh-Hans';
import { zhHant } from './zh-Hant';

const LOCALES = { ca, de, en, es, fr, it: itTranslations, ja, pl, pt, ru, zhHans, zhHant } as const;
const REACHABILITY_LOCALES = { de, en, es, fr, it: itTranslations, ja, pl, pt, ru, zhHans } as const;

describe('Home terminology translations', () => {
    it('uses Home, not Relay, for ordinary Home profiles, groups, and daemon alignment', () => {
        const failures = Object.entries(LOCALES).flatMap(([locale, translations]) => {
            const { multiServerView, relayDrift } = translations.server;
            const { retention } = translations.server;
            const values = [
                translations.server.serverConfiguration,
                translations.server.autoConfigHint,
                multiServerView.title,
                multiServerView.footer,
                multiServerView.presentationTitle,
                multiServerView.presentation.flatWithBadges,
                multiServerView.presentation.groupedByServer,
                relayDrift.bannerDifferentRelayTitle,
                relayDrift.bannerDifferentRelayDescription({ activeRelayUrl: 'HOME_A', daemonRelayUrl: 'HOME_B' }),
                relayDrift.bannerNeedsAuthTitle,
                relayDrift.bannerNeedsAuthDescription({ activeRelayUrl: 'HOME_A' }),
                relayDrift.bannerNotConfiguredTitle,
                relayDrift.bannerNotConfiguredDescription({ activeRelayUrl: 'HOME_A' }),
                relayDrift.bannerNotInstalledTitle,
                relayDrift.bannerNotInstalledDescription({ activeRelayUrl: 'HOME_A' }),
                relayDrift.bannerNotRunningTitle,
                relayDrift.bannerNotRunningDescription({ activeRelayUrl: 'HOME_A' }),
                relayDrift.repairAction,
                relayDrift.progressTitle,
                relayDrift.progressStepConfigureRelay,
                retention.relayCleanupSummary({ policies: 'POLICIES' }),
                retention.sessionNotice({ count: 2 }),
            ];

            return values.some((value) => /relay|server/i.test(value))
                || !values.slice(-2).every((value) => /Home/.test(value))
                ? [`${locale}: ordinary Home copy still uses Relay or Server`]
                : [];
        });

        expect(failures).toEqual([]);
    });

    it('describes Tailscale as the way to reach a Home, not a relay', () => {
        const failures = Object.entries(REACHABILITY_LOCALES).flatMap(([locale, translations]) => {
            const copy = translations.server.reachabilityRemediation.tailscale;
            const values = [copy.title, copy.desktopBody, copy.webBody, copy.nativeBody];
            return values.some((value) => /relay/i.test(value))
                || values.some((value) => !/Home/.test(value))
                ? [`${locale}: Tailscale remediation does not consistently identify the Home`]
                : [];
        });

        expect(failures).toEqual([]);
    });
});
