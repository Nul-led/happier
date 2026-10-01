/** The managed runtime purpose positively identifies a Personal Home. */
export const PERSONAL_HOME_RUNTIME_PURPOSE = 'personal-home';

export function isPersonalHomeRuntimePurpose(purpose: string | null | undefined): boolean {
    return purpose === PERSONAL_HOME_RUNTIME_PURPOSE;
}
