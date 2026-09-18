export const PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY_ENV = 'HAPPIER_UPDATER_FORWARD_RECOVERY_CAPABILITY';
export const PERSONAL_HOME_UPDATER_FORWARD_RECOVERY_CAPABILITY = 'personal-home-update-record-v1';

export const RELAY_RUNTIME_IRREVERSIBLE_MIGRATIONS = Object.freeze([
    { name: '20260725100000_activate_qualified_connected_accounts_v4', label: 'Qualified Connected Accounts V4' },
    { name: '20260905220000_add_team_home_governance', label: 'Account lifecycle status' },
    { name: '20260905235000_add_account_session_read_state', label: 'Account Session read-state owner' },
    { name: '20260906160100_contract_session_data_key_envelopes', label: 'Session data-key envelopes' },
] as const);
