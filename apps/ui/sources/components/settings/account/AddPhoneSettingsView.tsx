import * as React from 'react';

import { useAuth } from '@/auth/context/AuthContext';
import { formatHomeEnrollmentTargetLabel } from '@/auth/pairing/pairingPresentation';
import { HomePairingPanel } from '@/components/auth/pairing/HomePairingPanel';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { buildHomeConnectionDescriptorForProfile, listServerProfiles } from '@/sync/domains/server/serverProfiles';
import { resolveHomeDisplayLabel } from '@/components/settings/server/homeDisplayName';
import { t } from '@/text';

/**
 * Settings → Add your phone: which Home the phone joins (when there is a choice), then the Home
 * pairing panel — the same panel Home's Get set up grows into and its modal shows — laid out for a
 * page, where the link can also be read and the live code cancelled.
 */
export const AddPhoneSettingsView = React.memo(function AddPhoneSettingsView() {
    const auth = useAuth();
    const profilesGeneration = useServerProfilesGeneration();
    // The default target is whichever Home has focus when pairing starts; the live
    // subscription lives in usePairingSession, so a plain read is enough here.
    const activeServerId = getActiveServerSnapshot().serverId;
    // Only a saved Home that already publishes a connection descriptor can enrol a
    // device; the same admission the restore surface uses, so the picker never offers
    // a Home the QR could not be issued for.
    const enrollableHomes = React.useMemo(() => listServerProfiles().flatMap((profile) => {
        const descriptor = buildHomeConnectionDescriptorForProfile(profile);
        return descriptor ? [{ profile, descriptor }] : [];
    }), [profilesGeneration]);
    const [chosenHomeId, setChosenHomeId] = React.useState<string | null>(null);
    // Only an explicit pick overrides the default. Leaving it null while the focused
    // Home settles keeps the pairing target stable, so the live invite is not torn
    // down and reissued the moment the active snapshot resolves.
    const selectedHomeId = chosenHomeId && enrollableHomes.some(({ profile }) => profile.id === chosenHomeId)
        ? chosenHomeId
        : null;
    const targetProfileId = selectedHomeId ?? activeServerId;
    const isAuthenticated = auth.isAuthenticated;

    return (
        <ItemList presentation="page">
            <SettingsPageHeader description={t('connect.addPhonePage.description')} />

            {!isAuthenticated ? (
                <ItemGroup title={t('connect.addPhonePage.qrTitle')}>
                    <Item
                        testID="add-phone-sign-in-first"
                        title={t('connect.addPhonePage.signInFirst')}
                        subtitle={t('modals.pleaseSignInFirst')}
                        subtitleLines={0}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}

            {isAuthenticated && enrollableHomes.length > 1 ? (
                <ItemGroup
                    title={t('connect.addPhoneChooseHomeTitle')}
                    description={t('connect.addPhoneChooseHomeFooter')}
                    accessibilityRole="radiogroup"
                    accessibilityLabel={t('connect.addPhoneChooseHomeTitle')}
                >
                    {enrollableHomes.map(({ profile, descriptor }) => (
                        <Item
                            key={profile.id}
                            testID={`add-phone-home-profile-${profile.id}`}
                            title={resolveHomeDisplayLabel(profile, profile.id)}
                            subtitle={formatHomeEnrollmentTargetLabel(descriptor)}
                            selected={profile.id === targetProfileId}
                            accessibilityRole="radio"
                            accessibilityChecked={profile.id === targetProfileId}
                            showChevron={false}
                            onPress={() => setChosenHomeId(profile.id)}
                        />
                    ))}
                </ItemGroup>
            ) : null}

            {isAuthenticated ? (
                <ItemGroup surface="none">
                    {/* One panel per target Home: choosing another Home ends this code and makes one there. */}
                    <HomePairingPanel
                        key={selectedHomeId ?? 'focused-home'}
                        purpose="phone"
                        layout="page"
                        testIDPrefix="add-phone"
                        targetProfileId={selectedHomeId}
                    />
                </ItemGroup>
            ) : null}
        </ItemList>
    );
});
