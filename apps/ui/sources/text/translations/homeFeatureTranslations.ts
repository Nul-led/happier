// Home feature labels (plan `2026-09-26-home-owner-console` §3.8 "Labels"): one title and one
// outcome description per server feature id, nested by the id's dot segments so the key is literally
// `homeFeatures.<featureId>.title`. A family node may also carry `group`, the Advanced section label
// for that family. Drafted from each catalog description and edited to product copy; the Common ten
// follow the console lab. Client-only features appear only where a server feature depends on them.
//
// The `keys` node labels each feature's limit and mode keys by env name (English drafted from the
// server registry descriptions). `homeFeatureLabels.ts` is the one reader; `homeFeatureLabels.test.ts` checks every server feature
// id (and every Advanced family) has a label here.

const en = {
    teams: {
        title: 'Teams',
        description: 'Groups with shared sessions, machines and access.',
        credentialResources: {
            title: 'Team credentials',
            description: 'Credentials a Team shares with its sessions.',
            externalApi: {
                title: 'Team credentials API',
                description: 'Lets outside tools use a Team’s credentials through the API.',
            },
        },
    },
    automations: {
        title: 'Automations',
        description: 'Scheduled and triggered agent work.',
    },
    workflows: {
        title: 'Workflows',
        description: 'Multi-step agent pipelines.',
    },
    pets: {
        sync: {
            title: 'Pet sync',
            description: 'Keeps each person’s pets on all their devices.',
        },
    },
    voice: {
        title: 'Voice',
        description: 'Talk to your agents.',
        happierVoice: {
            title: 'Happier voice',
            description: 'Voice through the voice service this Home provides.',
        },
    },
    connectedServices: {
        group: 'Connected services',
        quotas: {
            title: 'Quota meters',
            description: 'Shows how much quota each connected account has left.',
        },
        subscription: {
            title: 'Subscription status',
            description: 'Shows the plan and status of each connected account.',
        },
        accountGroups: {
            title: 'Account groups',
            description: 'Group connected accounts into pools.',
        },
        accountFallback: {
            title: 'Account fallback',
            description: 'Switch to the next account in a pool when one runs out.',
        },
        autoQuotaReset: {
            title: 'Automatic quota reset',
            description: 'Spend banked quota resets once every account in a pool runs out.',
        },
        autoDisablePlanInvalid: {
            title: 'Skip unusable accounts',
            description: 'Turn off pool accounts that can’t use the selected model.',
        },
        poolQuotaLimitSelection: {
            title: 'Pool quota limits',
            description: 'Choose which provider quota each pool follows.',
        },
    },
    updates: {
        ota: {
            title: 'Over-the-air updates',
            description: 'Apps install updates without a store release.',
        },
    },
    attachments: {
        uploads: {
            title: 'Attachments',
            description: 'Send files and images to agents in a session.',
        },
    },
    sharing: {
        group: 'Sharing',
        session: {
            title: 'Session sharing',
            description: 'Share a session with someone on this Home.',
        },
        public: {
            title: 'Public links',
            description: 'Share session content with a public link.',
        },
        contentKeys: {
            title: 'Encrypted sharing',
            description: 'Exchange keys so shared sessions stay end-to-end encrypted.',
        },
        pendingQueueV2: {
            title: 'Shared message queue',
            description: 'Queue messages for a shared session while its agent is busy.',
        },
        pendingDeliveryState: {
            title: 'Queue delivery tracking',
            description: 'Remember which queued messages reached the agent.',
        },
    },
    sessions: {
        title: 'Sessions',
        description: 'Sessions and their controls.',
        group: 'Sessions',
        handoff: {
            title: 'Session handoff',
            description: 'Move a running session to another machine.',
        },
        ephemeralRunner: {
            title: 'Ephemeral runners',
            description: 'Start a session on a throwaway machine.',
        },
        agentSwitching: {
            title: 'Agent switching',
            description: 'Continue a session with another coding agent.',
        },
        folders: {
            title: 'Session folders',
            description: 'Organise sessions in folders.',
        },
        drafts: {
            title: 'Synced drafts',
            description: 'Keep unsent messages and new-session drafts on every device.',
        },
        following: {
            title: 'Following',
            description: 'Follow a session to get its updates and notifications.',
        },
        conversations: {
            title: 'Conversations',
            description: 'People talk and mention each other inside a shared session.',
        },
        board: {
            title: 'Session board',
            description: 'Arrange sessions and their items on shared boards.',
        },
        filteredListing: {
            title: 'Filtered listing',
            description: 'Filter the session list on this Home before it pages.',
        },
        usageLimitRecovery: {
            title: 'Usage-limit recovery',
            description: 'Wait and resume, or retry, when an agent hits a usage limit.',
        },
    },
    machines: {
        title: 'Machines',
        description: 'Connecting to your machines.',
        group: 'Machines',
        pools: {
            title: 'Machine pools',
            description: 'Fall back to the next machine when one is offline.',
        },
        transfer: {
            title: 'Machine transfers',
            description: 'Moving data between machines.',
            directPeer: {
                title: 'Direct transfers',
                description: 'Move data straight between machines.',
            },
            serverRouted: {
                title: 'Transfers through this Home',
                description: 'Move data between machines through this Home when they can’t connect directly.',
            },
        },
        peerMediation: {
            title: 'Machine connections',
            description: 'Tunnels, streams and access between machines.',
            observability: {
                title: 'Connection diagnostics',
                description: 'Show how tunnels, streams and previews between machines are connected.',
            },
        },
        tunnel: {
            title: 'Machine tunnels',
            description: 'Opening ports between machines.',
            directPeer: {
                title: 'Direct tunnels',
                description: 'Open ports between machines directly.',
            },
            serverRouted: {
                title: 'Tunnels through this Home',
                description: 'Open ports between machines through this Home when they can’t connect directly.',
            },
        },
        liveStream: {
            title: 'Live streams',
            description: 'Streaming a machine’s screen.',
            directPeer: {
                title: 'Direct live streams',
                description: 'Stream a machine’s screen straight to your device.',
            },
            serverRouted: {
                title: 'Live streams through this Home',
                description: 'Stream a machine’s screen through this Home when a direct stream fails.',
            },
        },
        rpc: {
            title: 'Machine calls',
            description: 'Reaching machines directly.',
            directPeer: {
                title: 'Direct machine calls',
                description: 'Reach a machine directly instead of through this Home.',
            },
        },
    },
    localServices: {
        title: 'Local services',
        description: 'See and open the services running on your machines.',
        group: 'Local services',
        inventory: {
            title: 'Service inventory',
            description: 'List the ports and services running on each machine.',
        },
        managed: {
            title: 'Managed services',
            description: 'Start, name and watch services from Happier.',
        },
        launcher: {
            title: 'Service launcher',
            description: 'Suggest services to open and preview.',
        },
        actions: {
            title: 'Service actions',
            description: 'Copy, preview and forget services.',
            terminate: {
                title: 'Stop services',
                description: 'Stop a detected service’s process.',
            },
        },
        preview: {
            title: 'Service previews',
            description: 'Preview a local service privately inside a session.',
        },
        publicPreview: {
            title: 'Public previews',
            description: 'Share a service preview at a public address.',
        },
    },
    browser: {
        title: 'Browser',
        description: 'Open pages, previews and hosted views inside Happier.',
        group: 'Browser',
        viewTargets: {
            title: 'Browser views',
            description: 'Open previews, plugin pages and links in the right browser view.',
        },
        internal: {
            title: 'Built-in browser',
            description: 'Browse inside Happier with its own sessions and profiles.',
        },
        sidecar: {
            title: 'Sidecar browser',
            description: 'A separate managed browser for heavy automation.',
        },
        diagnostics: {
            title: 'Browser devtools',
            description: 'Console, network and devtools events from the built-in browser.',
        },
        context: {
            title: 'Browser context',
            description: 'Attach what’s on a page to a message or an agent.',
        },
        automation: {
            title: 'Browser automation',
            description: 'Let agents click, type and navigate in the built-in browser.',
        },
        recording: {
            title: 'Browser recordings',
            description: 'Record browser sessions as evidence.',
        },
    },
    plugins: {
        title: 'Plugins from outside Happier',
        description: 'Install plugins from npm and your own sources.',
        group: 'Plugins',
        webhooks: {
            title: 'Plugin webhooks',
            description: 'Let plugins receive webhooks from outside services.',
        },
        ui: {
            title: 'Plugin screens',
            description: 'Show the screens and panels plugins provide.',
            hostedWeb: {
                title: 'Web plugin screens',
                description: 'Show plugin screens built for the web.',
            },
            reactNativeBundles: {
                title: 'Native plugin screens',
                description: 'Run trusted plugin screens built with React Native.',
            },
        },
    },
    devices: {
        title: 'Devices',
        description: 'Simulators and connected devices.',
        simulatorPreview: {
            title: 'Simulator previews',
            description: 'Show simulators and emulators from your machines.',
        },
    },
    social: {
        friends: {
            title: 'Friends',
            description: 'Add friends and see what they share.',
        },
    },
    auth: {
        group: 'Sign-in',
        recovery: {
            providerReset: {
                title: 'Reset through a provider',
                description: 'Recover an account by signing in with its identity provider.',
            },
        },
        login: {
            keyChallenge: {
                title: 'Key sign-in',
                description: 'Sign in by proving a device’s key.',
            },
        },
        mtls: {
            title: 'Client certificates',
            description: 'Sign in with a client certificate (mTLS).',
        },
        ui: {
            recoveryKeyReminder: {
                title: 'Recovery key reminder',
                description: 'Remind people to save their recovery key.',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'Sign in by scanning',
                description: 'Sign in on a phone by scanning a code on a computer.',
            },
            boundQrV2: {
                title: 'Safer pairing codes',
                description: 'Pairing codes that only work for this Home and direction.',
            },
        },
    },
    encryption: {
        group: 'Encryption',
        plaintextStorage: {
            title: 'Unencrypted storage',
            description: 'Store sessions without end-to-end encryption.',
        },
        accountOptOut: {
            title: 'Encryption opt-out',
            description: 'Let each person turn end-to-end encryption off.',
        },
    },
    remoteHosts: {
        group: 'Remote hosts',
        management: {
            title: 'Remote hosts',
            description: 'Save SSH hosts to run sessions on.',
        },
        secretMaterial: {
            title: 'Saved host secrets',
            description: 'Save passwords and keys for SSH hosts.',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: 'Keyless accounts',
            description: 'Accounts without end-to-end encryption keys.',
        },
    },
    bugReports: {
        title: 'Bug reports',
        description: 'Send bug reports with diagnostics.',
    },
    terminal: {
        group: 'Terminal',
        embeddedPty: {
            title: 'Terminal',
            description: 'Open a terminal on a machine inside Happier.',
        },
        transport: {
            byteStream: {
                title: 'Streamed terminal',
                description: 'A faster connection for the built-in terminal.',
            },
        },
    },
    search: {
        title: 'Search',
        description: 'Search across sessions and transcripts.',
    },
    providers: {
        title: 'Model providers',
        description: 'Connect model providers and choose models for agents.',
        group: 'Model providers',
        localDiscovery: {
            title: 'Find local providers',
            description: 'Find model servers running on your machines.',
        },
        localModelManagement: {
            title: 'Local model management',
            description: 'Download and manage local models.',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'Report service address',
            description: 'Where bug reports are sent. Left blank, no report service is offered.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: 'Include diagnostics by default',
            description: 'The report form includes diagnostics unless the reporter opts out.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: 'Largest attachment',
            description: 'Largest file a bug report may attach, in bytes.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'Upload time limit',
            description: 'How long a bug report upload may take, in milliseconds.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: 'Accepted attachment kinds',
            description: 'Kinds of attachment bug reports accept. Empty accepts the usual kinds.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'Context window',
            description: 'How far back a bug report collects context, in milliseconds.',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: 'Voice needs a subscription',
            description: 'Only subscribers can use voice. When not set, production requires it and other setups don’t.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'Largest pet manifest',
            description: 'Largest pet manifest accepted, in bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'Largest pet spritesheet',
            description: 'Largest pet spritesheet accepted, in bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'Largest pet package',
            description: 'Largest pet package accepted, in bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: 'Imported pets per person',
            description: 'Most imported pets one person may keep.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: 'Imported pet storage per person',
            description: 'Most bytes of imported pets one person may keep.',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: 'Encrypted custom pets',
            description: 'Reserved for later. Encrypted custom pets are not synced yet, so this stays off.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'Largest transfer through this Home',
            description: 'Largest file a transfer through this Home carries, in bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: 'Transfers at once per connection',
            description: 'Most transfers through this Home one connection runs at once.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'Data per tunnel',
            description: 'Most bytes one tunnel through this Home carries.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: 'Tunnels per connection',
            description: 'Most tunnels through this Home one connection holds open.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Largest tunnel frame',
            description: 'Largest frame a tunnel through this Home carries, in bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'Tunnel encodings',
            description: 'Frame encodings tunnels through this Home accept. Empty uses the standard ones.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: 'Preferred tunnel encoding',
            description: 'The frame encoding to use first. It must be one of the accepted encodings.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'Largest frame header',
            description: 'Largest binary frame header, in bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'Largest frame payload',
            description: 'Largest raw payload in one frame, in bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'Largest framed message',
            description: 'Largest framed message, in bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'Streams at once per tunnel',
            description: 'Most streams one tunnel runs at once.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'Streams per tunnel',
            description: 'Most streams one tunnel opens over its lifetime.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'Data per stream',
            description: 'Most bytes one stream carries.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'Data per tunnel, all streams',
            description: 'Most bytes all streams of one tunnel carry together.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'Idle stream time limit',
            description: 'How long a stream may stay idle before it closes, in milliseconds.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'Idle tunnel time limit',
            description: 'How long a tunnel through this Home may stay idle before it closes, in milliseconds.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'Tunnel idle time limit',
            description: 'How long a tunnel may stay idle before it closes, in milliseconds.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'Longest tunnel',
            description: 'Longest a tunnel stays open, in milliseconds.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'Ports tunnels may reach',
            description: 'Ports tunnels may open. Empty allows only the default ones.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'Preview link lifetime',
            description: 'How long a private preview link works, in milliseconds.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'Preview domain',
            description: 'Domain that serves each preview on its own address. Empty serves previews under this Home’s address.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: 'Public preview modes',
            description: 'Ways a preview may be made public.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: 'Longest public preview',
            description: 'Longest a preview stays public, in milliseconds. Empty keeps the standard limit.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: 'Public previews at once',
            description: 'Most previews public at the same time. Empty keeps the standard limit.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'Require DNS and TLS',
            description: 'Public previews need DNS and TLS.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: 'Public preview audit log',
            description: 'Where public previews are recorded. Public previews need one.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: 'Audit log file',
            description: 'File the public preview audit log is written to.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'Allow the test audit log',
            description: 'For development only: accept the in-memory test audit log. Ignored in production.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: 'Public preview rate limits',
            description: 'Rate-limit profiles public previews may use.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'Rate-limit checker',
            description: 'How public preview requests are rate limited. Public previews need one.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'Requests per window',
            description: 'Requests a public preview allows in each window.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'Rate-limit window',
            description: 'Length of each rate-limit window, in milliseconds.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'Allow the test rate limiter',
            description: 'For development only: accept the in-memory test rate limiter. Ignored in production.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: 'Webhooks in progress',
            description: 'Most webhook requests this server handles at once.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Webhook memory',
            description: 'Most memory webhook requests in progress may use, in bytes. Empty allows what the request limit already permits.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'Webhooks per minute per route',
            description: 'Webhook requests per minute on one route.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'Webhooks at once per route',
            description: 'Webhook requests in progress on one route.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'Webhooks per minute per endpoint',
            description: 'Webhook requests per minute on one endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'Webhooks at once per endpoint',
            description: 'Webhook requests in progress on one endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: 'Webhooks per minute per person',
            description: 'Webhook requests per minute for one person.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: 'Webhooks at once per person',
            description: 'Webhook requests in progress for one person.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'Largest plugin screen bundle',
            description: 'Largest plugin screen bundle this Home hosts, in bytes.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: 'Plugin screen storage per person',
            description: 'Most bytes of plugin screen bundles one person may store.',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'Largest plugin data row',
            description: 'Largest row a plugin stores, in bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'Largest plugin data batch',
            description: 'Largest batch of plugin data changes, in bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'Rows per plugin data batch',
            description: 'Most rows in one batch of plugin data changes.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: 'Plugin data rows per person',
            description: 'Most rows of plugin data one person may store.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: 'Plugin data storage per person',
            description: 'Most bytes of plugin data one person may store.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: 'Highest stream bitrate',
            description: 'Highest bitrate of a live stream through this Home, in bits per second.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: 'Highest stream frame rate',
            description: 'Highest frame rate of a live stream through this Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Largest stream frame',
            description: 'Largest frame of a live stream through this Home, in bytes.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'Longest live stream',
            description: 'Longest a live stream through this Home runs, in milliseconds.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'Data per live stream',
            description: 'Most bytes one live stream through this Home carries.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: 'Live streams at once per person',
            description: 'Most live streams through this Home one person runs at once.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: 'Live streams at once per connection',
            description: 'Most live streams through this Home one connection runs at once.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'Live streams at once per machine',
            description: 'Most live streams through this Home one machine runs at once.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: 'Connection signing key ID',
            description: 'Names the key that signs connections between machines. Without a signing key, these connections are off.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: 'Connection signing private key',
            description: 'Private key that signs connections between machines.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: 'Connection signing public key',
            description: 'Public key matching the signing key. When empty it comes from the private key.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: 'Signing key expiry',
            description: 'When the signing key expires, as a timestamp in milliseconds.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'Find friends by username',
            description: 'People can find friends by username as well as by linked account.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: 'Friend matching provider',
            description: 'The sign-in provider used to match friends.',
        },
    },
};

const de: typeof en = {
    teams: {
        title: 'Teams',
        description: 'Gruppen mit geteilten Sessions, Maschinen und Zugriff.',
        credentialResources: {
            title: 'Team-Zugangsdaten',
            description: 'Zugangsdaten, die ein Team mit seinen Sessions teilt.',
            externalApi: {
                title: 'API für Team-Zugangsdaten',
                description: 'Externe Tools nutzen die Zugangsdaten eines Teams über die API.',
            },
        },
    },
    automations: {
        title: 'Automatisierungen',
        description: 'Geplante und ausgelöste Agentenarbeit.',
    },
    workflows: {
        title: 'Workflows',
        description: 'Mehrstufige Agenten-Pipelines.',
    },
    pets: {
        sync: {
            title: 'Pet-Synchronisierung',
            description: 'Hält die Pets jeder Person auf all ihren Geräten.',
        },
    },
    voice: {
        title: 'Sprache',
        description: 'Sprich mit deinen Agenten.',
        happierVoice: {
            title: 'Happier-Sprache',
            description: 'Sprache über den Sprachdienst, den dieses Home bereitstellt.',
        },
    },
    connectedServices: {
        group: 'Verbundene Dienste',
        quotas: {
            title: 'Kontingentanzeigen',
            description: 'Zeigt, wie viel Kontingent jedes verbundene Konto noch hat.',
        },
        subscription: {
            title: 'Abostatus',
            description: 'Zeigt Tarif und Status jedes verbundenen Kontos.',
        },
        accountGroups: {
            title: 'Kontogruppen',
            description: 'Fasse verbundene Konten zu Pools zusammen.',
        },
        accountFallback: {
            title: 'Konto-Ausweichlösung',
            description: 'Wechselt zum nächsten Konto im Pool, wenn eines erschöpft ist.',
        },
        autoQuotaReset: {
            title: 'Automatisches Kontingent-Reset',
            description: 'Nutzt angesparte Kontingent-Resets, sobald alle Konten eines Pools erschöpft sind.',
        },
        autoDisablePlanInvalid: {
            title: 'Unbrauchbare Konten überspringen',
            description: 'Deaktiviert Pool-Konten, die das gewählte Modell nicht nutzen können.',
        },
        poolQuotaLimitSelection: {
            title: 'Pool-Kontingentgrenzen',
            description: 'Wähle, welchem Anbieterkontingent jeder Pool folgt.',
        },
    },
    updates: {
        ota: {
            title: 'Over-the-Air-Updates',
            description: 'Apps installieren Updates ohne Store-Veröffentlichung.',
        },
    },
    attachments: {
        uploads: {
            title: 'Anhänge',
            description: 'Sende Dateien und Bilder an Agenten in einer Session.',
        },
    },
    sharing: {
        group: 'Freigabe',
        session: {
            title: 'Session-Freigabe',
            description: 'Teile eine Session mit jemandem auf diesem Home.',
        },
        public: {
            title: 'Öffentliche Links',
            description: 'Teile Session-Inhalte über einen öffentlichen Link.',
        },
        contentKeys: {
            title: 'Verschlüsselte Freigabe',
            description: 'Tauscht Schlüssel aus, damit geteilte Sessions Ende-zu-Ende-verschlüsselt bleiben.',
        },
        pendingQueueV2: {
            title: 'Geteilte Nachrichtenwarteschlange',
            description: 'Stellt Nachrichten für eine geteilte Session in die Warteschlange, während ihr Agent beschäftigt ist.',
        },
        pendingDeliveryState: {
            title: 'Zustellverfolgung der Warteschlange',
            description: 'Merkt sich, welche Nachrichten aus der Warteschlange beim Agenten angekommen sind.',
        },
    },
    sessions: {
        title: 'Sessions',
        description: 'Sessions und ihre Steuerung.',
        group: 'Sessions',
        handoff: {
            title: 'Session-Übergabe',
            description: 'Verschiebe eine laufende Session auf eine andere Maschine.',
        },
        ephemeralRunner: {
            title: 'Kurzlebige Runner',
            description: 'Starte eine Session auf einer Wegwerf-Maschine.',
        },
        agentSwitching: {
            title: 'Agentenwechsel',
            description: 'Setze eine Session mit einem anderen Coding-Agenten fort.',
        },
        folders: {
            title: 'Session-Ordner',
            description: 'Ordne Sessions in Ordnern.',
        },
        drafts: {
            title: 'Synchronisierte Entwürfe',
            description: 'Behalte ungesendete Nachrichten und Entwürfe neuer Sessions auf jedem Gerät.',
        },
        following: {
            title: 'Folgen',
            description: 'Folge einer Session, um ihre Updates und Benachrichtigungen zu erhalten.',
        },
        conversations: {
            title: 'Unterhaltungen',
            description: 'Personen sprechen und erwähnen sich gegenseitig in einer geteilten Session.',
        },
        board: {
            title: 'Session-Board',
            description: 'Ordne Sessions und ihre Elemente auf geteilten Boards an.',
        },
        filteredListing: {
            title: 'Gefilterte Liste',
            description: 'Filtert die Session-Liste auf diesem Home, bevor sie geblättert wird.',
        },
        usageLimitRecovery: {
            title: 'Wiederaufnahme nach Nutzungslimit',
            description: 'Warten und fortsetzen oder erneut versuchen, wenn ein Agent ein Nutzungslimit erreicht.',
        },
    },
    machines: {
        title: 'Maschinen',
        description: 'Verbindung zu deinen Maschinen.',
        group: 'Maschinen',
        pools: {
            title: 'Maschinen-Pools',
            description: 'Weiche auf die nächste Maschine aus, wenn eine offline ist.',
        },
        transfer: {
            title: 'Maschinenübertragungen',
            description: 'Daten zwischen Maschinen übertragen.',
            directPeer: {
                title: 'Direkte Übertragungen',
                description: 'Überträgt Daten direkt zwischen Maschinen.',
            },
            serverRouted: {
                title: 'Übertragungen über dieses Home',
                description: 'Überträgt Daten über dieses Home, wenn Maschinen sich nicht direkt verbinden können.',
            },
        },
        peerMediation: {
            title: 'Maschinenverbindungen',
            description: 'Tunnel, Streams und Zugriff zwischen Maschinen.',
            observability: {
                title: 'Verbindungsdiagnose',
                description: 'Zeigt, wie Tunnel, Streams und Vorschauen zwischen Maschinen verbunden sind.',
            },
        },
        tunnel: {
            title: 'Maschinentunnel',
            description: 'Ports zwischen Maschinen öffnen.',
            directPeer: {
                title: 'Direkte Tunnel',
                description: 'Öffnet Ports direkt zwischen Maschinen.',
            },
            serverRouted: {
                title: 'Tunnel über dieses Home',
                description: 'Öffnet Ports über dieses Home, wenn Maschinen sich nicht direkt verbinden können.',
            },
        },
        liveStream: {
            title: 'Livestreams',
            description: 'Den Bildschirm einer Maschine streamen.',
            directPeer: {
                title: 'Direkte Livestreams',
                description: 'Streamt den Bildschirm einer Maschine direkt auf dein Gerät.',
            },
            serverRouted: {
                title: 'Livestreams über dieses Home',
                description: 'Streamt den Bildschirm einer Maschine über dieses Home, wenn ein direkter Stream scheitert.',
            },
        },
        rpc: {
            title: 'Maschinenaufrufe',
            description: 'Maschinen direkt erreichen.',
            directPeer: {
                title: 'Direkte Maschinenaufrufe',
                description: 'Erreicht eine Maschine direkt statt über dieses Home.',
            },
        },
    },
    localServices: {
        title: 'Lokale Dienste',
        description: 'Sieh und öffne die Dienste, die auf deinen Maschinen laufen.',
        group: 'Lokale Dienste',
        inventory: {
            title: 'Dienstübersicht',
            description: 'Listet die Ports und Dienste auf, die auf jeder Maschine laufen.',
        },
        managed: {
            title: 'Verwaltete Dienste',
            description: 'Starte, benenne und überwache Dienste aus Happier.',
        },
        launcher: {
            title: 'Dienststarter',
            description: 'Schlägt Dienste zum Öffnen und für die Vorschau vor.',
        },
        actions: {
            title: 'Dienstaktionen',
            description: 'Dienste kopieren, in der Vorschau öffnen und vergessen.',
            terminate: {
                title: 'Dienste beenden',
                description: 'Beendet den Prozess eines erkannten Dienstes.',
            },
        },
        preview: {
            title: 'Dienstvorschauen',
            description: 'Zeigt einen lokalen Dienst privat in einer Session an.',
        },
        publicPreview: {
            title: 'Öffentliche Vorschauen',
            description: 'Teile eine Dienstvorschau unter einer öffentlichen Adresse.',
        },
    },
    browser: {
        title: 'Browser',
        description: 'Öffne Seiten, Vorschauen und gehostete Ansichten in Happier.',
        group: 'Browser',
        viewTargets: {
            title: 'Browseransichten',
            description: 'Öffnet Vorschauen, Plugin-Seiten und Links in der passenden Browseransicht.',
        },
        internal: {
            title: 'Integrierter Browser',
            description: 'Surfe in Happier mit eigenen Sitzungen und Profilen.',
        },
        sidecar: {
            title: 'Sidecar-Browser',
            description: 'Ein separater verwalteter Browser für aufwendige Automatisierung.',
        },
        diagnostics: {
            title: 'Browser-Devtools',
            description: 'Konsole, Netzwerk und Devtools-Ereignisse des integrierten Browsers.',
        },
        context: {
            title: 'Browserkontext',
            description: 'Hänge den Inhalt einer Seite an eine Nachricht oder einen Agenten an.',
        },
        automation: {
            title: 'Browserautomatisierung',
            description: 'Agenten klicken, tippen und navigieren im integrierten Browser.',
        },
        recording: {
            title: 'Browseraufzeichnungen',
            description: 'Zeichnet Browsersitzungen als Nachweis auf.',
        },
    },
    plugins: {
        title: 'Plugins von außerhalb Happier',
        description: 'Installiere Plugins aus npm und deinen eigenen Quellen.',
        group: 'Plugins',
        webhooks: {
            title: 'Plugin-Webhooks',
            description: 'Plugins empfangen Webhooks von externen Diensten.',
        },
        ui: {
            title: 'Plugin-Ansichten',
            description: 'Zeigt die Ansichten und Panels, die Plugins bereitstellen.',
            hostedWeb: {
                title: 'Web-Plugin-Ansichten',
                description: 'Zeigt Plugin-Ansichten, die für das Web gebaut sind.',
            },
            reactNativeBundles: {
                title: 'Native Plugin-Ansichten',
                description: 'Führt vertrauenswürdige Plugin-Ansichten aus, die mit React Native gebaut sind.',
            },
        },
    },
    devices: {
        title: 'Geräte',
        description: 'Simulatoren und verbundene Geräte.',
        simulatorPreview: {
            title: 'Simulator-Vorschauen',
            description: 'Zeigt Simulatoren und Emulatoren von deinen Maschinen.',
        },
    },
    social: {
        friends: {
            title: 'Freunde',
            description: 'Füge Freunde hinzu und sieh, was sie teilen.',
        },
    },
    auth: {
        group: 'Anmeldung',
        recovery: {
            providerReset: {
                title: 'Zurücksetzen über einen Anbieter',
                description: 'Stelle ein Konto wieder her, indem du dich mit seinem Identitätsanbieter anmeldest.',
            },
        },
        login: {
            keyChallenge: {
                title: 'Schlüssel-Anmeldung',
                description: 'Melde dich an, indem du den Schlüssel eines Geräts nachweist.',
            },
        },
        mtls: {
            title: 'Client-Zertifikate',
            description: 'Melde dich mit einem Client-Zertifikat (mTLS) an.',
        },
        ui: {
            recoveryKeyReminder: {
                title: 'Erinnerung an den Wiederherstellungsschlüssel',
                description: 'Erinnert Personen daran, ihren Wiederherstellungsschlüssel zu sichern.',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'Anmelden per Scan',
                description: 'Melde dich auf einem Handy an, indem du einen Code auf einem Computer scannst.',
            },
            boundQrV2: {
                title: 'Sicherere Kopplungscodes',
                description: 'Kopplungscodes, die nur für dieses Home und diese Richtung gelten.',
            },
        },
    },
    encryption: {
        group: 'Verschlüsselung',
        plaintextStorage: {
            title: 'Unverschlüsselte Speicherung',
            description: 'Speichert Sessions ohne Ende-zu-Ende-Verschlüsselung.',
        },
        accountOptOut: {
            title: 'Verschlüsselung abwählen',
            description: 'Jede Person kann die Ende-zu-Ende-Verschlüsselung ausschalten.',
        },
    },
    remoteHosts: {
        group: 'Entfernte Hosts',
        management: {
            title: 'Entfernte Hosts',
            description: 'Speichere SSH-Hosts, auf denen Sessions laufen.',
        },
        secretMaterial: {
            title: 'Gespeicherte Host-Geheimnisse',
            description: 'Speichere Passwörter und Schlüssel für SSH-Hosts.',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: 'Schlüssellose Konten',
            description: 'Konten ohne Schlüssel für Ende-zu-Ende-Verschlüsselung.',
        },
    },
    bugReports: {
        title: 'Fehlerberichte',
        description: 'Sende Fehlerberichte mit Diagnosedaten.',
    },
    terminal: {
        group: 'Terminal',
        embeddedPty: {
            title: 'Terminal',
            description: 'Öffne in Happier ein Terminal auf einer Maschine.',
        },
        transport: {
            byteStream: {
                title: 'Gestreamtes Terminal',
                description: 'Eine schnellere Verbindung für das integrierte Terminal.',
            },
        },
    },
    search: {
        title: 'Suche',
        description: 'Durchsuche Sessions und Transkripte.',
    },
    providers: {
        title: 'Modellanbieter',
        description: 'Verbinde Modellanbieter und wähle Modelle für Agenten.',
        group: 'Modellanbieter',
        localDiscovery: {
            title: 'Lokale Anbieter finden',
            description: 'Findet Modellserver, die auf deinen Maschinen laufen.',
        },
        localModelManagement: {
            title: 'Lokale Modellverwaltung',
            description: 'Lade lokale Modelle herunter und verwalte sie.',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'Adresse des Berichtsdiensts',
            description: 'Wohin Fehlerberichte gesendet werden. Bleibt das Feld leer, wird kein Berichtsdienst angeboten.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: 'Diagnosedaten standardmäßig anhängen',
            description: 'Das Berichtsformular enthält Diagnosedaten, sofern die meldende Person sie nicht abwählt.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: 'Größter Anhang',
            description: 'Größte Datei, die ein Fehlerbericht anhängen darf, in Bytes.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'Zeitlimit für Uploads',
            description: 'Wie lange der Upload eines Fehlerberichts dauern darf, in Millisekunden.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: 'Erlaubte Anhangsarten',
            description: 'Arten von Anhängen, die Fehlerberichte annehmen. Leer erlaubt die üblichen Arten.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'Kontextzeitraum',
            description: 'Wie weit ein Fehlerbericht Kontext zurück sammelt, in Millisekunden.',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: 'Sprache erfordert ein Abo',
            description: 'Nur Abonnenten können Sprache nutzen. Ohne Einstellung gilt das in der Produktion, in anderen Setups nicht.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'Größtes Pet-Manifest',
            description: 'Größtes angenommenes Pet-Manifest, in Bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'Größtes Pet-Spritesheet',
            description: 'Größtes angenommenes Pet-Spritesheet, in Bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'Größtes Pet-Paket',
            description: 'Größtes angenommenes Pet-Paket, in Bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: 'Importierte Pets pro Person',
            description: 'Höchstzahl importierter Pets, die eine Person behalten darf.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: 'Speicher für importierte Pets pro Person',
            description: 'Höchstzahl an Bytes importierter Pets, die eine Person behalten darf.',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: 'Verschlüsselte eigene Pets',
            description: 'Für später reserviert. Verschlüsselte eigene Pets werden noch nicht synchronisiert, daher bleibt dies aus.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'Größte Übertragung über dieses Home',
            description: 'Größte Datei, die eine Übertragung über dieses Home transportiert, in Bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: 'Gleichzeitige Übertragungen pro Verbindung',
            description: 'Höchstzahl an Übertragungen über dieses Home, die eine Verbindung gleichzeitig ausführt.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'Daten pro Tunnel',
            description: 'Höchstzahl an Bytes, die ein Tunnel über dieses Home transportiert.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: 'Tunnel pro Verbindung',
            description: 'Höchstzahl an Tunneln über dieses Home, die eine Verbindung offen hält.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Größter Tunnel-Frame',
            description: 'Größter Frame, den ein Tunnel über dieses Home transportiert, in Bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'Tunnel-Kodierungen',
            description: 'Frame-Kodierungen, die Tunnel über dieses Home annehmen. Leer nutzt die Standardkodierungen.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: 'Bevorzugte Tunnel-Kodierung',
            description: 'Die zuerst genutzte Frame-Kodierung. Sie muss zu den angenommenen Kodierungen gehören.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'Größter Frame-Header',
            description: 'Größter binärer Frame-Header, in Bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'Größte Frame-Nutzlast',
            description: 'Größte Rohnutzlast in einem Frame, in Bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'Größte Frame-Nachricht',
            description: 'Größte in Frames verpackte Nachricht, in Bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'Gleichzeitige Streams pro Tunnel',
            description: 'Höchstzahl an Streams, die ein Tunnel gleichzeitig ausführt.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'Streams pro Tunnel',
            description: 'Höchstzahl an Streams, die ein Tunnel während seiner Lebensdauer öffnet.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'Daten pro Stream',
            description: 'Höchstzahl an Bytes, die ein Stream transportiert.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'Daten pro Tunnel, alle Streams',
            description: 'Höchstzahl an Bytes, die alle Streams eines Tunnels zusammen transportieren.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'Zeitlimit für inaktive Streams',
            description: 'Wie lange ein Stream inaktiv sein darf, bevor er geschlossen wird, in Millisekunden.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'Zeitlimit für inaktive Tunnel',
            description: 'Wie lange ein Tunnel über dieses Home inaktiv sein darf, bevor er geschlossen wird, in Millisekunden.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'Inaktivitätslimit für Tunnel',
            description: 'Wie lange ein Tunnel inaktiv sein darf, bevor er geschlossen wird, in Millisekunden.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'Längster Tunnel',
            description: 'Wie lange ein Tunnel höchstens offen bleibt, in Millisekunden.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'Erreichbare Ports für Tunnel',
            description: 'Ports, die Tunnel öffnen dürfen. Leer erlaubt nur die Standardports.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'Gültigkeit von Vorschaulinks',
            description: 'Wie lange ein privater Vorschaulink funktioniert, in Millisekunden.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'Vorschaudomain',
            description: 'Domain, die jede Vorschau unter einer eigenen Adresse bereitstellt. Leer stellt Vorschauen unter der Adresse dieses Home bereit.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: 'Modi für öffentliche Vorschauen',
            description: 'Wege, auf denen eine Vorschau öffentlich gemacht werden darf.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: 'Längste öffentliche Vorschau',
            description: 'Wie lange eine Vorschau höchstens öffentlich bleibt, in Millisekunden. Leer behält das Standardlimit.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: 'Gleichzeitige öffentliche Vorschauen',
            description: 'Höchstzahl gleichzeitig öffentlicher Vorschauen. Leer behält das Standardlimit.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'DNS und TLS erforderlich',
            description: 'Öffentliche Vorschauen benötigen DNS und TLS.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: 'Audit-Log für öffentliche Vorschauen',
            description: 'Wo öffentliche Vorschauen protokolliert werden. Öffentliche Vorschauen benötigen eines.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: 'Audit-Log-Datei',
            description: 'Datei, in die das Audit-Log öffentlicher Vorschauen geschrieben wird.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'Test-Audit-Log erlauben',
            description: 'Nur für die Entwicklung: akzeptiert das In-Memory-Test-Audit-Log. Wird in der Produktion ignoriert.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: 'Ratenlimits für öffentliche Vorschauen',
            description: 'Ratenlimit-Profile, die öffentliche Vorschauen nutzen dürfen.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'Ratenlimit-Prüfer',
            description: 'Wie Anfragen an öffentliche Vorschauen begrenzt werden. Öffentliche Vorschauen benötigen einen.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'Anfragen pro Zeitfenster',
            description: 'Anfragen, die eine öffentliche Vorschau in jedem Zeitfenster erlaubt.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'Ratenlimit-Zeitfenster',
            description: 'Länge jedes Ratenlimit-Zeitfensters, in Millisekunden.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'Test-Ratenbegrenzer erlauben',
            description: 'Nur für die Entwicklung: akzeptiert den In-Memory-Test-Ratenbegrenzer. Wird in der Produktion ignoriert.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: 'Laufende Webhooks',
            description: 'Höchstzahl an Webhook-Anfragen, die dieser Server gleichzeitig bearbeitet.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Webhook-Speicher',
            description: 'Höchstmenge an Arbeitsspeicher für laufende Webhook-Anfragen, in Bytes. Leer erlaubt, was das Anfragelimit bereits zulässt.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'Webhooks pro Minute und Route',
            description: 'Webhook-Anfragen pro Minute auf einer Route.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'Gleichzeitige Webhooks pro Route',
            description: 'Laufende Webhook-Anfragen auf einer Route.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'Webhooks pro Minute und Endpunkt',
            description: 'Webhook-Anfragen pro Minute auf einem Endpunkt.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'Gleichzeitige Webhooks pro Endpunkt',
            description: 'Laufende Webhook-Anfragen auf einem Endpunkt.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: 'Webhooks pro Minute und Person',
            description: 'Webhook-Anfragen pro Minute für eine Person.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: 'Gleichzeitige Webhooks pro Person',
            description: 'Laufende Webhook-Anfragen für eine Person.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'Größtes Plugin-Ansichtspaket',
            description: 'Größtes Plugin-Ansichtspaket, das dieses Home hostet, in Bytes.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: 'Speicher für Plugin-Ansichten pro Person',
            description: 'Höchstzahl an Bytes an Plugin-Ansichtspaketen, die eine Person speichern darf.',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'Größte Plugin-Datenzeile',
            description: 'Größte Zeile, die ein Plugin speichert, in Bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'Größter Plugin-Datenbatch',
            description: 'Größter Batch an Plugin-Datenänderungen, in Bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'Zeilen pro Plugin-Datenbatch',
            description: 'Höchstzahl an Zeilen in einem Batch von Plugin-Datenänderungen.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: 'Plugin-Datenzeilen pro Person',
            description: 'Höchstzahl an Plugin-Datenzeilen, die eine Person speichern darf.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: 'Plugin-Datenspeicher pro Person',
            description: 'Höchstzahl an Bytes an Plugin-Daten, die eine Person speichern darf.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: 'Höchste Stream-Bitrate',
            description: 'Höchste Bitrate eines Livestreams über dieses Home, in Bits pro Sekunde.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: 'Höchste Stream-Bildrate',
            description: 'Höchste Bildrate eines Livestreams über dieses Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Größter Stream-Frame',
            description: 'Größter Frame eines Livestreams über dieses Home, in Bytes.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'Längster Livestream',
            description: 'Wie lange ein Livestream über dieses Home höchstens läuft, in Millisekunden.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'Daten pro Livestream',
            description: 'Höchstzahl an Bytes, die ein Livestream über dieses Home transportiert.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: 'Gleichzeitige Livestreams pro Person',
            description: 'Höchstzahl an Livestreams über dieses Home, die eine Person gleichzeitig betreibt.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: 'Gleichzeitige Livestreams pro Verbindung',
            description: 'Höchstzahl an Livestreams über dieses Home, die eine Verbindung gleichzeitig betreibt.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'Gleichzeitige Livestreams pro Maschine',
            description: 'Höchstzahl an Livestreams über dieses Home, die eine Maschine gleichzeitig betreibt.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: 'ID des Verbindungssignaturschlüssels',
            description: 'Benennt den Schlüssel, der Verbindungen zwischen Maschinen signiert. Ohne Signaturschlüssel sind diese Verbindungen aus.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: 'Privater Verbindungssignaturschlüssel',
            description: 'Privater Schlüssel, der Verbindungen zwischen Maschinen signiert.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: 'Öffentlicher Verbindungssignaturschlüssel',
            description: 'Öffentlicher Schlüssel passend zum Signaturschlüssel. Wenn leer, wird er aus dem privaten Schlüssel abgeleitet.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: 'Ablauf des Signaturschlüssels',
            description: 'Wann der Signaturschlüssel abläuft, als Zeitstempel in Millisekunden.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'Freunde per Benutzername finden',
            description: 'Personen können Freunde per Benutzername und über verknüpfte Konten finden.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: 'Anbieter für Freundesabgleich',
            description: 'Der Anmeldeanbieter, mit dem Freunde abgeglichen werden.',
        },
    },
};

const es: typeof en = {
    teams: {
        title: 'Equipos',
        description: 'Grupos con sesiones, máquinas y acceso compartidos.',
        credentialResources: {
            title: 'Credenciales de equipo',
            description: 'Credenciales que un equipo comparte con sus sesiones.',
            externalApi: {
                title: 'API de credenciales de equipo',
                description: 'Herramientas externas usan las credenciales de un equipo a través de la API.',
            },
        },
    },
    automations: {
        title: 'Automatizaciones',
        description: 'Trabajo de agentes programado y activado por eventos.',
    },
    workflows: {
        title: 'Flujos de trabajo',
        description: 'Pipelines de agentes de varios pasos.',
    },
    pets: {
        sync: {
            title: 'Sincronización de mascotas',
            description: 'Mantiene las mascotas de cada persona en todos sus dispositivos.',
        },
    },
    voice: {
        title: 'Voz',
        description: 'Habla con tus agentes.',
        happierVoice: {
            title: 'Voz de Happier',
            description: 'Voz a través del servicio de voz que ofrece este Home.',
        },
    },
    connectedServices: {
        group: 'Servicios conectados',
        quotas: {
            title: 'Medidores de cuota',
            description: 'Muestra cuánta cuota le queda a cada cuenta conectada.',
        },
        subscription: {
            title: 'Estado de la suscripción',
            description: 'Muestra el plan y el estado de cada cuenta conectada.',
        },
        accountGroups: {
            title: 'Grupos de cuentas',
            description: 'Agrupa cuentas conectadas en pools.',
        },
        accountFallback: {
            title: 'Cuenta de respaldo',
            description: 'Cambia a la siguiente cuenta del pool cuando una se agota.',
        },
        autoQuotaReset: {
            title: 'Restablecimiento automático de cuota',
            description: 'Usa los restablecimientos de cuota acumulados cuando todas las cuentas de un pool se agotan.',
        },
        autoDisablePlanInvalid: {
            title: 'Omitir cuentas inservibles',
            description: 'Desactiva las cuentas del pool que no pueden usar el modelo elegido.',
        },
        poolQuotaLimitSelection: {
            title: 'Límites de cuota del pool',
            description: 'Elige qué cuota del proveedor sigue cada pool.',
        },
    },
    updates: {
        ota: {
            title: 'Actualizaciones remotas',
            description: 'Las apps instalan actualizaciones sin pasar por la tienda.',
        },
    },
    attachments: {
        uploads: {
            title: 'Adjuntos',
            description: 'Envía archivos e imágenes a los agentes de una sesión.',
        },
    },
    sharing: {
        group: 'Compartir',
        session: {
            title: 'Compartir sesiones',
            description: 'Comparte una sesión con alguien de este Home.',
        },
        public: {
            title: 'Enlaces públicos',
            description: 'Comparte el contenido de una sesión con un enlace público.',
        },
        contentKeys: {
            title: 'Compartición cifrada',
            description: 'Intercambia claves para que las sesiones compartidas sigan cifradas de extremo a extremo.',
        },
        pendingQueueV2: {
            title: 'Cola de mensajes compartida',
            description: 'Pone en cola los mensajes de una sesión compartida mientras su agente está ocupado.',
        },
        pendingDeliveryState: {
            title: 'Seguimiento de entrega de la cola',
            description: 'Recuerda qué mensajes en cola llegaron al agente.',
        },
    },
    sessions: {
        title: 'Sesiones',
        description: 'Las sesiones y sus controles.',
        group: 'Sesiones',
        handoff: {
            title: 'Traspaso de sesión',
            description: 'Mueve una sesión en curso a otra máquina.',
        },
        ephemeralRunner: {
            title: 'Runners efímeros',
            description: 'Inicia una sesión en una máquina desechable.',
        },
        agentSwitching: {
            title: 'Cambio de agente',
            description: 'Continúa una sesión con otro agente de código.',
        },
        folders: {
            title: 'Carpetas de sesiones',
            description: 'Organiza las sesiones en carpetas.',
        },
        drafts: {
            title: 'Borradores sincronizados',
            description: 'Conserva los mensajes sin enviar y los borradores de sesión en cada dispositivo.',
        },
        following: {
            title: 'Seguimiento',
            description: 'Sigue una sesión para recibir sus novedades y notificaciones.',
        },
        conversations: {
            title: 'Conversaciones',
            description: 'Las personas conversan y se mencionan dentro de una sesión compartida.',
        },
        board: {
            title: 'Tablero de sesiones',
            description: 'Organiza las sesiones y sus elementos en tableros compartidos.',
        },
        filteredListing: {
            title: 'Lista filtrada',
            description: 'Filtra la lista de sesiones en este Home antes de paginarla.',
        },
        usageLimitRecovery: {
            title: 'Recuperación tras límite de uso',
            description: 'Esperar y reanudar, o reintentar, cuando un agente alcanza un límite de uso.',
        },
    },
    machines: {
        title: 'Máquinas',
        description: 'La conexión con tus máquinas.',
        group: 'Máquinas',
        pools: {
            title: 'Pools de máquinas',
            description: 'Pasa a la siguiente máquina cuando una está desconectada.',
        },
        transfer: {
            title: 'Transferencias entre máquinas',
            description: 'Transferir datos entre máquinas.',
            directPeer: {
                title: 'Transferencias directas',
                description: 'Transfiere datos directamente entre máquinas.',
            },
            serverRouted: {
                title: 'Transferencias a través de este Home',
                description: 'Transfiere datos a través de este Home cuando las máquinas no pueden conectarse directamente.',
            },
        },
        peerMediation: {
            title: 'Conexiones entre máquinas',
            description: 'Túneles, transmisiones y acceso entre máquinas.',
            observability: {
                title: 'Diagnóstico de conexiones',
                description: 'Muestra cómo se conectan los túneles, las transmisiones y las vistas previas entre máquinas.',
            },
        },
        tunnel: {
            title: 'Túneles entre máquinas',
            description: 'Abrir puertos entre máquinas.',
            directPeer: {
                title: 'Túneles directos',
                description: 'Abre puertos directamente entre máquinas.',
            },
            serverRouted: {
                title: 'Túneles a través de este Home',
                description: 'Abre puertos a través de este Home cuando las máquinas no pueden conectarse directamente.',
            },
        },
        liveStream: {
            title: 'Transmisiones en directo',
            description: 'Transmitir la pantalla de una máquina.',
            directPeer: {
                title: 'Transmisiones directas',
                description: 'Transmite la pantalla de una máquina directamente a tu dispositivo.',
            },
            serverRouted: {
                title: 'Transmisiones a través de este Home',
                description: 'Transmite la pantalla de una máquina a través de este Home cuando falla la transmisión directa.',
            },
        },
        rpc: {
            title: 'Llamadas a máquinas',
            description: 'Llegar a las máquinas directamente.',
            directPeer: {
                title: 'Llamadas directas a máquinas',
                description: 'Llega a una máquina directamente en lugar de a través de este Home.',
            },
        },
    },
    localServices: {
        title: 'Servicios locales',
        description: 'Ve y abre los servicios que se ejecutan en tus máquinas.',
        group: 'Servicios locales',
        inventory: {
            title: 'Inventario de servicios',
            description: 'Lista los puertos y servicios activos en cada máquina.',
        },
        managed: {
            title: 'Servicios gestionados',
            description: 'Inicia, nombra y vigila servicios desde Happier.',
        },
        launcher: {
            title: 'Lanzador de servicios',
            description: 'Sugiere servicios para abrir y previsualizar.',
        },
        actions: {
            title: 'Acciones de servicios',
            description: 'Copiar, previsualizar y olvidar servicios.',
            terminate: {
                title: 'Detener servicios',
                description: 'Detiene el proceso de un servicio detectado.',
            },
        },
        preview: {
            title: 'Vistas previas de servicios',
            description: 'Previsualiza un servicio local en privado dentro de una sesión.',
        },
        publicPreview: {
            title: 'Vistas previas públicas',
            description: 'Comparte la vista previa de un servicio en una dirección pública.',
        },
    },
    browser: {
        title: 'Navegador',
        description: 'Abre páginas, vistas previas y vistas alojadas dentro de Happier.',
        group: 'Navegador',
        viewTargets: {
            title: 'Vistas del navegador',
            description: 'Abre vistas previas, páginas de plugins y enlaces en la vista adecuada.',
        },
        internal: {
            title: 'Navegador integrado',
            description: 'Navega dentro de Happier con sus propias sesiones y perfiles.',
        },
        sidecar: {
            title: 'Navegador auxiliar',
            description: 'Un navegador gestionado aparte para automatización intensiva.',
        },
        diagnostics: {
            title: 'Herramientas de desarrollo',
            description: 'Consola, red y eventos de devtools del navegador integrado.',
        },
        context: {
            title: 'Contexto del navegador',
            description: 'Adjunta el contenido de una página a un mensaje o a un agente.',
        },
        automation: {
            title: 'Automatización del navegador',
            description: 'Los agentes hacen clic, escriben y navegan en el navegador integrado.',
        },
        recording: {
            title: 'Grabaciones del navegador',
            description: 'Graba las sesiones del navegador como evidencia.',
        },
    },
    plugins: {
        title: 'Plugins de fuera de Happier',
        description: 'Instala plugins desde npm y tus propias fuentes.',
        group: 'Plugins',
        webhooks: {
            title: 'Webhooks de plugins',
            description: 'Los plugins reciben webhooks de servicios externos.',
        },
        ui: {
            title: 'Pantallas de plugins',
            description: 'Muestra las pantallas y paneles que ofrecen los plugins.',
            hostedWeb: {
                title: 'Pantallas web de plugins',
                description: 'Muestra pantallas de plugins creadas para la web.',
            },
            reactNativeBundles: {
                title: 'Pantallas nativas de plugins',
                description: 'Ejecuta pantallas de plugins de confianza creadas con React Native.',
            },
        },
    },
    devices: {
        title: 'Dispositivos',
        description: 'Simuladores y dispositivos conectados.',
        simulatorPreview: {
            title: 'Vistas previas de simuladores',
            description: 'Muestra simuladores y emuladores de tus máquinas.',
        },
    },
    social: {
        friends: {
            title: 'Amigos',
            description: 'Añade amigos y ve lo que comparten.',
        },
    },
    auth: {
        group: 'Inicio de sesión',
        recovery: {
            providerReset: {
                title: 'Restablecer con un proveedor',
                description: 'Recupera una cuenta iniciando sesión con su proveedor de identidad.',
            },
        },
        login: {
            keyChallenge: {
                title: 'Inicio de sesión con clave',
                description: 'Inicia sesión demostrando la clave de un dispositivo.',
            },
        },
        mtls: {
            title: 'Certificados de cliente',
            description: 'Inicia sesión con un certificado de cliente (mTLS).',
        },
        ui: {
            recoveryKeyReminder: {
                title: 'Recordatorio de clave de recuperación',
                description: 'Recuerda a las personas que guarden su clave de recuperación.',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'Iniciar sesión escaneando',
                description: 'Inicia sesión en un teléfono escaneando un código en un ordenador.',
            },
            boundQrV2: {
                title: 'Códigos de vinculación más seguros',
                description: 'Códigos de vinculación que solo sirven para este Home y esta dirección.',
            },
        },
    },
    encryption: {
        group: 'Cifrado',
        plaintextStorage: {
            title: 'Almacenamiento sin cifrar',
            description: 'Guarda las sesiones sin cifrado de extremo a extremo.',
        },
        accountOptOut: {
            title: 'Desactivar el cifrado',
            description: 'Cada persona puede desactivar el cifrado de extremo a extremo.',
        },
    },
    remoteHosts: {
        group: 'Hosts remotos',
        management: {
            title: 'Hosts remotos',
            description: 'Guarda hosts SSH donde ejecutar sesiones.',
        },
        secretMaterial: {
            title: 'Secretos de hosts guardados',
            description: 'Guarda contraseñas y claves de hosts SSH.',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: 'Cuentas sin claves',
            description: 'Cuentas sin claves de cifrado de extremo a extremo.',
        },
    },
    bugReports: {
        title: 'Informes de errores',
        description: 'Envía informes de errores con diagnósticos.',
    },
    terminal: {
        group: 'Terminal',
        embeddedPty: {
            title: 'Terminal',
            description: 'Abre un terminal en una máquina dentro de Happier.',
        },
        transport: {
            byteStream: {
                title: 'Terminal por flujo',
                description: 'Una conexión más rápida para el terminal integrado.',
            },
        },
    },
    search: {
        title: 'Búsqueda',
        description: 'Busca en sesiones y transcripciones.',
    },
    providers: {
        title: 'Proveedores de modelos',
        description: 'Conecta proveedores de modelos y elige modelos para los agentes.',
        group: 'Proveedores de modelos',
        localDiscovery: {
            title: 'Buscar proveedores locales',
            description: 'Encuentra servidores de modelos que se ejecutan en tus máquinas.',
        },
        localModelManagement: {
            title: 'Gestión de modelos locales',
            description: 'Descarga y gestiona modelos locales.',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'Dirección del servicio de informes',
            description: 'Adónde se envían los informes de errores. Si se deja vacío, no se ofrece ningún servicio de informes.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: 'Incluir diagnósticos por defecto',
            description: 'El formulario de informe incluye diagnósticos salvo que quien informa los desactive.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: 'Adjunto más grande',
            description: 'Archivo más grande que puede adjuntar un informe de errores, en bytes.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'Tiempo límite de subida',
            description: 'Cuánto puede tardar la subida de un informe de errores, en milisegundos.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: 'Tipos de adjunto aceptados',
            description: 'Tipos de adjunto que aceptan los informes de errores. Vacío acepta los tipos habituales.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'Ventana de contexto',
            description: 'Cuánto tiempo atrás recopila contexto un informe de errores, en milisegundos.',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: 'La voz requiere suscripción',
            description: 'Solo los suscriptores pueden usar la voz. Si no se define, producción lo exige y las demás configuraciones no.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'Manifiesto de mascota más grande',
            description: 'Manifiesto de mascota más grande que se acepta, en bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'Hoja de sprites de mascota más grande',
            description: 'Hoja de sprites de mascota más grande que se acepta, en bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'Paquete de mascota más grande',
            description: 'Paquete de mascota más grande que se acepta, en bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: 'Mascotas importadas por persona',
            description: 'Máximo de mascotas importadas que puede conservar una persona.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: 'Almacenamiento de mascotas importadas por persona',
            description: 'Máximo de bytes de mascotas importadas que puede conservar una persona.',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: 'Mascotas personalizadas cifradas',
            description: 'Reservado para más adelante. Las mascotas personalizadas cifradas aún no se sincronizan, así que esto sigue desactivado.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'Transferencia más grande a través de este Home',
            description: 'Archivo más grande que lleva una transferencia a través de este Home, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: 'Transferencias simultáneas por conexión',
            description: 'Máximo de transferencias a través de este Home que ejecuta una conexión a la vez.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'Datos por túnel',
            description: 'Máximo de bytes que lleva un túnel a través de este Home.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: 'Túneles por conexión',
            description: 'Máximo de túneles a través de este Home que mantiene abiertos una conexión.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Trama de túnel más grande',
            description: 'Trama más grande que lleva un túnel a través de este Home, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'Codificaciones de túnel',
            description: 'Codificaciones de trama que aceptan los túneles a través de este Home. Vacío usa las estándar.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: 'Codificación de túnel preferida',
            description: 'La codificación de trama que se usa primero. Debe ser una de las codificaciones aceptadas.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'Cabecera de trama más grande',
            description: 'Cabecera binaria de trama más grande, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'Carga útil de trama más grande',
            description: 'Carga útil sin procesar más grande en una trama, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'Mensaje entramado más grande',
            description: 'Mensaje entramado más grande, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'Flujos simultáneos por túnel',
            description: 'Máximo de flujos que ejecuta un túnel a la vez.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'Flujos por túnel',
            description: 'Máximo de flujos que abre un túnel durante su vida útil.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'Datos por flujo',
            description: 'Máximo de bytes que lleva un flujo.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'Datos por túnel, todos los flujos',
            description: 'Máximo de bytes que llevan juntos todos los flujos de un túnel.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'Tiempo límite de flujo inactivo',
            description: 'Cuánto puede estar inactivo un flujo antes de cerrarse, en milisegundos.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'Tiempo límite de túnel inactivo',
            description: 'Cuánto puede estar inactivo un túnel a través de este Home antes de cerrarse, en milisegundos.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'Límite de inactividad del túnel',
            description: 'Cuánto puede estar inactivo un túnel antes de cerrarse, en milisegundos.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'Túnel más largo',
            description: 'Tiempo máximo que un túnel permanece abierto, en milisegundos.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'Puertos accesibles para túneles',
            description: 'Puertos que pueden abrir los túneles. Vacío permite solo los predeterminados.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'Duración del enlace de vista previa',
            description: 'Cuánto tiempo funciona un enlace de vista previa privada, en milisegundos.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'Dominio de vistas previas',
            description: 'Dominio que sirve cada vista previa en su propia dirección. Vacío sirve las vistas previas bajo la dirección de este Home.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: 'Modos de vista previa pública',
            description: 'Formas en que una vista previa puede hacerse pública.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: 'Vista previa pública más larga',
            description: 'Tiempo máximo que una vista previa permanece pública, en milisegundos. Vacío mantiene el límite estándar.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: 'Vistas previas públicas simultáneas',
            description: 'Máximo de vistas previas públicas al mismo tiempo. Vacío mantiene el límite estándar.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'Exigir DNS y TLS',
            description: 'Las vistas previas públicas necesitan DNS y TLS.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: 'Registro de auditoría de vistas previas públicas',
            description: 'Dónde se registran las vistas previas públicas. Las vistas previas públicas necesitan uno.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: 'Archivo del registro de auditoría',
            description: 'Archivo en el que se escribe el registro de auditoría de vistas previas públicas.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'Permitir el registro de auditoría de prueba',
            description: 'Solo para desarrollo: acepta el registro de auditoría de prueba en memoria. Se ignora en producción.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: 'Límites de frecuencia de vistas previas públicas',
            description: 'Perfiles de límite de frecuencia que pueden usar las vistas previas públicas.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'Comprobador de límite de frecuencia',
            description: 'Cómo se limita la frecuencia de las solicitudes a vistas previas públicas. Las vistas previas públicas necesitan uno.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'Solicitudes por ventana',
            description: 'Solicitudes que permite una vista previa pública en cada ventana.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'Ventana de límite de frecuencia',
            description: 'Duración de cada ventana de límite de frecuencia, en milisegundos.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'Permitir el limitador de prueba',
            description: 'Solo para desarrollo: acepta el limitador de frecuencia de prueba en memoria. Se ignora en producción.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: 'Webhooks en curso',
            description: 'Máximo de solicitudes webhook que este servidor atiende a la vez.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Memoria de webhooks',
            description: 'Memoria máxima que pueden usar las solicitudes webhook en curso, en bytes. Vacío permite lo que ya admite el límite de solicitudes.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'Webhooks por minuto por ruta',
            description: 'Solicitudes webhook por minuto en una ruta.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'Webhooks simultáneos por ruta',
            description: 'Solicitudes webhook en curso en una ruta.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'Webhooks por minuto por endpoint',
            description: 'Solicitudes webhook por minuto en un endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'Webhooks simultáneos por endpoint',
            description: 'Solicitudes webhook en curso en un endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: 'Webhooks por minuto por persona',
            description: 'Solicitudes webhook por minuto de una persona.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: 'Webhooks simultáneos por persona',
            description: 'Solicitudes webhook en curso de una persona.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'Paquete de pantalla de plugin más grande',
            description: 'Paquete de pantalla de plugin más grande que aloja este Home, en bytes.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: 'Almacenamiento de pantallas de plugins por persona',
            description: 'Máximo de bytes de paquetes de pantallas de plugins que puede almacenar una persona.',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'Fila de datos de plugin más grande',
            description: 'Fila más grande que almacena un plugin, en bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'Lote de datos de plugin más grande',
            description: 'Lote más grande de cambios de datos de plugin, en bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'Filas por lote de datos de plugin',
            description: 'Máximo de filas en un lote de cambios de datos de plugin.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: 'Filas de datos de plugin por persona',
            description: 'Máximo de filas de datos de plugin que puede almacenar una persona.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: 'Almacenamiento de datos de plugin por persona',
            description: 'Máximo de bytes de datos de plugin que puede almacenar una persona.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: 'Tasa de bits máxima de transmisión',
            description: 'Tasa de bits máxima de una transmisión en directo a través de este Home, en bits por segundo.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: 'Frecuencia de fotogramas máxima',
            description: 'Frecuencia de fotogramas máxima de una transmisión en directo a través de este Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Fotograma de transmisión más grande',
            description: 'Fotograma más grande de una transmisión en directo a través de este Home, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'Transmisión en directo más larga',
            description: 'Tiempo máximo que dura una transmisión en directo a través de este Home, en milisegundos.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'Datos por transmisión en directo',
            description: 'Máximo de bytes que lleva una transmisión en directo a través de este Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: 'Transmisiones simultáneas por persona',
            description: 'Máximo de transmisiones en directo a través de este Home que ejecuta una persona a la vez.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: 'Transmisiones simultáneas por conexión',
            description: 'Máximo de transmisiones en directo a través de este Home que ejecuta una conexión a la vez.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'Transmisiones simultáneas por máquina',
            description: 'Máximo de transmisiones en directo a través de este Home que ejecuta una máquina a la vez.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: 'ID de la clave de firma de conexiones',
            description: 'Identifica la clave que firma las conexiones entre máquinas. Sin clave de firma, estas conexiones están desactivadas.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: 'Clave privada de firma de conexiones',
            description: 'Clave privada que firma las conexiones entre máquinas.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: 'Clave pública de firma de conexiones',
            description: 'Clave pública que corresponde a la clave de firma. Si está vacía, se deriva de la clave privada.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: 'Caducidad de la clave de firma',
            description: 'Cuándo caduca la clave de firma, como marca de tiempo en milisegundos.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'Buscar amigos por nombre de usuario',
            description: 'Las personas pueden encontrar amigos por nombre de usuario además de por cuenta vinculada.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: 'Proveedor para emparejar amigos',
            description: 'El proveedor de inicio de sesión que se usa para emparejar amigos.',
        },
    },
};

const fr: typeof en = {
    teams: {
        title: 'Équipes',
        description: 'Des groupes qui partagent sessions, machines et accès.',
        credentialResources: {
            title: 'Identifiants d’équipe',
            description: 'Les identifiants qu’une équipe partage avec ses sessions.',
            externalApi: {
                title: 'API des identifiants d’équipe',
                description: 'Des outils externes utilisent les identifiants d’une équipe via l’API.',
            },
        },
    },
    automations: {
        title: 'Automatisations',
        description: 'Du travail d’agent planifié et déclenché.',
    },
    workflows: {
        title: 'Workflows',
        description: 'Des pipelines d’agents en plusieurs étapes.',
    },
    pets: {
        sync: {
            title: 'Synchronisation des compagnons',
            description: 'Garde les compagnons de chacun sur tous ses appareils.',
        },
    },
    voice: {
        title: 'Voix',
        description: 'Parlez à vos agents.',
        happierVoice: {
            title: 'Voix Happier',
            description: 'La voix via le service vocal fourni par ce Home.',
        },
    },
    connectedServices: {
        group: 'Services connectés',
        quotas: {
            title: 'Jauges de quota',
            description: 'Indique le quota restant de chaque compte connecté.',
        },
        subscription: {
            title: 'État de l’abonnement',
            description: 'Indique la formule et l’état de chaque compte connecté.',
        },
        accountGroups: {
            title: 'Groupes de comptes',
            description: 'Regroupez les comptes connectés en pools.',
        },
        accountFallback: {
            title: 'Compte de secours',
            description: 'Passe au compte suivant du pool quand l’un est épuisé.',
        },
        autoQuotaReset: {
            title: 'Réinitialisation automatique du quota',
            description: 'Utilise les réinitialisations de quota en réserve une fois tous les comptes d’un pool épuisés.',
        },
        autoDisablePlanInvalid: {
            title: 'Ignorer les comptes inutilisables',
            description: 'Désactive les comptes du pool qui ne peuvent pas utiliser le modèle choisi.',
        },
        poolQuotaLimitSelection: {
            title: 'Limites de quota du pool',
            description: 'Choisissez le quota fournisseur que suit chaque pool.',
        },
    },
    updates: {
        ota: {
            title: 'Mises à jour à distance',
            description: 'Les apps installent les mises à jour sans passer par un store.',
        },
    },
    attachments: {
        uploads: {
            title: 'Pièces jointes',
            description: 'Envoyez des fichiers et des images aux agents d’une session.',
        },
    },
    sharing: {
        group: 'Partage',
        session: {
            title: 'Partage de session',
            description: 'Partagez une session avec quelqu’un sur ce Home.',
        },
        public: {
            title: 'Liens publics',
            description: 'Partagez le contenu d’une session avec un lien public.',
        },
        contentKeys: {
            title: 'Partage chiffré',
            description: 'Échange des clés pour que les sessions partagées restent chiffrées de bout en bout.',
        },
        pendingQueueV2: {
            title: 'File de messages partagée',
            description: 'Met en file les messages d’une session partagée pendant que son agent est occupé.',
        },
        pendingDeliveryState: {
            title: 'Suivi de livraison de la file',
            description: 'Retient quels messages en file ont atteint l’agent.',
        },
    },
    sessions: {
        title: 'Sessions',
        description: 'Les sessions et leurs commandes.',
        group: 'Sessions',
        handoff: {
            title: 'Transfert de session',
            description: 'Déplacez une session en cours vers une autre machine.',
        },
        ephemeralRunner: {
            title: 'Runners éphémères',
            description: 'Lancez une session sur une machine jetable.',
        },
        agentSwitching: {
            title: 'Changement d’agent',
            description: 'Poursuivez une session avec un autre agent de code.',
        },
        folders: {
            title: 'Dossiers de sessions',
            description: 'Rangez les sessions dans des dossiers.',
        },
        drafts: {
            title: 'Brouillons synchronisés',
            description: 'Gardez les messages non envoyés et les brouillons de session sur chaque appareil.',
        },
        following: {
            title: 'Suivi',
            description: 'Suivez une session pour recevoir ses mises à jour et notifications.',
        },
        conversations: {
            title: 'Conversations',
            description: 'Les personnes échangent et se mentionnent dans une session partagée.',
        },
        board: {
            title: 'Tableau de sessions',
            description: 'Organisez les sessions et leurs éléments sur des tableaux partagés.',
        },
        filteredListing: {
            title: 'Liste filtrée',
            description: 'Filtre la liste des sessions sur ce Home avant la pagination.',
        },
        usageLimitRecovery: {
            title: 'Reprise après limite d’usage',
            description: 'Attendre et reprendre, ou réessayer, quand un agent atteint une limite d’usage.',
        },
    },
    machines: {
        title: 'Machines',
        description: 'La connexion à vos machines.',
        group: 'Machines',
        pools: {
            title: 'Pools de machines',
            description: 'Bascule sur la machine suivante quand l’une est hors ligne.',
        },
        transfer: {
            title: 'Transferts entre machines',
            description: 'Transférer des données entre machines.',
            directPeer: {
                title: 'Transferts directs',
                description: 'Transfère les données directement entre machines.',
            },
            serverRouted: {
                title: 'Transferts via ce Home',
                description: 'Transfère les données via ce Home quand les machines ne peuvent pas se connecter directement.',
            },
        },
        peerMediation: {
            title: 'Connexions entre machines',
            description: 'Tunnels, flux et accès entre machines.',
            observability: {
                title: 'Diagnostic des connexions',
                description: 'Montre comment tunnels, flux et aperçus sont connectés entre machines.',
            },
        },
        tunnel: {
            title: 'Tunnels entre machines',
            description: 'Ouvrir des ports entre machines.',
            directPeer: {
                title: 'Tunnels directs',
                description: 'Ouvre des ports directement entre machines.',
            },
            serverRouted: {
                title: 'Tunnels via ce Home',
                description: 'Ouvre des ports via ce Home quand les machines ne peuvent pas se connecter directement.',
            },
        },
        liveStream: {
            title: 'Diffusions en direct',
            description: 'Diffuser l’écran d’une machine.',
            directPeer: {
                title: 'Diffusions directes',
                description: 'Diffuse l’écran d’une machine directement sur votre appareil.',
            },
            serverRouted: {
                title: 'Diffusions via ce Home',
                description: 'Diffuse l’écran d’une machine via ce Home quand la diffusion directe échoue.',
            },
        },
        rpc: {
            title: 'Appels aux machines',
            description: 'Joindre les machines directement.',
            directPeer: {
                title: 'Appels directs aux machines',
                description: 'Joint une machine directement plutôt que via ce Home.',
            },
        },
    },
    localServices: {
        title: 'Services locaux',
        description: 'Voyez et ouvrez les services qui tournent sur vos machines.',
        group: 'Services locaux',
        inventory: {
            title: 'Inventaire des services',
            description: 'Liste les ports et services actifs sur chaque machine.',
        },
        managed: {
            title: 'Services gérés',
            description: 'Démarrez, nommez et surveillez des services depuis Happier.',
        },
        launcher: {
            title: 'Lanceur de services',
            description: 'Suggère des services à ouvrir et à prévisualiser.',
        },
        actions: {
            title: 'Actions sur les services',
            description: 'Copier, prévisualiser et oublier des services.',
            terminate: {
                title: 'Arrêter des services',
                description: 'Arrête le processus d’un service détecté.',
            },
        },
        preview: {
            title: 'Aperçus de services',
            description: 'Prévisualise un service local en privé dans une session.',
        },
        publicPreview: {
            title: 'Aperçus publics',
            description: 'Partagez l’aperçu d’un service à une adresse publique.',
        },
    },
    browser: {
        title: 'Navigateur',
        description: 'Ouvrez pages, aperçus et vues hébergées dans Happier.',
        group: 'Navigateur',
        viewTargets: {
            title: 'Vues du navigateur',
            description: 'Ouvre aperçus, pages de plugins et liens dans la bonne vue.',
        },
        internal: {
            title: 'Navigateur intégré',
            description: 'Naviguez dans Happier avec ses propres sessions et profils.',
        },
        sidecar: {
            title: 'Navigateur annexe',
            description: 'Un navigateur géré à part pour l’automatisation intensive.',
        },
        diagnostics: {
            title: 'Outils de développement',
            description: 'Console, réseau et événements devtools du navigateur intégré.',
        },
        context: {
            title: 'Contexte du navigateur',
            description: 'Joignez le contenu d’une page à un message ou à un agent.',
        },
        automation: {
            title: 'Automatisation du navigateur',
            description: 'Les agents cliquent, tapent et naviguent dans le navigateur intégré.',
        },
        recording: {
            title: 'Enregistrements du navigateur',
            description: 'Enregistre les sessions du navigateur comme preuves.',
        },
    },
    plugins: {
        title: 'Plugins hors Happier',
        description: 'Installez des plugins depuis npm et vos propres sources.',
        group: 'Plugins',
        webhooks: {
            title: 'Webhooks des plugins',
            description: 'Les plugins reçoivent des webhooks de services externes.',
        },
        ui: {
            title: 'Écrans des plugins',
            description: 'Affiche les écrans et panneaux fournis par les plugins.',
            hostedWeb: {
                title: 'Écrans web des plugins',
                description: 'Affiche les écrans de plugins conçus pour le web.',
            },
            reactNativeBundles: {
                title: 'Écrans natifs des plugins',
                description: 'Exécute des écrans de plugins de confiance conçus avec React Native.',
            },
        },
    },
    devices: {
        title: 'Appareils',
        description: 'Simulateurs et appareils connectés.',
        simulatorPreview: {
            title: 'Aperçus de simulateurs',
            description: 'Affiche les simulateurs et émulateurs de vos machines.',
        },
    },
    social: {
        friends: {
            title: 'Amis',
            description: 'Ajoutez des amis et voyez ce qu’ils partagent.',
        },
    },
    auth: {
        group: 'Connexion',
        recovery: {
            providerReset: {
                title: 'Réinitialisation via un fournisseur',
                description: 'Récupérez un compte en vous connectant avec son fournisseur d’identité.',
            },
        },
        login: {
            keyChallenge: {
                title: 'Connexion par clé',
                description: 'Connectez-vous en prouvant la clé d’un appareil.',
            },
        },
        mtls: {
            title: 'Certificats client',
            description: 'Connectez-vous avec un certificat client (mTLS).',
        },
        ui: {
            recoveryKeyReminder: {
                title: 'Rappel de la clé de récupération',
                description: 'Rappelle aux personnes d’enregistrer leur clé de récupération.',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'Connexion par scan',
                description: 'Connectez-vous sur un téléphone en scannant un code affiché sur un ordinateur.',
            },
            boundQrV2: {
                title: 'Codes d’appairage plus sûrs',
                description: 'Des codes d’appairage valables uniquement pour ce Home et ce sens.',
            },
        },
    },
    encryption: {
        group: 'Chiffrement',
        plaintextStorage: {
            title: 'Stockage non chiffré',
            description: 'Stocke les sessions sans chiffrement de bout en bout.',
        },
        accountOptOut: {
            title: 'Désactivation du chiffrement',
            description: 'Chacun peut désactiver le chiffrement de bout en bout.',
        },
    },
    remoteHosts: {
        group: 'Hôtes distants',
        management: {
            title: 'Hôtes distants',
            description: 'Enregistrez des hôtes SSH où exécuter des sessions.',
        },
        secretMaterial: {
            title: 'Secrets d’hôtes enregistrés',
            description: 'Enregistrez mots de passe et clés des hôtes SSH.',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: 'Comptes sans clé',
            description: 'Des comptes sans clés de chiffrement de bout en bout.',
        },
    },
    bugReports: {
        title: 'Rapports de bug',
        description: 'Envoyez des rapports de bug avec des diagnostics.',
    },
    terminal: {
        group: 'Terminal',
        embeddedPty: {
            title: 'Terminal',
            description: 'Ouvrez un terminal sur une machine dans Happier.',
        },
        transport: {
            byteStream: {
                title: 'Terminal en flux',
                description: 'Une connexion plus rapide pour le terminal intégré.',
            },
        },
    },
    search: {
        title: 'Recherche',
        description: 'Recherchez dans les sessions et les transcriptions.',
    },
    providers: {
        title: 'Fournisseurs de modèles',
        description: 'Connectez des fournisseurs de modèles et choisissez les modèles des agents.',
        group: 'Fournisseurs de modèles',
        localDiscovery: {
            title: 'Trouver les fournisseurs locaux',
            description: 'Trouve les serveurs de modèles qui tournent sur vos machines.',
        },
        localModelManagement: {
            title: 'Gestion des modèles locaux',
            description: 'Téléchargez et gérez des modèles locaux.',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'Adresse du service de rapports',
            description: 'Où les rapports de bug sont envoyés. Si vide, aucun service de rapports n’est proposé.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: 'Inclure les diagnostics par défaut',
            description: 'Le formulaire de rapport inclut les diagnostics, sauf si la personne qui signale les retire.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: 'Taille maximale d’une pièce jointe',
            description: 'Plus gros fichier qu’un rapport de bug peut joindre, en octets.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'Délai d’envoi',
            description: 'Durée maximale de l’envoi d’un rapport de bug, en millisecondes.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: 'Types de pièces jointes acceptés',
            description: 'Types de pièces jointes acceptés par les rapports de bug. Vide accepte les types habituels.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'Fenêtre de contexte',
            description: 'Jusqu’où dans le passé un rapport de bug collecte le contexte, en millisecondes.',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: 'Voix réservée aux abonnés',
            description: 'Seuls les abonnés peuvent utiliser la voix. Si non défini, la production l’exige et les autres configurations non.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'Manifeste de compagnon maximal',
            description: 'Plus gros manifeste de compagnon accepté, en octets.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'Planche de sprites maximale',
            description: 'Plus grosse planche de sprites de compagnon acceptée, en octets.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'Paquet de compagnon maximal',
            description: 'Plus gros paquet de compagnon accepté, en octets.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: 'Compagnons importés par personne',
            description: 'Nombre maximal de compagnons importés qu’une personne peut garder.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: 'Stockage de compagnons importés par personne',
            description: 'Nombre maximal d’octets de compagnons importés qu’une personne peut garder.',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: 'Compagnons personnalisés chiffrés',
            description: 'Réservé pour plus tard. Les compagnons personnalisés chiffrés ne sont pas encore synchronisés, ce réglage reste donc désactivé.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'Transfert maximal via ce Home',
            description: 'Plus gros fichier qu’un transfert via ce Home transporte, en octets.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: 'Transferts simultanés par connexion',
            description: 'Nombre maximal de transferts via ce Home qu’une connexion mène en même temps.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'Données par tunnel',
            description: 'Nombre maximal d’octets qu’un tunnel via ce Home transporte.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: 'Tunnels par connexion',
            description: 'Nombre maximal de tunnels via ce Home qu’une connexion garde ouverts.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Trame de tunnel maximale',
            description: 'Plus grande trame qu’un tunnel via ce Home transporte, en octets.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'Encodages de tunnel',
            description: 'Encodages de trame acceptés par les tunnels via ce Home. Vide utilise les encodages standard.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: 'Encodage de tunnel préféré',
            description: 'L’encodage de trame à utiliser en premier. Il doit faire partie des encodages acceptés.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'En-tête de trame maximal',
            description: 'Plus grand en-tête binaire de trame, en octets.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'Charge utile de trame maximale',
            description: 'Plus grande charge utile brute dans une trame, en octets.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'Message tramé maximal',
            description: 'Plus grand message tramé, en octets.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'Flux simultanés par tunnel',
            description: 'Nombre maximal de flux qu’un tunnel mène en même temps.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'Flux par tunnel',
            description: 'Nombre maximal de flux qu’un tunnel ouvre au cours de sa vie.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'Données par flux',
            description: 'Nombre maximal d’octets qu’un flux transporte.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'Données par tunnel, tous flux confondus',
            description: 'Nombre maximal d’octets que tous les flux d’un tunnel transportent ensemble.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'Délai d’inactivité d’un flux',
            description: 'Durée pendant laquelle un flux peut rester inactif avant sa fermeture, en millisecondes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'Délai d’inactivité d’un tunnel',
            description: 'Durée pendant laquelle un tunnel via ce Home peut rester inactif avant sa fermeture, en millisecondes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'Limite d’inactivité des tunnels',
            description: 'Durée pendant laquelle un tunnel peut rester inactif avant sa fermeture, en millisecondes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'Tunnel le plus long',
            description: 'Durée maximale pendant laquelle un tunnel reste ouvert, en millisecondes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'Ports accessibles aux tunnels',
            description: 'Ports que les tunnels peuvent ouvrir. Vide n’autorise que ceux par défaut.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'Durée de vie des liens d’aperçu',
            description: 'Durée de validité d’un lien d’aperçu privé, en millisecondes.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'Domaine des aperçus',
            description: 'Domaine qui sert chaque aperçu à sa propre adresse. Vide sert les aperçus sous l’adresse de ce Home.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: 'Modes d’aperçu public',
            description: 'Façons dont un aperçu peut être rendu public.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: 'Aperçu public le plus long',
            description: 'Durée maximale pendant laquelle un aperçu reste public, en millisecondes. Vide conserve la limite standard.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: 'Aperçus publics simultanés',
            description: 'Nombre maximal d’aperçus publics en même temps. Vide conserve la limite standard.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'Exiger DNS et TLS',
            description: 'Les aperçus publics nécessitent DNS et TLS.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: 'Journal d’audit des aperçus publics',
            description: 'Où les aperçus publics sont enregistrés. Les aperçus publics en ont besoin.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: 'Fichier du journal d’audit',
            description: 'Fichier dans lequel le journal d’audit des aperçus publics est écrit.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'Autoriser le journal d’audit de test',
            description: 'Pour le développement uniquement : accepte le journal d’audit de test en mémoire. Ignoré en production.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: 'Limites de débit des aperçus publics',
            description: 'Profils de limitation de débit que les aperçus publics peuvent utiliser.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'Contrôleur de limitation de débit',
            description: 'Comment les requêtes des aperçus publics sont limitées. Les aperçus publics en ont besoin.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'Requêtes par fenêtre',
            description: 'Requêtes qu’un aperçu public autorise dans chaque fenêtre.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'Fenêtre de limitation de débit',
            description: 'Durée de chaque fenêtre de limitation de débit, en millisecondes.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'Autoriser le limiteur de test',
            description: 'Pour le développement uniquement : accepte le limiteur de débit de test en mémoire. Ignoré en production.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: 'Webhooks en cours',
            description: 'Nombre maximal de requêtes webhook que ce serveur traite en même temps.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Mémoire des webhooks',
            description: 'Mémoire maximale que les requêtes webhook en cours peuvent utiliser, en octets. Vide autorise ce que la limite de requêtes permet déjà.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'Webhooks par minute et par route',
            description: 'Requêtes webhook par minute sur une route.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'Webhooks simultanés par route',
            description: 'Requêtes webhook en cours sur une route.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'Webhooks par minute et par endpoint',
            description: 'Requêtes webhook par minute sur un endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'Webhooks simultanés par endpoint',
            description: 'Requêtes webhook en cours sur un endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: 'Webhooks par minute et par personne',
            description: 'Requêtes webhook par minute pour une personne.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: 'Webhooks simultanés par personne',
            description: 'Requêtes webhook en cours pour une personne.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'Bundle d’écran de plugin maximal',
            description: 'Plus gros bundle d’écran de plugin que ce Home héberge, en octets.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: 'Stockage des écrans de plugins par personne',
            description: 'Nombre maximal d’octets de bundles d’écrans de plugins qu’une personne peut stocker.',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'Ligne de données de plugin maximale',
            description: 'Plus grande ligne qu’un plugin stocke, en octets.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'Lot de données de plugin maximal',
            description: 'Plus gros lot de modifications de données de plugin, en octets.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'Lignes par lot de données de plugin',
            description: 'Nombre maximal de lignes dans un lot de modifications de données de plugin.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: 'Lignes de données de plugin par personne',
            description: 'Nombre maximal de lignes de données de plugin qu’une personne peut stocker.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: 'Stockage de données de plugin par personne',
            description: 'Nombre maximal d’octets de données de plugin qu’une personne peut stocker.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: 'Débit binaire maximal de diffusion',
            description: 'Débit binaire maximal d’une diffusion en direct via ce Home, en bits par seconde.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: 'Fréquence d’images maximale de diffusion',
            description: 'Fréquence d’images maximale d’une diffusion en direct via ce Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Image de diffusion maximale',
            description: 'Plus grande image d’une diffusion en direct via ce Home, en octets.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'Diffusion en direct la plus longue',
            description: 'Durée maximale d’une diffusion en direct via ce Home, en millisecondes.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'Données par diffusion en direct',
            description: 'Nombre maximal d’octets qu’une diffusion en direct via ce Home transporte.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: 'Diffusions simultanées par personne',
            description: 'Nombre maximal de diffusions en direct via ce Home qu’une personne mène en même temps.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: 'Diffusions simultanées par connexion',
            description: 'Nombre maximal de diffusions en direct via ce Home qu’une connexion mène en même temps.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'Diffusions simultanées par machine',
            description: 'Nombre maximal de diffusions en direct via ce Home qu’une machine mène en même temps.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: 'ID de la clé de signature des connexions',
            description: 'Nomme la clé qui signe les connexions entre machines. Sans clé de signature, ces connexions sont désactivées.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: 'Clé privée de signature des connexions',
            description: 'Clé privée qui signe les connexions entre machines.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: 'Clé publique de signature des connexions',
            description: 'Clé publique correspondant à la clé de signature. Si vide, elle est dérivée de la clé privée.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: 'Expiration de la clé de signature',
            description: 'Date d’expiration de la clé de signature, sous forme d’horodatage en millisecondes.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'Trouver des amis par nom d’utilisateur',
            description: 'Les personnes peuvent trouver des amis par nom d’utilisateur ainsi que par compte lié.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: 'Fournisseur de correspondance des amis',
            description: 'Le fournisseur de connexion utilisé pour faire correspondre les amis.',
        },
    },
};

const it: typeof en = {
    teams: {
        title: 'Team',
        description: 'Gruppi con sessioni, macchine e accessi condivisi.',
        credentialResources: {
            title: 'Credenziali del team',
            description: 'Credenziali che un team condivide con le sue sessioni.',
            externalApi: {
                title: 'API delle credenziali del team',
                description: 'Strumenti esterni usano le credenziali di un team tramite l’API.',
            },
        },
    },
    automations: {
        title: 'Automazioni',
        description: 'Lavoro degli agenti pianificato e attivato da eventi.',
    },
    workflows: {
        title: 'Flussi di lavoro',
        description: 'Pipeline di agenti in più passaggi.',
    },
    pets: {
        sync: {
            title: 'Sincronizzazione dei pet',
            description: 'Mantiene i pet di ogni persona su tutti i suoi dispositivi.',
        },
    },
    voice: {
        title: 'Voce',
        description: 'Parla con i tuoi agenti.',
        happierVoice: {
            title: 'Voce Happier',
            description: 'La voce tramite il servizio vocale fornito da questo Home.',
        },
    },
    connectedServices: {
        group: 'Servizi collegati',
        quotas: {
            title: 'Indicatori di quota',
            description: 'Mostra quanta quota resta a ogni account collegato.',
        },
        subscription: {
            title: 'Stato dell’abbonamento',
            description: 'Mostra piano e stato di ogni account collegato.',
        },
        accountGroups: {
            title: 'Gruppi di account',
            description: 'Raggruppa gli account collegati in pool.',
        },
        accountFallback: {
            title: 'Account di riserva',
            description: 'Passa all’account successivo del pool quando uno si esaurisce.',
        },
        autoQuotaReset: {
            title: 'Ripristino automatico della quota',
            description: 'Usa i ripristini di quota accumulati quando tutti gli account di un pool sono esauriti.',
        },
        autoDisablePlanInvalid: {
            title: 'Salta gli account inutilizzabili',
            description: 'Disattiva gli account del pool che non possono usare il modello scelto.',
        },
        poolQuotaLimitSelection: {
            title: 'Limiti di quota del pool',
            description: 'Scegli quale quota del provider segue ogni pool.',
        },
    },
    updates: {
        ota: {
            title: 'Aggiornamenti over-the-air',
            description: 'Le app installano aggiornamenti senza passare dallo store.',
        },
    },
    attachments: {
        uploads: {
            title: 'Allegati',
            description: 'Invia file e immagini agli agenti di una sessione.',
        },
    },
    sharing: {
        group: 'Condivisione',
        session: {
            title: 'Condivisione delle sessioni',
            description: 'Condividi una sessione con qualcuno su questo Home.',
        },
        public: {
            title: 'Link pubblici',
            description: 'Condividi il contenuto di una sessione con un link pubblico.',
        },
        contentKeys: {
            title: 'Condivisione cifrata',
            description: 'Scambia chiavi perché le sessioni condivise restino cifrate end-to-end.',
        },
        pendingQueueV2: {
            title: 'Coda di messaggi condivisa',
            description: 'Mette in coda i messaggi di una sessione condivisa mentre il suo agente è occupato.',
        },
        pendingDeliveryState: {
            title: 'Tracciamento della consegna in coda',
            description: 'Ricorda quali messaggi in coda hanno raggiunto l’agente.',
        },
    },
    sessions: {
        title: 'Sessioni',
        description: 'Le sessioni e i loro controlli.',
        group: 'Sessioni',
        handoff: {
            title: 'Passaggio di sessione',
            description: 'Sposta una sessione in corso su un’altra macchina.',
        },
        ephemeralRunner: {
            title: 'Runner temporanei',
            description: 'Avvia una sessione su una macchina usa e getta.',
        },
        agentSwitching: {
            title: 'Cambio di agente',
            description: 'Continua una sessione con un altro agente di coding.',
        },
        folders: {
            title: 'Cartelle delle sessioni',
            description: 'Organizza le sessioni in cartelle.',
        },
        drafts: {
            title: 'Bozze sincronizzate',
            description: 'Conserva i messaggi non inviati e le bozze di sessione su ogni dispositivo.',
        },
        following: {
            title: 'Seguire',
            description: 'Segui una sessione per riceverne aggiornamenti e notifiche.',
        },
        conversations: {
            title: 'Conversazioni',
            description: 'Le persone parlano e si menzionano all’interno di una sessione condivisa.',
        },
        board: {
            title: 'Bacheca delle sessioni',
            description: 'Disponi le sessioni e i loro elementi su bacheche condivise.',
        },
        filteredListing: {
            title: 'Elenco filtrato',
            description: 'Filtra l’elenco delle sessioni su questo Home prima della paginazione.',
        },
        usageLimitRecovery: {
            title: 'Ripresa dopo limite d’uso',
            description: 'Attendi e riprendi, o riprova, quando un agente raggiunge un limite d’uso.',
        },
    },
    machines: {
        title: 'Macchine',
        description: 'La connessione alle tue macchine.',
        group: 'Macchine',
        pools: {
            title: 'Pool di macchine',
            description: 'Passa alla macchina successiva quando una è offline.',
        },
        transfer: {
            title: 'Trasferimenti tra macchine',
            description: 'Trasferire dati tra macchine.',
            directPeer: {
                title: 'Trasferimenti diretti',
                description: 'Trasferisce dati direttamente tra macchine.',
            },
            serverRouted: {
                title: 'Trasferimenti tramite questo Home',
                description: 'Trasferisce dati tramite questo Home quando le macchine non riescono a collegarsi direttamente.',
            },
        },
        peerMediation: {
            title: 'Connessioni tra macchine',
            description: 'Tunnel, stream e accessi tra macchine.',
            observability: {
                title: 'Diagnostica delle connessioni',
                description: 'Mostra come sono collegati tunnel, stream e anteprime tra macchine.',
            },
        },
        tunnel: {
            title: 'Tunnel tra macchine',
            description: 'Aprire porte tra macchine.',
            directPeer: {
                title: 'Tunnel diretti',
                description: 'Apre porte direttamente tra macchine.',
            },
            serverRouted: {
                title: 'Tunnel tramite questo Home',
                description: 'Apre porte tramite questo Home quando le macchine non riescono a collegarsi direttamente.',
            },
        },
        liveStream: {
            title: 'Stream in diretta',
            description: 'Trasmettere lo schermo di una macchina.',
            directPeer: {
                title: 'Stream diretti',
                description: 'Trasmette lo schermo di una macchina direttamente al tuo dispositivo.',
            },
            serverRouted: {
                title: 'Stream tramite questo Home',
                description: 'Trasmette lo schermo di una macchina tramite questo Home quando lo stream diretto non riesce.',
            },
        },
        rpc: {
            title: 'Chiamate alle macchine',
            description: 'Raggiungere le macchine direttamente.',
            directPeer: {
                title: 'Chiamate dirette alle macchine',
                description: 'Raggiunge una macchina direttamente anziché tramite questo Home.',
            },
        },
    },
    localServices: {
        title: 'Servizi locali',
        description: 'Vedi e apri i servizi in esecuzione sulle tue macchine.',
        group: 'Servizi locali',
        inventory: {
            title: 'Inventario dei servizi',
            description: 'Elenca porte e servizi attivi su ogni macchina.',
        },
        managed: {
            title: 'Servizi gestiti',
            description: 'Avvia, nomina e monitora servizi da Happier.',
        },
        launcher: {
            title: 'Avvio dei servizi',
            description: 'Suggerisce servizi da aprire e visualizzare in anteprima.',
        },
        actions: {
            title: 'Azioni sui servizi',
            description: 'Copia, visualizza in anteprima e dimentica servizi.',
            terminate: {
                title: 'Arresta servizi',
                description: 'Arresta il processo di un servizio rilevato.',
            },
        },
        preview: {
            title: 'Anteprime dei servizi',
            description: 'Mostra in privato l’anteprima di un servizio locale in una sessione.',
        },
        publicPreview: {
            title: 'Anteprime pubbliche',
            description: 'Condividi l’anteprima di un servizio a un indirizzo pubblico.',
        },
    },
    browser: {
        title: 'Browser',
        description: 'Apri pagine, anteprime e viste ospitate in Happier.',
        group: 'Browser',
        viewTargets: {
            title: 'Viste del browser',
            description: 'Apre anteprime, pagine dei plugin e link nella vista giusta.',
        },
        internal: {
            title: 'Browser integrato',
            description: 'Naviga in Happier con sessioni e profili propri.',
        },
        sidecar: {
            title: 'Browser affiancato',
            description: 'Un browser gestito a parte per l’automazione intensiva.',
        },
        diagnostics: {
            title: 'Strumenti per sviluppatori',
            description: 'Console, rete ed eventi devtools del browser integrato.',
        },
        context: {
            title: 'Contesto del browser',
            description: 'Allega il contenuto di una pagina a un messaggio o a un agente.',
        },
        automation: {
            title: 'Automazione del browser',
            description: 'Gli agenti cliccano, scrivono e navigano nel browser integrato.',
        },
        recording: {
            title: 'Registrazioni del browser',
            description: 'Registra le sessioni del browser come prova.',
        },
    },
    plugins: {
        title: 'Plugin esterni a Happier',
        description: 'Installa plugin da npm e dalle tue fonti.',
        group: 'Plugin',
        webhooks: {
            title: 'Webhook dei plugin',
            description: 'I plugin ricevono webhook da servizi esterni.',
        },
        ui: {
            title: 'Schermate dei plugin',
            description: 'Mostra le schermate e i pannelli forniti dai plugin.',
            hostedWeb: {
                title: 'Schermate web dei plugin',
                description: 'Mostra schermate dei plugin create per il web.',
            },
            reactNativeBundles: {
                title: 'Schermate native dei plugin',
                description: 'Esegue schermate di plugin attendibili create con React Native.',
            },
        },
    },
    devices: {
        title: 'Dispositivi',
        description: 'Simulatori e dispositivi collegati.',
        simulatorPreview: {
            title: 'Anteprime dei simulatori',
            description: 'Mostra simulatori ed emulatori delle tue macchine.',
        },
    },
    social: {
        friends: {
            title: 'Amici',
            description: 'Aggiungi amici e guarda cosa condividono.',
        },
    },
    auth: {
        group: 'Accesso',
        recovery: {
            providerReset: {
                title: 'Ripristino tramite provider',
                description: 'Recupera un account accedendo con il suo provider di identità.',
            },
        },
        login: {
            keyChallenge: {
                title: 'Accesso con chiave',
                description: 'Accedi dimostrando la chiave di un dispositivo.',
            },
        },
        mtls: {
            title: 'Certificati client',
            description: 'Accedi con un certificato client (mTLS).',
        },
        ui: {
            recoveryKeyReminder: {
                title: 'Promemoria della chiave di recupero',
                description: 'Ricorda alle persone di salvare la chiave di recupero.',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'Accesso tramite scansione',
                description: 'Accedi su un telefono scansionando un codice su un computer.',
            },
            boundQrV2: {
                title: 'Codici di abbinamento più sicuri',
                description: 'Codici di abbinamento validi solo per questo Home e questa direzione.',
            },
        },
    },
    encryption: {
        group: 'Cifratura',
        plaintextStorage: {
            title: 'Archiviazione non cifrata',
            description: 'Archivia le sessioni senza cifratura end-to-end.',
        },
        accountOptOut: {
            title: 'Rinuncia alla cifratura',
            description: 'Ogni persona può disattivare la cifratura end-to-end.',
        },
    },
    remoteHosts: {
        group: 'Host remoti',
        management: {
            title: 'Host remoti',
            description: 'Salva host SSH su cui eseguire sessioni.',
        },
        secretMaterial: {
            title: 'Segreti degli host salvati',
            description: 'Salva password e chiavi degli host SSH.',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: 'Account senza chiavi',
            description: 'Account senza chiavi di cifratura end-to-end.',
        },
    },
    bugReports: {
        title: 'Segnalazioni di bug',
        description: 'Invia segnalazioni di bug con dati diagnostici.',
    },
    terminal: {
        group: 'Terminale',
        embeddedPty: {
            title: 'Terminale',
            description: 'Apri un terminale su una macchina dentro Happier.',
        },
        transport: {
            byteStream: {
                title: 'Terminale in streaming',
                description: 'Una connessione più veloce per il terminale integrato.',
            },
        },
    },
    search: {
        title: 'Ricerca',
        description: 'Cerca in sessioni e trascrizioni.',
    },
    providers: {
        title: 'Provider di modelli',
        description: 'Collega provider di modelli e scegli i modelli per gli agenti.',
        group: 'Provider di modelli',
        localDiscovery: {
            title: 'Trova provider locali',
            description: 'Trova server di modelli in esecuzione sulle tue macchine.',
        },
        localModelManagement: {
            title: 'Gestione dei modelli locali',
            description: 'Scarica e gestisci modelli locali.',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'Indirizzo del servizio di segnalazione',
            description: 'Dove vengono inviate le segnalazioni di bug. Se vuoto, non viene offerto alcun servizio di segnalazione.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: 'Includi la diagnostica per impostazione predefinita',
            description: 'Il modulo di segnalazione include i dati diagnostici, a meno che chi segnala non li escluda.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: 'Allegato più grande',
            description: 'File più grande che una segnalazione di bug può allegare, in byte.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'Tempo limite di caricamento',
            description: 'Quanto può durare il caricamento di una segnalazione di bug, in millisecondi.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: 'Tipi di allegato accettati',
            description: 'Tipi di allegato accettati dalle segnalazioni di bug. Vuoto accetta i tipi consueti.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'Finestra di contesto',
            description: 'Fino a quanto indietro nel tempo una segnalazione di bug raccoglie il contesto, in millisecondi.',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: 'La voce richiede un abbonamento',
            description: 'Solo gli abbonati possono usare la voce. Se non impostato, in produzione è richiesto e nelle altre configurazioni no.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'Manifest del pet più grande',
            description: 'Manifest del pet più grande accettato, in byte.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'Spritesheet del pet più grande',
            description: 'Spritesheet del pet più grande accettato, in byte.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'Pacchetto del pet più grande',
            description: 'Pacchetto del pet più grande accettato, in byte.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: 'Pet importati per persona',
            description: 'Numero massimo di pet importati che una persona può tenere.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: 'Spazio per pet importati per persona',
            description: 'Numero massimo di byte di pet importati che una persona può tenere.',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: 'Pet personalizzati cifrati',
            description: 'Riservato per il futuro. I pet personalizzati cifrati non vengono ancora sincronizzati, quindi l’opzione resta disattivata.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'Trasferimento più grande tramite questo Home',
            description: 'File più grande che un trasferimento tramite questo Home trasporta, in byte.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: 'Trasferimenti simultanei per connessione',
            description: 'Numero massimo di trasferimenti tramite questo Home che una connessione esegue contemporaneamente.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'Dati per tunnel',
            description: 'Numero massimo di byte che un tunnel tramite questo Home trasporta.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: 'Tunnel per connessione',
            description: 'Numero massimo di tunnel tramite questo Home che una connessione tiene aperti.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Frame di tunnel più grande',
            description: 'Frame più grande che un tunnel tramite questo Home trasporta, in byte.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'Codifiche dei tunnel',
            description: 'Codifiche dei frame accettate dai tunnel tramite questo Home. Vuoto usa quelle standard.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: 'Codifica di tunnel preferita',
            description: 'La codifica dei frame da usare per prima. Deve essere tra le codifiche accettate.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'Intestazione di frame più grande',
            description: 'Intestazione binaria di frame più grande, in byte.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'Payload di frame più grande',
            description: 'Payload grezzo più grande in un frame, in byte.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'Messaggio in frame più grande',
            description: 'Messaggio in frame più grande, in byte.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'Stream simultanei per tunnel',
            description: 'Numero massimo di stream che un tunnel esegue contemporaneamente.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'Stream per tunnel',
            description: 'Numero massimo di stream che un tunnel apre nel corso della sua vita.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'Dati per stream',
            description: 'Numero massimo di byte che uno stream trasporta.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'Dati per tunnel, tutti gli stream',
            description: 'Numero massimo di byte che tutti gli stream di un tunnel trasportano insieme.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'Tempo limite di inattività dello stream',
            description: 'Quanto uno stream può restare inattivo prima di chiudersi, in millisecondi.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'Tempo limite di inattività del tunnel',
            description: 'Quanto un tunnel tramite questo Home può restare inattivo prima di chiudersi, in millisecondi.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'Limite di inattività dei tunnel',
            description: 'Quanto un tunnel può restare inattivo prima di chiudersi, in millisecondi.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'Tunnel più lungo',
            description: 'Tempo massimo per cui un tunnel resta aperto, in millisecondi.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'Porte raggiungibili dai tunnel',
            description: 'Porte che i tunnel possono aprire. Vuoto consente solo quelle predefinite.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'Durata del link di anteprima',
            description: 'Per quanto tempo funziona un link di anteprima privato, in millisecondi.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'Dominio delle anteprime',
            description: 'Dominio che serve ogni anteprima al proprio indirizzo. Vuoto serve le anteprime sotto l’indirizzo di questo Home.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: 'Modalità di anteprima pubblica',
            description: 'Modi in cui un’anteprima può essere resa pubblica.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: 'Anteprima pubblica più lunga',
            description: 'Tempo massimo per cui un’anteprima resta pubblica, in millisecondi. Vuoto mantiene il limite standard.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: 'Anteprime pubbliche simultanee',
            description: 'Numero massimo di anteprime pubbliche contemporaneamente. Vuoto mantiene il limite standard.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'Richiedi DNS e TLS',
            description: 'Le anteprime pubbliche richiedono DNS e TLS.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: 'Log di audit delle anteprime pubbliche',
            description: 'Dove vengono registrate le anteprime pubbliche. Le anteprime pubbliche ne richiedono uno.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: 'File del log di audit',
            description: 'File in cui viene scritto il log di audit delle anteprime pubbliche.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'Consenti il log di audit di test',
            description: 'Solo per lo sviluppo: accetta il log di audit di test in memoria. Ignorato in produzione.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: 'Limiti di frequenza delle anteprime pubbliche',
            description: 'Profili di limite di frequenza che le anteprime pubbliche possono usare.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'Controllo dei limiti di frequenza',
            description: 'Come vengono limitate le richieste alle anteprime pubbliche. Le anteprime pubbliche ne richiedono uno.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'Richieste per finestra',
            description: 'Richieste che un’anteprima pubblica consente in ogni finestra.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'Finestra del limite di frequenza',
            description: 'Durata di ogni finestra del limite di frequenza, in millisecondi.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'Consenti il limitatore di test',
            description: 'Solo per lo sviluppo: accetta il limitatore di frequenza di test in memoria. Ignorato in produzione.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: 'Webhook in corso',
            description: 'Numero massimo di richieste webhook che questo server gestisce contemporaneamente.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Memoria dei webhook',
            description: 'Memoria massima che le richieste webhook in corso possono usare, in byte. Vuoto consente quanto già permesso dal limite di richieste.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'Webhook al minuto per percorso',
            description: 'Richieste webhook al minuto su un percorso.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'Webhook simultanei per percorso',
            description: 'Richieste webhook in corso su un percorso.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'Webhook al minuto per endpoint',
            description: 'Richieste webhook al minuto su un endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'Webhook simultanei per endpoint',
            description: 'Richieste webhook in corso su un endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: 'Webhook al minuto per persona',
            description: 'Richieste webhook al minuto per una persona.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: 'Webhook simultanei per persona',
            description: 'Richieste webhook in corso per una persona.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'Bundle di schermata plugin più grande',
            description: 'Bundle di schermata plugin più grande ospitato da questo Home, in byte.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: 'Spazio per schermate dei plugin per persona',
            description: 'Numero massimo di byte di bundle di schermate dei plugin che una persona può archiviare.',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'Riga di dati plugin più grande',
            description: 'Riga più grande che un plugin archivia, in byte.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'Batch di dati plugin più grande',
            description: 'Batch più grande di modifiche ai dati dei plugin, in byte.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'Righe per batch di dati plugin',
            description: 'Numero massimo di righe in un batch di modifiche ai dati dei plugin.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: 'Righe di dati plugin per persona',
            description: 'Numero massimo di righe di dati dei plugin che una persona può archiviare.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: 'Spazio per dati plugin per persona',
            description: 'Numero massimo di byte di dati dei plugin che una persona può archiviare.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: 'Bitrate massimo dello stream',
            description: 'Bitrate massimo di uno stream in diretta tramite questo Home, in bit al secondo.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: 'Frame rate massimo dello stream',
            description: 'Frame rate massimo di uno stream in diretta tramite questo Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Frame di stream più grande',
            description: 'Frame più grande di uno stream in diretta tramite questo Home, in byte.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'Stream in diretta più lungo',
            description: 'Durata massima di uno stream in diretta tramite questo Home, in millisecondi.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'Dati per stream in diretta',
            description: 'Numero massimo di byte che uno stream in diretta tramite questo Home trasporta.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: 'Stream in diretta simultanei per persona',
            description: 'Numero massimo di stream in diretta tramite questo Home che una persona esegue contemporaneamente.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: 'Stream in diretta simultanei per connessione',
            description: 'Numero massimo di stream in diretta tramite questo Home che una connessione esegue contemporaneamente.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'Stream in diretta simultanei per macchina',
            description: 'Numero massimo di stream in diretta tramite questo Home che una macchina esegue contemporaneamente.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: 'ID della chiave di firma delle connessioni',
            description: 'Identifica la chiave che firma le connessioni tra macchine. Senza chiave di firma, queste connessioni sono disattivate.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: 'Chiave privata di firma delle connessioni',
            description: 'Chiave privata che firma le connessioni tra macchine.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: 'Chiave pubblica di firma delle connessioni',
            description: 'Chiave pubblica corrispondente alla chiave di firma. Se vuota, viene ricavata dalla chiave privata.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: 'Scadenza della chiave di firma',
            description: 'Quando scade la chiave di firma, come timestamp in millisecondi.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'Trova amici per nome utente',
            description: 'Le persone possono trovare amici per nome utente oltre che per account collegato.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: 'Provider per l’abbinamento degli amici',
            description: 'Il provider di accesso usato per abbinare gli amici.',
        },
    },
};

const pt: typeof en = {
    teams: {
        title: 'Equipas',
        description: 'Grupos com sessões, máquinas e acessos partilhados.',
        credentialResources: {
            title: 'Credenciais da equipa',
            description: 'Credenciais que uma equipa partilha com as suas sessões.',
            externalApi: {
                title: 'API de credenciais da equipa',
                description: 'Ferramentas externas usam as credenciais de uma equipa através da API.',
            },
        },
    },
    automations: {
        title: 'Automatizações',
        description: 'Trabalho de agentes agendado e acionado por eventos.',
    },
    workflows: {
        title: 'Fluxos de trabalho',
        description: 'Pipelines de agentes com vários passos.',
    },
    pets: {
        sync: {
            title: 'Sincronização de mascotes',
            description: 'Mantém as mascotes de cada pessoa em todos os seus dispositivos.',
        },
    },
    voice: {
        title: 'Voz',
        description: 'Fale com os seus agentes.',
        happierVoice: {
            title: 'Voz Happier',
            description: 'Voz através do serviço de voz que este Home disponibiliza.',
        },
    },
    connectedServices: {
        group: 'Serviços ligados',
        quotas: {
            title: 'Medidores de quota',
            description: 'Mostra quanta quota resta a cada conta ligada.',
        },
        subscription: {
            title: 'Estado da subscrição',
            description: 'Mostra o plano e o estado de cada conta ligada.',
        },
        accountGroups: {
            title: 'Grupos de contas',
            description: 'Agrupe contas ligadas em pools.',
        },
        accountFallback: {
            title: 'Conta de recurso',
            description: 'Passa para a conta seguinte do pool quando uma se esgota.',
        },
        autoQuotaReset: {
            title: 'Reposição automática de quota',
            description: 'Usa as reposições de quota acumuladas quando todas as contas de um pool se esgotam.',
        },
        autoDisablePlanInvalid: {
            title: 'Ignorar contas inutilizáveis',
            description: 'Desativa as contas do pool que não podem usar o modelo escolhido.',
        },
        poolQuotaLimitSelection: {
            title: 'Limites de quota do pool',
            description: 'Escolha que quota do fornecedor cada pool segue.',
        },
    },
    updates: {
        ota: {
            title: 'Atualizações remotas',
            description: 'As apps instalam atualizações sem passar pela loja.',
        },
    },
    attachments: {
        uploads: {
            title: 'Anexos',
            description: 'Envie ficheiros e imagens aos agentes de uma sessão.',
        },
    },
    sharing: {
        group: 'Partilha',
        session: {
            title: 'Partilha de sessões',
            description: 'Partilhe uma sessão com alguém neste Home.',
        },
        public: {
            title: 'Ligações públicas',
            description: 'Partilhe o conteúdo de uma sessão com uma ligação pública.',
        },
        contentKeys: {
            title: 'Partilha cifrada',
            description: 'Troca chaves para que as sessões partilhadas continuem cifradas ponto a ponto.',
        },
        pendingQueueV2: {
            title: 'Fila de mensagens partilhada',
            description: 'Coloca em fila as mensagens de uma sessão partilhada enquanto o agente está ocupado.',
        },
        pendingDeliveryState: {
            title: 'Seguimento de entrega da fila',
            description: 'Regista que mensagens em fila chegaram ao agente.',
        },
    },
    sessions: {
        title: 'Sessões',
        description: 'As sessões e os seus controlos.',
        group: 'Sessões',
        handoff: {
            title: 'Passagem de sessão',
            description: 'Mova uma sessão em curso para outra máquina.',
        },
        ephemeralRunner: {
            title: 'Runners efémeros',
            description: 'Inicie uma sessão numa máquina descartável.',
        },
        agentSwitching: {
            title: 'Troca de agente',
            description: 'Continue uma sessão com outro agente de programação.',
        },
        folders: {
            title: 'Pastas de sessões',
            description: 'Organize as sessões em pastas.',
        },
        drafts: {
            title: 'Rascunhos sincronizados',
            description: 'Mantenha mensagens por enviar e rascunhos de sessão em todos os dispositivos.',
        },
        following: {
            title: 'Seguir',
            description: 'Siga uma sessão para receber as suas novidades e notificações.',
        },
        conversations: {
            title: 'Conversas',
            description: 'As pessoas conversam e mencionam-se dentro de uma sessão partilhada.',
        },
        board: {
            title: 'Quadro de sessões',
            description: 'Organize sessões e os seus elementos em quadros partilhados.',
        },
        filteredListing: {
            title: 'Lista filtrada',
            description: 'Filtra a lista de sessões neste Home antes da paginação.',
        },
        usageLimitRecovery: {
            title: 'Retoma após limite de utilização',
            description: 'Esperar e retomar, ou tentar novamente, quando um agente atinge um limite de utilização.',
        },
    },
    machines: {
        title: 'Máquinas',
        description: 'A ligação às suas máquinas.',
        group: 'Máquinas',
        pools: {
            title: 'Pools de máquinas',
            description: 'Passa para a máquina seguinte quando uma está offline.',
        },
        transfer: {
            title: 'Transferências entre máquinas',
            description: 'Transferir dados entre máquinas.',
            directPeer: {
                title: 'Transferências diretas',
                description: 'Transfere dados diretamente entre máquinas.',
            },
            serverRouted: {
                title: 'Transferências através deste Home',
                description: 'Transfere dados através deste Home quando as máquinas não se conseguem ligar diretamente.',
            },
        },
        peerMediation: {
            title: 'Ligações entre máquinas',
            description: 'Túneis, transmissões e acessos entre máquinas.',
            observability: {
                title: 'Diagnóstico de ligações',
                description: 'Mostra como túneis, transmissões e pré-visualizações estão ligados entre máquinas.',
            },
        },
        tunnel: {
            title: 'Túneis entre máquinas',
            description: 'Abrir portas entre máquinas.',
            directPeer: {
                title: 'Túneis diretos',
                description: 'Abre portas diretamente entre máquinas.',
            },
            serverRouted: {
                title: 'Túneis através deste Home',
                description: 'Abre portas através deste Home quando as máquinas não se conseguem ligar diretamente.',
            },
        },
        liveStream: {
            title: 'Transmissões em direto',
            description: 'Transmitir o ecrã de uma máquina.',
            directPeer: {
                title: 'Transmissões diretas',
                description: 'Transmite o ecrã de uma máquina diretamente para o seu dispositivo.',
            },
            serverRouted: {
                title: 'Transmissões através deste Home',
                description: 'Transmite o ecrã de uma máquina através deste Home quando a transmissão direta falha.',
            },
        },
        rpc: {
            title: 'Chamadas a máquinas',
            description: 'Chegar às máquinas diretamente.',
            directPeer: {
                title: 'Chamadas diretas a máquinas',
                description: 'Chega a uma máquina diretamente em vez de através deste Home.',
            },
        },
    },
    localServices: {
        title: 'Serviços locais',
        description: 'Veja e abra os serviços em execução nas suas máquinas.',
        group: 'Serviços locais',
        inventory: {
            title: 'Inventário de serviços',
            description: 'Lista as portas e os serviços ativos em cada máquina.',
        },
        managed: {
            title: 'Serviços geridos',
            description: 'Inicie, nomeie e acompanhe serviços a partir do Happier.',
        },
        launcher: {
            title: 'Iniciador de serviços',
            description: 'Sugere serviços para abrir e pré-visualizar.',
        },
        actions: {
            title: 'Ações de serviços',
            description: 'Copiar, pré-visualizar e esquecer serviços.',
            terminate: {
                title: 'Parar serviços',
                description: 'Para o processo de um serviço detetado.',
            },
        },
        preview: {
            title: 'Pré-visualizações de serviços',
            description: 'Pré-visualiza um serviço local em privado dentro de uma sessão.',
        },
        publicPreview: {
            title: 'Pré-visualizações públicas',
            description: 'Partilhe a pré-visualização de um serviço num endereço público.',
        },
    },
    browser: {
        title: 'Navegador',
        description: 'Abra páginas, pré-visualizações e vistas alojadas dentro do Happier.',
        group: 'Navegador',
        viewTargets: {
            title: 'Vistas do navegador',
            description: 'Abre pré-visualizações, páginas de plugins e ligações na vista certa.',
        },
        internal: {
            title: 'Navegador integrado',
            description: 'Navegue dentro do Happier com sessões e perfis próprios.',
        },
        sidecar: {
            title: 'Navegador auxiliar',
            description: 'Um navegador gerido à parte para automatização intensiva.',
        },
        diagnostics: {
            title: 'Ferramentas de programador',
            description: 'Consola, rede e eventos devtools do navegador integrado.',
        },
        context: {
            title: 'Contexto do navegador',
            description: 'Anexe o conteúdo de uma página a uma mensagem ou a um agente.',
        },
        automation: {
            title: 'Automatização do navegador',
            description: 'Os agentes clicam, escrevem e navegam no navegador integrado.',
        },
        recording: {
            title: 'Gravações do navegador',
            description: 'Grava sessões do navegador como prova.',
        },
    },
    plugins: {
        title: 'Plugins de fora do Happier',
        description: 'Instale plugins a partir do npm e das suas próprias fontes.',
        group: 'Plugins',
        webhooks: {
            title: 'Webhooks de plugins',
            description: 'Os plugins recebem webhooks de serviços externos.',
        },
        ui: {
            title: 'Ecrãs de plugins',
            description: 'Mostra os ecrãs e painéis que os plugins disponibilizam.',
            hostedWeb: {
                title: 'Ecrãs web de plugins',
                description: 'Mostra ecrãs de plugins criados para a web.',
            },
            reactNativeBundles: {
                title: 'Ecrãs nativos de plugins',
                description: 'Executa ecrãs de plugins de confiança criados com React Native.',
            },
        },
    },
    devices: {
        title: 'Dispositivos',
        description: 'Simuladores e dispositivos ligados.',
        simulatorPreview: {
            title: 'Pré-visualizações de simuladores',
            description: 'Mostra simuladores e emuladores das suas máquinas.',
        },
    },
    social: {
        friends: {
            title: 'Amigos',
            description: 'Adicione amigos e veja o que partilham.',
        },
    },
    auth: {
        group: 'Início de sessão',
        recovery: {
            providerReset: {
                title: 'Repor através de um fornecedor',
                description: 'Recupere uma conta iniciando sessão com o seu fornecedor de identidade.',
            },
        },
        login: {
            keyChallenge: {
                title: 'Início de sessão com chave',
                description: 'Inicie sessão provando a chave de um dispositivo.',
            },
        },
        mtls: {
            title: 'Certificados de cliente',
            description: 'Inicie sessão com um certificado de cliente (mTLS).',
        },
        ui: {
            recoveryKeyReminder: {
                title: 'Lembrete da chave de recuperação',
                description: 'Lembra as pessoas de guardar a chave de recuperação.',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'Iniciar sessão por leitura',
                description: 'Inicie sessão num telemóvel lendo um código num computador.',
            },
            boundQrV2: {
                title: 'Códigos de emparelhamento mais seguros',
                description: 'Códigos de emparelhamento válidos só para este Home e esta direção.',
            },
        },
    },
    encryption: {
        group: 'Cifra',
        plaintextStorage: {
            title: 'Armazenamento sem cifra',
            description: 'Guarda as sessões sem cifra ponto a ponto.',
        },
        accountOptOut: {
            title: 'Desativar a cifra',
            description: 'Cada pessoa pode desligar a cifra ponto a ponto.',
        },
    },
    remoteHosts: {
        group: 'Anfitriões remotos',
        management: {
            title: 'Anfitriões remotos',
            description: 'Guarde anfitriões SSH onde executar sessões.',
        },
        secretMaterial: {
            title: 'Segredos de anfitriões guardados',
            description: 'Guarde palavras-passe e chaves de anfitriões SSH.',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: 'Contas sem chaves',
            description: 'Contas sem chaves de cifra ponto a ponto.',
        },
    },
    bugReports: {
        title: 'Relatórios de erros',
        description: 'Envie relatórios de erros com diagnósticos.',
    },
    terminal: {
        group: 'Terminal',
        embeddedPty: {
            title: 'Terminal',
            description: 'Abra um terminal numa máquina dentro do Happier.',
        },
        transport: {
            byteStream: {
                title: 'Terminal em fluxo',
                description: 'Uma ligação mais rápida para o terminal integrado.',
            },
        },
    },
    search: {
        title: 'Pesquisa',
        description: 'Pesquise em sessões e transcrições.',
    },
    providers: {
        title: 'Fornecedores de modelos',
        description: 'Ligue fornecedores de modelos e escolha modelos para os agentes.',
        group: 'Fornecedores de modelos',
        localDiscovery: {
            title: 'Encontrar fornecedores locais',
            description: 'Encontra servidores de modelos em execução nas suas máquinas.',
        },
        localModelManagement: {
            title: 'Gestão de modelos locais',
            description: 'Transfira e gira modelos locais.',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'Endereço do serviço de relatórios',
            description: 'Para onde são enviados os relatórios de erros. Se ficar em branco, não é oferecido nenhum serviço de relatórios.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: 'Incluir diagnósticos por predefinição',
            description: 'O formulário de relatório inclui diagnósticos, a menos que quem reporta opte por não os incluir.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: 'Anexo máximo',
            description: 'Maior ficheiro que um relatório de erros pode anexar, em bytes.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'Tempo limite de envio',
            description: 'Quanto tempo pode demorar o envio de um relatório de erros, em milissegundos.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: 'Tipos de anexo aceites',
            description: 'Tipos de anexo que os relatórios de erros aceitam. Vazio aceita os tipos habituais.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'Janela de contexto',
            description: 'Até que ponto no passado um relatório de erros recolhe contexto, em milissegundos.',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: 'Voz requer subscrição',
            description: 'Só os subscritores podem usar a voz. Se não estiver definido, é obrigatório em produção e não nas outras configurações.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'Manifesto de mascote máximo',
            description: 'Maior manifesto de mascote aceite, em bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'Spritesheet de mascote máxima',
            description: 'Maior spritesheet de mascote aceite, em bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'Pacote de mascote máximo',
            description: 'Maior pacote de mascote aceite, em bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: 'Mascotes importadas por pessoa',
            description: 'Número máximo de mascotes importadas que uma pessoa pode manter.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: 'Armazenamento de mascotes importadas por pessoa',
            description: 'Máximo de bytes de mascotes importadas que uma pessoa pode manter.',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: 'Mascotes personalizadas cifradas',
            description: 'Reservado para o futuro. As mascotes personalizadas cifradas ainda não são sincronizadas, por isso fica desativado.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'Maior transferência através deste Home',
            description: 'Maior ficheiro que uma transferência através deste Home transporta, em bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: 'Transferências em simultâneo por ligação',
            description: 'Máximo de transferências através deste Home que uma ligação executa em simultâneo.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'Dados por túnel',
            description: 'Máximo de bytes que um túnel através deste Home transporta.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: 'Túneis por ligação',
            description: 'Máximo de túneis através deste Home que uma ligação mantém abertos.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Maior trama de túnel',
            description: 'Maior trama que um túnel através deste Home transporta, em bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'Codificações de túnel',
            description: 'Codificações de trama que os túneis através deste Home aceitam. Vazio usa as padrão.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: 'Codificação de túnel preferida',
            description: 'A codificação de trama a usar primeiro. Tem de ser uma das codificações aceites.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'Maior cabeçalho de trama',
            description: 'Maior cabeçalho binário de trama, em bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'Maior carga útil de trama',
            description: 'Maior carga útil bruta numa trama, em bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'Maior mensagem em tramas',
            description: 'Maior mensagem dividida em tramas, em bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'Fluxos em simultâneo por túnel',
            description: 'Máximo de fluxos que um túnel executa em simultâneo.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'Fluxos por túnel',
            description: 'Máximo de fluxos que um túnel abre ao longo da sua vida útil.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'Dados por fluxo',
            description: 'Máximo de bytes que um fluxo transporta.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'Dados por túnel, todos os fluxos',
            description: 'Máximo de bytes que todos os fluxos de um túnel transportam em conjunto.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'Tempo limite de fluxo inativo',
            description: 'Quanto tempo um fluxo pode ficar inativo antes de fechar, em milissegundos.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'Tempo limite de túnel inativo',
            description: 'Quanto tempo um túnel através deste Home pode ficar inativo antes de fechar, em milissegundos.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'Tempo limite de inatividade do túnel',
            description: 'Quanto tempo um túnel pode ficar inativo antes de fechar, em milissegundos.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'Duração máxima do túnel',
            description: 'Tempo máximo que um túnel fica aberto, em milissegundos.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'Portas acessíveis por túneis',
            description: 'Portas que os túneis podem abrir. Vazio permite apenas as predefinidas.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'Duração da ligação de pré-visualização',
            description: 'Quanto tempo funciona uma ligação de pré-visualização privada, em milissegundos.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'Domínio de pré-visualização',
            description: 'Domínio que serve cada pré-visualização no seu próprio endereço. Vazio serve as pré-visualizações no endereço deste Home.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: 'Modos de pré-visualização pública',
            description: 'Formas de tornar uma pré-visualização pública.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: 'Pré-visualização pública mais longa',
            description: 'Tempo máximo que uma pré-visualização fica pública, em milissegundos. Vazio mantém o limite padrão.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: 'Pré-visualizações públicas em simultâneo',
            description: 'Máximo de pré-visualizações públicas ao mesmo tempo. Vazio mantém o limite padrão.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'Exigir DNS e TLS',
            description: 'As pré-visualizações públicas precisam de DNS e TLS.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: 'Registo de auditoria de pré-visualizações públicas',
            description: 'Onde as pré-visualizações públicas são registadas. As pré-visualizações públicas precisam de um.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: 'Ficheiro do registo de auditoria',
            description: 'Ficheiro onde é escrito o registo de auditoria das pré-visualizações públicas.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'Permitir o registo de auditoria de teste',
            description: 'Apenas para desenvolvimento: aceita o registo de auditoria de teste em memória. Ignorado em produção.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: 'Limites de pedidos de pré-visualizações públicas',
            description: 'Perfis de limite de pedidos que as pré-visualizações públicas podem usar.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'Verificador de limite de pedidos',
            description: 'Como são limitados os pedidos às pré-visualizações públicas. As pré-visualizações públicas precisam de um.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'Pedidos por janela',
            description: 'Pedidos que uma pré-visualização pública permite em cada janela.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'Janela de limite de pedidos',
            description: 'Duração de cada janela de limite de pedidos, em milissegundos.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'Permitir o limitador de pedidos de teste',
            description: 'Apenas para desenvolvimento: aceita o limitador de pedidos de teste em memória. Ignorado em produção.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: 'Webhooks em curso',
            description: 'Máximo de pedidos de webhook que este servidor processa em simultâneo.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Memória de webhooks',
            description: 'Máximo de memória que os pedidos de webhook em curso podem usar, em bytes. Vazio permite o que o limite de pedidos já autoriza.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'Webhooks por minuto por rota',
            description: 'Pedidos de webhook por minuto numa rota.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'Webhooks em simultâneo por rota',
            description: 'Pedidos de webhook em curso numa rota.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'Webhooks por minuto por endpoint',
            description: 'Pedidos de webhook por minuto num endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'Webhooks em simultâneo por endpoint',
            description: 'Pedidos de webhook em curso num endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: 'Webhooks por minuto por pessoa',
            description: 'Pedidos de webhook por minuto para uma pessoa.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: 'Webhooks em simultâneo por pessoa',
            description: 'Pedidos de webhook em curso para uma pessoa.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'Maior pacote de ecrã de plugin',
            description: 'Maior pacote de ecrã de plugin que este Home aloja, em bytes.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: 'Armazenamento de ecrãs de plugins por pessoa',
            description: 'Máximo de bytes de pacotes de ecrãs de plugins que uma pessoa pode guardar.',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'Maior linha de dados de plugin',
            description: 'Maior linha que um plugin guarda, em bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'Maior lote de dados de plugin',
            description: 'Maior lote de alterações a dados de plugins, em bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'Linhas por lote de dados de plugin',
            description: 'Máximo de linhas num lote de alterações a dados de plugins.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: 'Linhas de dados de plugins por pessoa',
            description: 'Máximo de linhas de dados de plugins que uma pessoa pode guardar.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: 'Armazenamento de dados de plugins por pessoa',
            description: 'Máximo de bytes de dados de plugins que uma pessoa pode guardar.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: 'Taxa de bits máxima da transmissão',
            description: 'Taxa de bits máxima de uma transmissão em direto através deste Home, em bits por segundo.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: 'Taxa de fotogramas máxima da transmissão',
            description: 'Taxa de fotogramas máxima de uma transmissão em direto através deste Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Maior fotograma da transmissão',
            description: 'Maior fotograma de uma transmissão em direto através deste Home, em bytes.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'Transmissão em direto mais longa',
            description: 'Tempo máximo que uma transmissão em direto através deste Home dura, em milissegundos.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'Dados por transmissão em direto',
            description: 'Máximo de bytes que uma transmissão em direto através deste Home transporta.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: 'Transmissões em simultâneo por pessoa',
            description: 'Máximo de transmissões em direto através deste Home que uma pessoa executa em simultâneo.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: 'Transmissões em simultâneo por ligação',
            description: 'Máximo de transmissões em direto através deste Home que uma ligação executa em simultâneo.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'Transmissões em simultâneo por máquina',
            description: 'Máximo de transmissões em direto através deste Home que uma máquina executa em simultâneo.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: 'ID da chave de assinatura de ligações',
            description: 'Identifica a chave que assina as ligações entre máquinas. Sem chave de assinatura, estas ligações ficam desativadas.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: 'Chave privada de assinatura de ligações',
            description: 'Chave privada que assina as ligações entre máquinas.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: 'Chave pública de assinatura de ligações',
            description: 'Chave pública correspondente à chave de assinatura. Se estiver vazia, é obtida a partir da chave privada.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: 'Expiração da chave de assinatura',
            description: 'Quando a chave de assinatura expira, como marca temporal em milissegundos.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'Encontrar amigos pelo nome de utilizador',
            description: 'As pessoas podem encontrar amigos pelo nome de utilizador, além da conta associada.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: 'Fornecedor para identificar amigos',
            description: 'O fornecedor de início de sessão usado para identificar amigos.',
        },
    },
};

const ca: typeof en = {
    teams: {
        title: 'Equips',
        description: 'Grups amb sessions, màquines i accés compartits.',
        credentialResources: {
            title: 'Credencials de l’equip',
            description: 'Credencials que un equip comparteix amb les seves sessions.',
            externalApi: {
                title: 'API de credencials de l’equip',
                description: 'Eines externes fan servir les credencials d’un equip mitjançant l’API.',
            },
        },
    },
    automations: {
        title: 'Automatitzacions',
        description: 'Feina d’agents programada i activada per esdeveniments.',
    },
    workflows: {
        title: 'Fluxos de treball',
        description: 'Pipelines d’agents de diversos passos.',
    },
    pets: {
        sync: {
            title: 'Sincronització de mascotes',
            description: 'Manté les mascotes de cada persona a tots els seus dispositius.',
        },
    },
    voice: {
        title: 'Veu',
        description: 'Parla amb els teus agents.',
        happierVoice: {
            title: 'Veu de Happier',
            description: 'Veu mitjançant el servei de veu que ofereix aquest Home.',
        },
    },
    connectedServices: {
        group: 'Serveis connectats',
        quotas: {
            title: 'Indicadors de quota',
            description: 'Mostra quanta quota li queda a cada compte connectat.',
        },
        subscription: {
            title: 'Estat de la subscripció',
            description: 'Mostra el pla i l’estat de cada compte connectat.',
        },
        accountGroups: {
            title: 'Grups de comptes',
            description: 'Agrupa els comptes connectats en pools.',
        },
        accountFallback: {
            title: 'Compte de reserva',
            description: 'Passa al compte següent del pool quan un s’esgota.',
        },
        autoQuotaReset: {
            title: 'Restabliment automàtic de quota',
            description: 'Fa servir els restabliments de quota acumulats quan tots els comptes d’un pool s’esgoten.',
        },
        autoDisablePlanInvalid: {
            title: 'Omet els comptes inservibles',
            description: 'Desactiva els comptes del pool que no poden fer servir el model triat.',
        },
        poolQuotaLimitSelection: {
            title: 'Límits de quota del pool',
            description: 'Tria quina quota del proveïdor segueix cada pool.',
        },
    },
    updates: {
        ota: {
            title: 'Actualitzacions remotes',
            description: 'Les apps instal·len actualitzacions sense passar per la botiga.',
        },
    },
    attachments: {
        uploads: {
            title: 'Adjunts',
            description: 'Envia fitxers i imatges als agents d’una sessió.',
        },
    },
    sharing: {
        group: 'Compartició',
        session: {
            title: 'Compartir sessions',
            description: 'Comparteix una sessió amb algú d’aquest Home.',
        },
        public: {
            title: 'Enllaços públics',
            description: 'Comparteix el contingut d’una sessió amb un enllaç públic.',
        },
        contentKeys: {
            title: 'Compartició xifrada',
            description: 'Intercanvia claus perquè les sessions compartides continuïn xifrades d’extrem a extrem.',
        },
        pendingQueueV2: {
            title: 'Cua de missatges compartida',
            description: 'Posa en cua els missatges d’una sessió compartida mentre el seu agent està ocupat.',
        },
        pendingDeliveryState: {
            title: 'Seguiment del lliurament de la cua',
            description: 'Recorda quins missatges en cua han arribat a l’agent.',
        },
    },
    sessions: {
        title: 'Sessions',
        description: 'Les sessions i els seus controls.',
        group: 'Sessions',
        handoff: {
            title: 'Traspàs de sessió',
            description: 'Mou una sessió en curs a una altra màquina.',
        },
        ephemeralRunner: {
            title: 'Runners efímers',
            description: 'Inicia una sessió en una màquina d’un sol ús.',
        },
        agentSwitching: {
            title: 'Canvi d’agent',
            description: 'Continua una sessió amb un altre agent de codi.',
        },
        folders: {
            title: 'Carpetes de sessions',
            description: 'Organitza les sessions en carpetes.',
        },
        drafts: {
            title: 'Esborranys sincronitzats',
            description: 'Conserva els missatges no enviats i els esborranys de sessió a cada dispositiu.',
        },
        following: {
            title: 'Seguiment',
            description: 'Segueix una sessió per rebre’n les novetats i notificacions.',
        },
        conversations: {
            title: 'Converses',
            description: 'Les persones conversen i es mencionen dins d’una sessió compartida.',
        },
        board: {
            title: 'Tauler de sessions',
            description: 'Organitza les sessions i els seus elements en taulers compartits.',
        },
        filteredListing: {
            title: 'Llista filtrada',
            description: 'Filtra la llista de sessions d’aquest Home abans de paginar-la.',
        },
        usageLimitRecovery: {
            title: 'Represa després d’un límit d’ús',
            description: 'Esperar i reprendre, o tornar-ho a provar, quan un agent arriba a un límit d’ús.',
        },
    },
    machines: {
        title: 'Màquines',
        description: 'La connexió amb les teves màquines.',
        group: 'Màquines',
        pools: {
            title: 'Pools de màquines',
            description: 'Passa a la màquina següent quan una està fora de línia.',
        },
        transfer: {
            title: 'Transferències entre màquines',
            description: 'Transferir dades entre màquines.',
            directPeer: {
                title: 'Transferències directes',
                description: 'Transfereix dades directament entre màquines.',
            },
            serverRouted: {
                title: 'Transferències a través d’aquest Home',
                description: 'Transfereix dades a través d’aquest Home quan les màquines no es poden connectar directament.',
            },
        },
        peerMediation: {
            title: 'Connexions entre màquines',
            description: 'Túnels, transmissions i accés entre màquines.',
            observability: {
                title: 'Diagnòstic de connexions',
                description: 'Mostra com es connecten túnels, transmissions i previsualitzacions entre màquines.',
            },
        },
        tunnel: {
            title: 'Túnels entre màquines',
            description: 'Obrir ports entre màquines.',
            directPeer: {
                title: 'Túnels directes',
                description: 'Obre ports directament entre màquines.',
            },
            serverRouted: {
                title: 'Túnels a través d’aquest Home',
                description: 'Obre ports a través d’aquest Home quan les màquines no es poden connectar directament.',
            },
        },
        liveStream: {
            title: 'Transmissions en directe',
            description: 'Transmetre la pantalla d’una màquina.',
            directPeer: {
                title: 'Transmissions directes',
                description: 'Transmet la pantalla d’una màquina directament al teu dispositiu.',
            },
            serverRouted: {
                title: 'Transmissions a través d’aquest Home',
                description: 'Transmet la pantalla d’una màquina a través d’aquest Home quan la transmissió directa falla.',
            },
        },
        rpc: {
            title: 'Crides a màquines',
            description: 'Arribar a les màquines directament.',
            directPeer: {
                title: 'Crides directes a màquines',
                description: 'Arriba a una màquina directament en lloc de fer-ho a través d’aquest Home.',
            },
        },
    },
    localServices: {
        title: 'Serveis locals',
        description: 'Veu i obre els serveis que s’executen a les teves màquines.',
        group: 'Serveis locals',
        inventory: {
            title: 'Inventari de serveis',
            description: 'Llista els ports i serveis actius a cada màquina.',
        },
        managed: {
            title: 'Serveis gestionats',
            description: 'Inicia, anomena i vigila serveis des de Happier.',
        },
        launcher: {
            title: 'Llançador de serveis',
            description: 'Suggereix serveis per obrir i previsualitzar.',
        },
        actions: {
            title: 'Accions de serveis',
            description: 'Copiar, previsualitzar i oblidar serveis.',
            terminate: {
                title: 'Aturar serveis',
                description: 'Atura el procés d’un servei detectat.',
            },
        },
        preview: {
            title: 'Previsualitzacions de serveis',
            description: 'Previsualitza un servei local en privat dins d’una sessió.',
        },
        publicPreview: {
            title: 'Previsualitzacions públiques',
            description: 'Comparteix la previsualització d’un servei en una adreça pública.',
        },
    },
    browser: {
        title: 'Navegador',
        description: 'Obre pàgines, previsualitzacions i vistes allotjades dins de Happier.',
        group: 'Navegador',
        viewTargets: {
            title: 'Vistes del navegador',
            description: 'Obre previsualitzacions, pàgines de plugins i enllaços a la vista adequada.',
        },
        internal: {
            title: 'Navegador integrat',
            description: 'Navega dins de Happier amb sessions i perfils propis.',
        },
        sidecar: {
            title: 'Navegador auxiliar',
            description: 'Un navegador gestionat a part per a automatització intensiva.',
        },
        diagnostics: {
            title: 'Eines de desenvolupament',
            description: 'Consola, xarxa i esdeveniments devtools del navegador integrat.',
        },
        context: {
            title: 'Context del navegador',
            description: 'Adjunta el contingut d’una pàgina a un missatge o a un agent.',
        },
        automation: {
            title: 'Automatització del navegador',
            description: 'Els agents fan clic, escriuen i naveguen al navegador integrat.',
        },
        recording: {
            title: 'Enregistraments del navegador',
            description: 'Enregistra les sessions del navegador com a prova.',
        },
    },
    plugins: {
        title: 'Plugins de fora de Happier',
        description: 'Instal·la plugins des de npm i des de les teves fonts.',
        group: 'Plugins',
        webhooks: {
            title: 'Webhooks de plugins',
            description: 'Els plugins reben webhooks de serveis externs.',
        },
        ui: {
            title: 'Pantalles de plugins',
            description: 'Mostra les pantalles i els panells que ofereixen els plugins.',
            hostedWeb: {
                title: 'Pantalles web de plugins',
                description: 'Mostra pantalles de plugins creades per al web.',
            },
            reactNativeBundles: {
                title: 'Pantalles natives de plugins',
                description: 'Executa pantalles de plugins de confiança creades amb React Native.',
            },
        },
    },
    devices: {
        title: 'Dispositius',
        description: 'Simuladors i dispositius connectats.',
        simulatorPreview: {
            title: 'Previsualitzacions de simuladors',
            description: 'Mostra simuladors i emuladors de les teves màquines.',
        },
    },
    social: {
        friends: {
            title: 'Amics',
            description: 'Afegeix amics i mira què comparteixen.',
        },
    },
    auth: {
        group: 'Inici de sessió',
        recovery: {
            providerReset: {
                title: 'Restabliment amb un proveïdor',
                description: 'Recupera un compte iniciant la sessió amb el seu proveïdor d’identitat.',
            },
        },
        login: {
            keyChallenge: {
                title: 'Inici de sessió amb clau',
                description: 'Inicia la sessió demostrant la clau d’un dispositiu.',
            },
        },
        mtls: {
            title: 'Certificats de client',
            description: 'Inicia la sessió amb un certificat de client (mTLS).',
        },
        ui: {
            recoveryKeyReminder: {
                title: 'Recordatori de la clau de recuperació',
                description: 'Recorda a les persones que desin la clau de recuperació.',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'Inici de sessió escanejant',
                description: 'Inicia la sessió en un telèfon escanejant un codi en un ordinador.',
            },
            boundQrV2: {
                title: 'Codis de vinculació més segurs',
                description: 'Codis de vinculació que només serveixen per a aquest Home i aquesta direcció.',
            },
        },
    },
    encryption: {
        group: 'Xifratge',
        plaintextStorage: {
            title: 'Emmagatzematge sense xifrar',
            description: 'Desa les sessions sense xifratge d’extrem a extrem.',
        },
        accountOptOut: {
            title: 'Desactivar el xifratge',
            description: 'Cada persona pot desactivar el xifratge d’extrem a extrem.',
        },
    },
    remoteHosts: {
        group: 'Amfitrions remots',
        management: {
            title: 'Amfitrions remots',
            description: 'Desa amfitrions SSH on executar sessions.',
        },
        secretMaterial: {
            title: 'Secrets d’amfitrions desats',
            description: 'Desa contrasenyes i claus d’amfitrions SSH.',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: 'Comptes sense claus',
            description: 'Comptes sense claus de xifratge d’extrem a extrem.',
        },
    },
    bugReports: {
        title: 'Informes d’errors',
        description: 'Envia informes d’errors amb diagnòstics.',
    },
    terminal: {
        group: 'Terminal',
        embeddedPty: {
            title: 'Terminal',
            description: 'Obre un terminal en una màquina dins de Happier.',
        },
        transport: {
            byteStream: {
                title: 'Terminal per flux',
                description: 'Una connexió més ràpida per al terminal integrat.',
            },
        },
    },
    search: {
        title: 'Cerca',
        description: 'Cerca en sessions i transcripcions.',
    },
    providers: {
        title: 'Proveïdors de models',
        description: 'Connecta proveïdors de models i tria models per als agents.',
        group: 'Proveïdors de models',
        localDiscovery: {
            title: 'Troba proveïdors locals',
            description: 'Troba servidors de models que s’executen a les teves màquines.',
        },
        localModelManagement: {
            title: 'Gestió de models locals',
            description: 'Baixa i gestiona models locals.',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'Adreça del servei d’informes',
            description: 'On s’envien els informes d’errors. Si es deixa en blanc, no s’ofereix cap servei d’informes.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: 'Inclou diagnòstics per defecte',
            description: 'El formulari d’informe inclou diagnòstics tret que qui informa ho desactivi.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: 'Adjunt màxim',
            description: 'Fitxer més gran que pot adjuntar un informe d’errors, en bytes.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'Temps límit de pujada',
            description: 'Quant pot trigar la pujada d’un informe d’errors, en mil·lisegons.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: 'Tipus d’adjunt acceptats',
            description: 'Tipus d’adjunt que accepten els informes d’errors. Buit accepta els tipus habituals.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'Finestra de context',
            description: 'Fins a quin punt enrere recull context un informe d’errors, en mil·lisegons.',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: 'La veu requereix subscripció',
            description: 'Només els subscriptors poden fer servir la veu. Si no es defineix, producció ho exigeix i la resta de configuracions no.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'Manifest de mascota màxim',
            description: 'Manifest de mascota més gran acceptat, en bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'Spritesheet de mascota màxim',
            description: 'Spritesheet de mascota més gran acceptat, en bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'Paquet de mascota màxim',
            description: 'Paquet de mascota més gran acceptat, en bytes.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: 'Mascotes importades per persona',
            description: 'Nombre màxim de mascotes importades que pot conservar una persona.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: 'Emmagatzematge de mascotes importades per persona',
            description: 'Màxim de bytes de mascotes importades que pot conservar una persona.',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: 'Mascotes personalitzades xifrades',
            description: 'Reservat per al futur. Les mascotes personalitzades xifrades encara no se sincronitzen, així que queda desactivat.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'Transferència màxima a través d’aquest Home',
            description: 'Fitxer més gran que porta una transferència a través d’aquest Home, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: 'Transferències simultànies per connexió',
            description: 'Màxim de transferències a través d’aquest Home que una connexió executa alhora.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'Dades per túnel',
            description: 'Màxim de bytes que porta un túnel a través d’aquest Home.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: 'Túnels per connexió',
            description: 'Màxim de túnels a través d’aquest Home que una connexió manté oberts.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Trama de túnel màxima',
            description: 'Trama més gran que porta un túnel a través d’aquest Home, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'Codificacions de túnel',
            description: 'Codificacions de trama que accepten els túnels a través d’aquest Home. Buit fa servir les estàndard.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: 'Codificació de túnel preferida',
            description: 'La codificació de trama que s’ha de fer servir primer. Ha de ser una de les codificacions acceptades.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'Capçalera de trama màxima',
            description: 'Capçalera binària de trama més gran, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'Càrrega útil de trama màxima',
            description: 'Càrrega útil en brut més gran d’una trama, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'Missatge en trames màxim',
            description: 'Missatge dividit en trames més gran, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'Fluxos simultanis per túnel',
            description: 'Màxim de fluxos que un túnel executa alhora.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'Fluxos per túnel',
            description: 'Màxim de fluxos que un túnel obre al llarg de la seva vida.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'Dades per flux',
            description: 'Màxim de bytes que porta un flux.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'Dades per túnel, tots els fluxos',
            description: 'Màxim de bytes que porten junts tots els fluxos d’un túnel.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'Temps límit de flux inactiu',
            description: 'Quant temps pot estar inactiu un flux abans de tancar-se, en mil·lisegons.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'Temps límit de túnel inactiu',
            description: 'Quant temps pot estar inactiu un túnel a través d’aquest Home abans de tancar-se, en mil·lisegons.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'Temps límit d’inactivitat del túnel',
            description: 'Quant temps pot estar inactiu un túnel abans de tancar-se, en mil·lisegons.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'Durada màxima del túnel',
            description: 'Temps màxim que un túnel està obert, en mil·lisegons.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'Ports accessibles pels túnels',
            description: 'Ports que poden obrir els túnels. Buit només permet els predeterminats.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'Durada de l’enllaç de previsualització',
            description: 'Quant temps funciona un enllaç de previsualització privat, en mil·lisegons.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'Domini de previsualització',
            description: 'Domini que serveix cada previsualització a la seva pròpia adreça. Buit serveix les previsualitzacions sota l’adreça d’aquest Home.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: 'Modes de previsualització pública',
            description: 'Maneres de fer pública una previsualització.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: 'Previsualització pública més llarga',
            description: 'Temps màxim que una previsualització és pública, en mil·lisegons. Buit manté el límit estàndard.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: 'Previsualitzacions públiques simultànies',
            description: 'Màxim de previsualitzacions públiques alhora. Buit manté el límit estàndard.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'Exigeix DNS i TLS',
            description: 'Les previsualitzacions públiques necessiten DNS i TLS.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: 'Registre d’auditoria de previsualitzacions públiques',
            description: 'On es registren les previsualitzacions públiques. Les previsualitzacions públiques en necessiten un.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: 'Fitxer del registre d’auditoria',
            description: 'Fitxer on s’escriu el registre d’auditoria de les previsualitzacions públiques.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'Permet el registre d’auditoria de prova',
            description: 'Només per a desenvolupament: accepta el registre d’auditoria de prova en memòria. S’ignora en producció.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: 'Límits de peticions de previsualitzacions públiques',
            description: 'Perfils de límit de peticions que poden fer servir les previsualitzacions públiques.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'Verificador de límit de peticions',
            description: 'Com es limiten les peticions a les previsualitzacions públiques. Les previsualitzacions públiques en necessiten un.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'Peticions per finestra',
            description: 'Peticions que permet una previsualització pública en cada finestra.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'Finestra de límit de peticions',
            description: 'Durada de cada finestra de límit de peticions, en mil·lisegons.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'Permet el limitador de peticions de prova',
            description: 'Només per a desenvolupament: accepta el limitador de peticions de prova en memòria. S’ignora en producció.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: 'Webhooks en curs',
            description: 'Màxim de peticions de webhook que aquest servidor gestiona alhora.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Memòria de webhooks',
            description: 'Màxim de memòria que poden fer servir les peticions de webhook en curs, en bytes. Buit permet el que ja permet el límit de peticions.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'Webhooks per minut per ruta',
            description: 'Peticions de webhook per minut en una ruta.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'Webhooks simultanis per ruta',
            description: 'Peticions de webhook en curs en una ruta.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'Webhooks per minut per endpoint',
            description: 'Peticions de webhook per minut en un endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'Webhooks simultanis per endpoint',
            description: 'Peticions de webhook en curs en un endpoint.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: 'Webhooks per minut per persona',
            description: 'Peticions de webhook per minut per a una persona.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: 'Webhooks simultanis per persona',
            description: 'Peticions de webhook en curs per a una persona.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'Paquet de pantalla de plugin màxim',
            description: 'Paquet de pantalla de plugin més gran que allotja aquest Home, en bytes.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: 'Emmagatzematge de pantalles de plugins per persona',
            description: 'Màxim de bytes de paquets de pantalles de plugins que pot desar una persona.',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'Fila de dades de plugin màxima',
            description: 'Fila més gran que desa un plugin, en bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'Lot de dades de plugin màxim',
            description: 'Lot més gran de canvis de dades de plugins, en bytes.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'Files per lot de dades de plugin',
            description: 'Màxim de files en un lot de canvis de dades de plugins.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: 'Files de dades de plugins per persona',
            description: 'Màxim de files de dades de plugins que pot desar una persona.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: 'Emmagatzematge de dades de plugins per persona',
            description: 'Màxim de bytes de dades de plugins que pot desar una persona.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: 'Taxa de bits màxima de la transmissió',
            description: 'Taxa de bits màxima d’una transmissió en directe a través d’aquest Home, en bits per segon.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: 'Fotogrames per segon màxims de la transmissió',
            description: 'Fotogrames per segon màxims d’una transmissió en directe a través d’aquest Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Fotograma de transmissió màxim',
            description: 'Fotograma més gran d’una transmissió en directe a través d’aquest Home, en bytes.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'Transmissió en directe més llarga',
            description: 'Temps màxim que dura una transmissió en directe a través d’aquest Home, en mil·lisegons.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'Dades per transmissió en directe',
            description: 'Màxim de bytes que porta una transmissió en directe a través d’aquest Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: 'Transmissions simultànies per persona',
            description: 'Màxim de transmissions en directe a través d’aquest Home que una persona executa alhora.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: 'Transmissions simultànies per connexió',
            description: 'Màxim de transmissions en directe a través d’aquest Home que una connexió executa alhora.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'Transmissions simultànies per màquina',
            description: 'Màxim de transmissions en directe a través d’aquest Home que una màquina executa alhora.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: 'ID de la clau de signatura de connexions',
            description: 'Identifica la clau que signa les connexions entre màquines. Sense clau de signatura, aquestes connexions queden desactivades.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: 'Clau privada de signatura de connexions',
            description: 'Clau privada que signa les connexions entre màquines.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: 'Clau pública de signatura de connexions',
            description: 'Clau pública que correspon a la clau de signatura. Si és buida, s’obté de la clau privada.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: 'Caducitat de la clau de signatura',
            description: 'Quan caduca la clau de signatura, com a marca de temps en mil·lisegons.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'Troba amics pel nom d’usuari',
            description: 'Les persones poden trobar amics pel nom d’usuari, a més de pel compte vinculat.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: 'Proveïdor per identificar amics',
            description: 'El proveïdor d’inici de sessió que s’utilitza per identificar amics.',
        },
    },
};

const pl: typeof en = {
    teams: {
        title: 'Zespoły',
        description: 'Grupy ze wspólnymi sesjami, maszynami i dostępem.',
        credentialResources: {
            title: 'Dane uwierzytelniające zespołu',
            description: 'Dane uwierzytelniające, które zespół udostępnia swoim sesjom.',
            externalApi: {
                title: 'API danych uwierzytelniających zespołu',
                description: 'Zewnętrzne narzędzia korzystają z danych uwierzytelniających zespołu przez API.',
            },
        },
    },
    automations: {
        title: 'Automatyzacje',
        description: 'Zaplanowana i wyzwalana praca agentów.',
    },
    workflows: {
        title: 'Przepływy pracy',
        description: 'Wieloetapowe potoki agentów.',
    },
    pets: {
        sync: {
            title: 'Synchronizacja zwierzaków',
            description: 'Zwierzaki każdej osoby są dostępne na wszystkich jej urządzeniach.',
        },
    },
    voice: {
        title: 'Głos',
        description: 'Rozmawiaj ze swoimi agentami.',
        happierVoice: {
            title: 'Głos Happier',
            description: 'Głos przez usługę głosową udostępnianą przez ten Home.',
        },
    },
    connectedServices: {
        group: 'Połączone usługi',
        quotas: {
            title: 'Wskaźniki limitów',
            description: 'Pokazuje, ile limitu zostało na każdym połączonym koncie.',
        },
        subscription: {
            title: 'Stan subskrypcji',
            description: 'Pokazuje plan i stan każdego połączonego konta.',
        },
        accountGroups: {
            title: 'Grupy kont',
            description: 'Łącz połączone konta w pule.',
        },
        accountFallback: {
            title: 'Konto zapasowe',
            description: 'Przełącza na następne konto w puli, gdy jedno się wyczerpie.',
        },
        autoQuotaReset: {
            title: 'Automatyczne odnowienie limitu',
            description: 'Wykorzystuje zgromadzone odnowienia limitu, gdy wszystkie konta w puli się wyczerpią.',
        },
        autoDisablePlanInvalid: {
            title: 'Pomijanie bezużytecznych kont',
            description: 'Wyłącza konta w puli, które nie mogą używać wybranego modelu.',
        },
        poolQuotaLimitSelection: {
            title: 'Limity puli',
            description: 'Wybierz, za którym limitem dostawcy podąża każda pula.',
        },
    },
    updates: {
        ota: {
            title: 'Aktualizacje zdalne',
            description: 'Aplikacje instalują aktualizacje bez wydania w sklepie.',
        },
    },
    attachments: {
        uploads: {
            title: 'Załączniki',
            description: 'Wysyłaj pliki i obrazy agentom w sesji.',
        },
    },
    sharing: {
        group: 'Udostępnianie',
        session: {
            title: 'Udostępnianie sesji',
            description: 'Udostępnij sesję komuś w tym Home.',
        },
        public: {
            title: 'Linki publiczne',
            description: 'Udostępnij zawartość sesji przez publiczny link.',
        },
        contentKeys: {
            title: 'Szyfrowane udostępnianie',
            description: 'Wymienia klucze, aby udostępnione sesje pozostały szyfrowane end-to-end.',
        },
        pendingQueueV2: {
            title: 'Wspólna kolejka wiadomości',
            description: 'Kolejkuje wiadomości udostępnionej sesji, gdy jej agent jest zajęty.',
        },
        pendingDeliveryState: {
            title: 'Śledzenie dostarczania kolejki',
            description: 'Zapamiętuje, które wiadomości z kolejki dotarły do agenta.',
        },
    },
    sessions: {
        title: 'Sesje',
        description: 'Sesje i ich sterowanie.',
        group: 'Sesje',
        handoff: {
            title: 'Przekazanie sesji',
            description: 'Przenieś trwającą sesję na inną maszynę.',
        },
        ephemeralRunner: {
            title: 'Tymczasowe runnery',
            description: 'Uruchom sesję na jednorazowej maszynie.',
        },
        agentSwitching: {
            title: 'Zmiana agenta',
            description: 'Kontynuuj sesję z innym agentem programistycznym.',
        },
        folders: {
            title: 'Foldery sesji',
            description: 'Porządkuj sesje w folderach.',
        },
        drafts: {
            title: 'Synchronizowane szkice',
            description: 'Zachowuj niewysłane wiadomości i szkice nowych sesji na każdym urządzeniu.',
        },
        following: {
            title: 'Obserwowanie',
            description: 'Obserwuj sesję, aby dostawać jej aktualizacje i powiadomienia.',
        },
        conversations: {
            title: 'Rozmowy',
            description: 'Osoby rozmawiają i wspominają się nawzajem w udostępnionej sesji.',
        },
        board: {
            title: 'Tablica sesji',
            description: 'Układaj sesje i ich elementy na wspólnych tablicach.',
        },
        filteredListing: {
            title: 'Filtrowana lista',
            description: 'Filtruje listę sesji w tym Home przed stronicowaniem.',
        },
        usageLimitRecovery: {
            title: 'Wznawianie po limicie użycia',
            description: 'Czekaj i wznów albo ponów, gdy agent osiągnie limit użycia.',
        },
    },
    machines: {
        title: 'Maszyny',
        description: 'Połączenie z twoimi maszynami.',
        group: 'Maszyny',
        pools: {
            title: 'Pule maszyn',
            description: 'Przechodzi na następną maszynę, gdy jedna jest offline.',
        },
        transfer: {
            title: 'Transfery między maszynami',
            description: 'Przesyłanie danych między maszynami.',
            directPeer: {
                title: 'Bezpośrednie transfery',
                description: 'Przesyła dane bezpośrednio między maszynami.',
            },
            serverRouted: {
                title: 'Transfery przez ten Home',
                description: 'Przesyła dane przez ten Home, gdy maszyny nie mogą połączyć się bezpośrednio.',
            },
        },
        peerMediation: {
            title: 'Połączenia między maszynami',
            description: 'Tunele, strumienie i dostęp między maszynami.',
            observability: {
                title: 'Diagnostyka połączeń',
                description: 'Pokazuje, jak połączone są tunele, strumienie i podglądy między maszynami.',
            },
        },
        tunnel: {
            title: 'Tunele między maszynami',
            description: 'Otwieranie portów między maszynami.',
            directPeer: {
                title: 'Bezpośrednie tunele',
                description: 'Otwiera porty bezpośrednio między maszynami.',
            },
            serverRouted: {
                title: 'Tunele przez ten Home',
                description: 'Otwiera porty przez ten Home, gdy maszyny nie mogą połączyć się bezpośrednio.',
            },
        },
        liveStream: {
            title: 'Transmisje na żywo',
            description: 'Przesyłanie ekranu maszyny.',
            directPeer: {
                title: 'Bezpośrednie transmisje',
                description: 'Przesyła ekran maszyny bezpośrednio na twoje urządzenie.',
            },
            serverRouted: {
                title: 'Transmisje przez ten Home',
                description: 'Przesyła ekran maszyny przez ten Home, gdy transmisja bezpośrednia zawiedzie.',
            },
        },
        rpc: {
            title: 'Wywołania maszyn',
            description: 'Bezpośrednie łączenie z maszynami.',
            directPeer: {
                title: 'Bezpośrednie wywołania maszyn',
                description: 'Łączy się z maszyną bezpośrednio zamiast przez ten Home.',
            },
        },
    },
    localServices: {
        title: 'Usługi lokalne',
        description: 'Zobacz i otwórz usługi działające na twoich maszynach.',
        group: 'Usługi lokalne',
        inventory: {
            title: 'Spis usług',
            description: 'Wyświetla porty i usługi działające na każdej maszynie.',
        },
        managed: {
            title: 'Zarządzane usługi',
            description: 'Uruchamiaj, nazywaj i obserwuj usługi z Happier.',
        },
        launcher: {
            title: 'Uruchamiacz usług',
            description: 'Podpowiada usługi do otwarcia i podglądu.',
        },
        actions: {
            title: 'Akcje usług',
            description: 'Kopiuj, podglądaj i zapominaj usługi.',
            terminate: {
                title: 'Zatrzymywanie usług',
                description: 'Zatrzymuje proces wykrytej usługi.',
            },
        },
        preview: {
            title: 'Podgląd usług',
            description: 'Prywatny podgląd usługi lokalnej wewnątrz sesji.',
        },
        publicPreview: {
            title: 'Publiczne podglądy',
            description: 'Udostępnij podgląd usługi pod publicznym adresem.',
        },
    },
    browser: {
        title: 'Przeglądarka',
        description: 'Otwieraj strony, podglądy i hostowane widoki w Happier.',
        group: 'Przeglądarka',
        viewTargets: {
            title: 'Widoki przeglądarki',
            description: 'Otwiera podglądy, strony wtyczek i linki we właściwym widoku.',
        },
        internal: {
            title: 'Wbudowana przeglądarka',
            description: 'Przeglądaj w Happier z własnymi sesjami i profilami.',
        },
        sidecar: {
            title: 'Przeglądarka pomocnicza',
            description: 'Osobna zarządzana przeglądarka do intensywnej automatyzacji.',
        },
        diagnostics: {
            title: 'Narzędzia deweloperskie',
            description: 'Konsola, sieć i zdarzenia devtools wbudowanej przeglądarki.',
        },
        context: {
            title: 'Kontekst przeglądarki',
            description: 'Dołącz zawartość strony do wiadomości lub agenta.',
        },
        automation: {
            title: 'Automatyzacja przeglądarki',
            description: 'Agenci klikają, piszą i nawigują we wbudowanej przeglądarce.',
        },
        recording: {
            title: 'Nagrania przeglądarki',
            description: 'Nagrywa sesje przeglądarki jako dowód.',
        },
    },
    plugins: {
        title: 'Wtyczki spoza Happier',
        description: 'Instaluj wtyczki z npm i własnych źródeł.',
        group: 'Wtyczki',
        webhooks: {
            title: 'Webhooki wtyczek',
            description: 'Wtyczki odbierają webhooki z zewnętrznych usług.',
        },
        ui: {
            title: 'Ekrany wtyczek',
            description: 'Pokazuje ekrany i panele udostępniane przez wtyczki.',
            hostedWeb: {
                title: 'Webowe ekrany wtyczek',
                description: 'Pokazuje ekrany wtyczek zbudowane dla sieci.',
            },
            reactNativeBundles: {
                title: 'Natywne ekrany wtyczek',
                description: 'Uruchamia zaufane ekrany wtyczek zbudowane w React Native.',
            },
        },
    },
    devices: {
        title: 'Urządzenia',
        description: 'Symulatory i podłączone urządzenia.',
        simulatorPreview: {
            title: 'Podgląd symulatorów',
            description: 'Pokazuje symulatory i emulatory z twoich maszyn.',
        },
    },
    social: {
        friends: {
            title: 'Znajomi',
            description: 'Dodawaj znajomych i zobacz, co udostępniają.',
        },
    },
    auth: {
        group: 'Logowanie',
        recovery: {
            providerReset: {
                title: 'Reset przez dostawcę',
                description: 'Odzyskaj konto, logując się przez jego dostawcę tożsamości.',
            },
        },
        login: {
            keyChallenge: {
                title: 'Logowanie kluczem',
                description: 'Zaloguj się, potwierdzając klucz urządzenia.',
            },
        },
        mtls: {
            title: 'Certyfikaty klienta',
            description: 'Zaloguj się certyfikatem klienta (mTLS).',
        },
        ui: {
            recoveryKeyReminder: {
                title: 'Przypomnienie o kluczu odzyskiwania',
                description: 'Przypomina o zapisaniu klucza odzyskiwania.',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'Logowanie przez skanowanie',
                description: 'Zaloguj się na telefonie, skanując kod na komputerze.',
            },
            boundQrV2: {
                title: 'Bezpieczniejsze kody parowania',
                description: 'Kody parowania działające tylko dla tego Home i tego kierunku.',
            },
        },
    },
    encryption: {
        group: 'Szyfrowanie',
        plaintextStorage: {
            title: 'Przechowywanie bez szyfrowania',
            description: 'Przechowuje sesje bez szyfrowania end-to-end.',
        },
        accountOptOut: {
            title: 'Rezygnacja z szyfrowania',
            description: 'Każda osoba może wyłączyć szyfrowanie end-to-end.',
        },
    },
    remoteHosts: {
        group: 'Hosty zdalne',
        management: {
            title: 'Hosty zdalne',
            description: 'Zapisuj hosty SSH, na których działają sesje.',
        },
        secretMaterial: {
            title: 'Zapisane sekrety hostów',
            description: 'Zapisuj hasła i klucze hostów SSH.',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: 'Konta bez kluczy',
            description: 'Konta bez kluczy szyfrowania end-to-end.',
        },
    },
    bugReports: {
        title: 'Zgłoszenia błędów',
        description: 'Wysyłaj zgłoszenia błędów z danymi diagnostycznymi.',
    },
    terminal: {
        group: 'Terminal',
        embeddedPty: {
            title: 'Terminal',
            description: 'Otwórz terminal na maszynie w Happier.',
        },
        transport: {
            byteStream: {
                title: 'Terminal strumieniowy',
                description: 'Szybsze połączenie dla wbudowanego terminala.',
            },
        },
    },
    search: {
        title: 'Wyszukiwanie',
        description: 'Przeszukuj sesje i transkrypcje.',
    },
    providers: {
        title: 'Dostawcy modeli',
        description: 'Łącz dostawców modeli i wybieraj modele dla agentów.',
        group: 'Dostawcy modeli',
        localDiscovery: {
            title: 'Wyszukiwanie lokalnych dostawców',
            description: 'Znajduje serwery modeli działające na twoich maszynach.',
        },
        localModelManagement: {
            title: 'Zarządzanie modelami lokalnymi',
            description: 'Pobieraj modele lokalne i zarządzaj nimi.',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'Adres usługi zgłoszeń',
            description: 'Dokąd trafiają zgłoszenia błędów. Gdy pole jest puste, usługa zgłoszeń nie jest oferowana.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: 'Domyślnie dołączaj diagnostykę',
            description: 'Formularz zgłoszenia zawiera dane diagnostyczne, chyba że zgłaszający z nich zrezygnuje.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: 'Największy załącznik',
            description: 'Największy plik, jaki może dołączyć zgłoszenie błędu, w bajtach.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'Limit czasu przesyłania',
            description: 'Jak długo może trwać przesyłanie zgłoszenia błędu, w milisekundach.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: 'Akceptowane rodzaje załączników',
            description: 'Rodzaje załączników akceptowane w zgłoszeniach błędów. Puste oznacza zwykłe rodzaje.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'Okno kontekstu',
            description: 'Jak daleko wstecz zgłoszenie błędu zbiera kontekst, w milisekundach.',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: 'Głos wymaga subskrypcji',
            description: 'Tylko subskrybenci mogą używać głosu. Gdy nie ustawiono, wymaga tego produkcja, a inne konfiguracje nie.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'Największy manifest zwierzaka',
            description: 'Największy akceptowany manifest zwierzaka, w bajtach.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'Największy spritesheet zwierzaka',
            description: 'Największy akceptowany spritesheet zwierzaka, w bajtach.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'Największy pakiet zwierzaka',
            description: 'Największy akceptowany pakiet zwierzaka, w bajtach.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: 'Zaimportowane zwierzaki na osobę',
            description: 'Maksymalna liczba zaimportowanych zwierzaków, jaką może mieć jedna osoba.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: 'Miejsce na zaimportowane zwierzaki na osobę',
            description: 'Maksymalna liczba bajtów zaimportowanych zwierzaków, jaką może mieć jedna osoba.',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: 'Szyfrowane własne zwierzaki',
            description: 'Zarezerwowane na później. Szyfrowane własne zwierzaki nie są jeszcze synchronizowane, więc ta opcja pozostaje wyłączona.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'Największy transfer przez ten Home',
            description: 'Największy plik, jaki przenosi transfer przez ten Home, w bajtach.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: 'Równoczesne transfery na połączenie',
            description: 'Maksymalna liczba transferów przez ten Home, które jedno połączenie prowadzi jednocześnie.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'Dane na tunel',
            description: 'Maksymalna liczba bajtów, jaką przenosi jeden tunel przez ten Home.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: 'Tunele na połączenie',
            description: 'Maksymalna liczba tuneli przez ten Home, które jedno połączenie utrzymuje otwarte.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Największa ramka tunelu',
            description: 'Największa ramka, jaką przenosi tunel przez ten Home, w bajtach.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'Kodowania tunelu',
            description: 'Kodowania ramek akceptowane przez tunele przez ten Home. Puste oznacza standardowe.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: 'Preferowane kodowanie tunelu',
            description: 'Kodowanie ramek używane w pierwszej kolejności. Musi być jednym z akceptowanych kodowań.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'Największy nagłówek ramki',
            description: 'Największy binarny nagłówek ramki, w bajtach.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'Największy ładunek ramki',
            description: 'Największy surowy ładunek w jednej ramce, w bajtach.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'Największa wiadomość w ramkach',
            description: 'Największa wiadomość podzielona na ramki, w bajtach.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'Równoczesne strumienie na tunel',
            description: 'Maksymalna liczba strumieni, które jeden tunel prowadzi jednocześnie.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'Strumienie na tunel',
            description: 'Maksymalna liczba strumieni, które jeden tunel otwiera przez cały czas działania.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'Dane na strumień',
            description: 'Maksymalna liczba bajtów, jaką przenosi jeden strumień.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'Dane na tunel, wszystkie strumienie',
            description: 'Maksymalna liczba bajtów, jaką przenoszą razem wszystkie strumienie jednego tunelu.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'Limit bezczynności strumienia',
            description: 'Jak długo strumień może być bezczynny, zanim zostanie zamknięty, w milisekundach.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'Limit bezczynności tunelu',
            description: 'Jak długo tunel przez ten Home może być bezczynny, zanim zostanie zamknięty, w milisekundach.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'Limit czasu bezczynności tunelu',
            description: 'Jak długo tunel może być bezczynny, zanim zostanie zamknięty, w milisekundach.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'Najdłuższy tunel',
            description: 'Najdłuższy czas, przez jaki tunel pozostaje otwarty, w milisekundach.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'Porty dostępne dla tuneli',
            description: 'Porty, które mogą otwierać tunele. Puste pozwala tylko na domyślne.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'Ważność linku podglądu',
            description: 'Jak długo działa prywatny link podglądu, w milisekundach.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'Domena podglądów',
            description: 'Domena, która serwuje każdy podgląd pod własnym adresem. Puste serwuje podglądy pod adresem tego Home.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: 'Tryby publicznego podglądu',
            description: 'Sposoby upublicznienia podglądu.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: 'Najdłuższy publiczny podgląd',
            description: 'Najdłuższy czas, przez jaki podgląd pozostaje publiczny, w milisekundach. Puste zachowuje standardowy limit.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: 'Równoczesne publiczne podglądy',
            description: 'Maksymalna liczba publicznych podglądów jednocześnie. Puste zachowuje standardowy limit.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'Wymagaj DNS i TLS',
            description: 'Publiczne podglądy wymagają DNS i TLS.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: 'Dziennik audytu publicznych podglądów',
            description: 'Gdzie rejestrowane są publiczne podglądy. Publiczne podglądy go wymagają.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: 'Plik dziennika audytu',
            description: 'Plik, do którego zapisywany jest dziennik audytu publicznych podglądów.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'Zezwalaj na testowy dziennik audytu',
            description: 'Tylko do programowania: akceptuje testowy dziennik audytu w pamięci. Ignorowane w produkcji.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: 'Limity żądań publicznych podglądów',
            description: 'Profile limitów żądań, których mogą używać publiczne podglądy.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'Kontroler limitu żądań',
            description: 'Jak ograniczane są żądania do publicznych podglądów. Publiczne podglądy go wymagają.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'Żądania na okno',
            description: 'Liczba żądań, na jaką publiczny podgląd pozwala w każdym oknie.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'Okno limitu żądań',
            description: 'Długość każdego okna limitu żądań, w milisekundach.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'Zezwalaj na testowy limiter żądań',
            description: 'Tylko do programowania: akceptuje testowy limiter żądań w pamięci. Ignorowane w produkcji.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: 'Webhooki w toku',
            description: 'Maksymalna liczba żądań webhooków, które ten serwer obsługuje jednocześnie.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Pamięć webhooków',
            description: 'Maksymalna ilość pamięci, jakiej mogą używać żądania webhooków w toku, w bajtach. Puste pozwala na tyle, ile już dopuszcza limit żądań.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'Webhooki na minutę na trasę',
            description: 'Żądania webhooków na minutę na jednej trasie.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'Równoczesne webhooki na trasę',
            description: 'Żądania webhooków w toku na jednej trasie.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'Webhooki na minutę na endpoint',
            description: 'Żądania webhooków na minutę na jednym endpoincie.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'Równoczesne webhooki na endpoint',
            description: 'Żądania webhooków w toku na jednym endpoincie.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: 'Webhooki na minutę na osobę',
            description: 'Żądania webhooków na minutę dla jednej osoby.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: 'Równoczesne webhooki na osobę',
            description: 'Żądania webhooków w toku dla jednej osoby.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'Największy pakiet ekranu wtyczki',
            description: 'Największy pakiet ekranu wtyczki, jaki hostuje ten Home, w bajtach.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: 'Miejsce na ekrany wtyczek na osobę',
            description: 'Maksymalna liczba bajtów pakietów ekranów wtyczek, jaką może przechowywać jedna osoba.',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'Największy wiersz danych wtyczki',
            description: 'Największy wiersz, jaki zapisuje wtyczka, w bajtach.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'Największa partia danych wtyczek',
            description: 'Największa partia zmian danych wtyczek, w bajtach.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'Wiersze na partię danych wtyczek',
            description: 'Maksymalna liczba wierszy w jednej partii zmian danych wtyczek.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: 'Wiersze danych wtyczek na osobę',
            description: 'Maksymalna liczba wierszy danych wtyczek, jaką może przechowywać jedna osoba.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: 'Miejsce na dane wtyczek na osobę',
            description: 'Maksymalna liczba bajtów danych wtyczek, jaką może przechowywać jedna osoba.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: 'Najwyższy bitrate transmisji',
            description: 'Najwyższy bitrate transmisji na żywo przez ten Home, w bitach na sekundę.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: 'Najwyższa liczba klatek transmisji',
            description: 'Najwyższa liczba klatek na sekundę transmisji na żywo przez ten Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Największa klatka transmisji',
            description: 'Największa klatka transmisji na żywo przez ten Home, w bajtach.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'Najdłuższa transmisja na żywo',
            description: 'Najdłuższy czas trwania transmisji na żywo przez ten Home, w milisekundach.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'Dane na transmisję na żywo',
            description: 'Maksymalna liczba bajtów, jaką przenosi jedna transmisja na żywo przez ten Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: 'Równoczesne transmisje na osobę',
            description: 'Maksymalna liczba transmisji na żywo przez ten Home, które jedna osoba prowadzi jednocześnie.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: 'Równoczesne transmisje na połączenie',
            description: 'Maksymalna liczba transmisji na żywo przez ten Home, które jedno połączenie prowadzi jednocześnie.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'Równoczesne transmisje na maszynę',
            description: 'Maksymalna liczba transmisji na żywo przez ten Home, które jedna maszyna prowadzi jednocześnie.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: 'ID klucza podpisującego połączenia',
            description: 'Wskazuje klucz, który podpisuje połączenia między maszynami. Bez klucza podpisującego te połączenia są wyłączone.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: 'Prywatny klucz podpisujący połączenia',
            description: 'Klucz prywatny, który podpisuje połączenia między maszynami.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: 'Publiczny klucz podpisujący połączenia',
            description: 'Klucz publiczny pasujący do klucza podpisującego. Gdy jest pusty, jest wyliczany z klucza prywatnego.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: 'Wygaśnięcie klucza podpisującego',
            description: 'Kiedy wygasa klucz podpisujący, jako znacznik czasu w milisekundach.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'Wyszukiwanie znajomych po nazwie użytkownika',
            description: 'Można znajdować znajomych po nazwie użytkownika, a nie tylko po połączonym koncie.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: 'Dostawca dopasowywania znajomych',
            description: 'Dostawca logowania używany do dopasowywania znajomych.',
        },
    },
};

const ru: typeof en = {
    teams: {
        title: 'Команды',
        description: 'Группы с общими сессиями, машинами и доступом.',
        credentialResources: {
            title: 'Учётные данные команды',
            description: 'Учётные данные, которыми команда делится со своими сессиями.',
            externalApi: {
                title: 'API учётных данных команды',
                description: 'Внешние инструменты используют учётные данные команды через API.',
            },
        },
    },
    automations: {
        title: 'Автоматизации',
        description: 'Работа агентов по расписанию и по событиям.',
    },
    workflows: {
        title: 'Рабочие процессы',
        description: 'Многошаговые конвейеры агентов.',
    },
    pets: {
        sync: {
            title: 'Синхронизация питомцев',
            description: 'Питомцы каждого человека доступны на всех его устройствах.',
        },
    },
    voice: {
        title: 'Голос',
        description: 'Говорите со своими агентами.',
        happierVoice: {
            title: 'Голос Happier',
            description: 'Голос через голосовой сервис этого Home.',
        },
    },
    connectedServices: {
        group: 'Подключённые сервисы',
        quotas: {
            title: 'Индикаторы квот',
            description: 'Показывает, сколько квоты осталось у каждого подключённого аккаунта.',
        },
        subscription: {
            title: 'Статус подписки',
            description: 'Показывает тариф и статус каждого подключённого аккаунта.',
        },
        accountGroups: {
            title: 'Группы аккаунтов',
            description: 'Объединяйте подключённые аккаунты в пулы.',
        },
        accountFallback: {
            title: 'Резервный аккаунт',
            description: 'Переключается на следующий аккаунт пула, когда один исчерпан.',
        },
        autoQuotaReset: {
            title: 'Автосброс квоты',
            description: 'Использует накопленные сбросы квоты, когда все аккаунты пула исчерпаны.',
        },
        autoDisablePlanInvalid: {
            title: 'Пропуск непригодных аккаунтов',
            description: 'Отключает аккаунты пула, которые не могут использовать выбранную модель.',
        },
        poolQuotaLimitSelection: {
            title: 'Лимиты квот пула',
            description: 'Выберите, какой квоте провайдера следует каждый пул.',
        },
    },
    updates: {
        ota: {
            title: 'Обновления по воздуху',
            description: 'Приложения ставят обновления без выпуска в магазине.',
        },
    },
    attachments: {
        uploads: {
            title: 'Вложения',
            description: 'Отправляйте файлы и изображения агентам в сессии.',
        },
    },
    sharing: {
        group: 'Общий доступ',
        session: {
            title: 'Общий доступ к сессиям',
            description: 'Поделитесь сессией с кем-то на этом Home.',
        },
        public: {
            title: 'Публичные ссылки',
            description: 'Делитесь содержимым сессии по публичной ссылке.',
        },
        contentKeys: {
            title: 'Зашифрованный общий доступ',
            description: 'Обмен ключами, чтобы общие сессии оставались со сквозным шифрованием.',
        },
        pendingQueueV2: {
            title: 'Общая очередь сообщений',
            description: 'Ставит сообщения общей сессии в очередь, пока её агент занят.',
        },
        pendingDeliveryState: {
            title: 'Отслеживание доставки очереди',
            description: 'Запоминает, какие сообщения из очереди дошли до агента.',
        },
    },
    sessions: {
        title: 'Сессии',
        description: 'Сессии и управление ими.',
        group: 'Сессии',
        handoff: {
            title: 'Передача сессии',
            description: 'Перенесите идущую сессию на другую машину.',
        },
        ephemeralRunner: {
            title: 'Временные раннеры',
            description: 'Запустите сессию на одноразовой машине.',
        },
        agentSwitching: {
            title: 'Смена агента',
            description: 'Продолжите сессию с другим агентом-программистом.',
        },
        folders: {
            title: 'Папки сессий',
            description: 'Раскладывайте сессии по папкам.',
        },
        drafts: {
            title: 'Синхронизированные черновики',
            description: 'Неотправленные сообщения и черновики сессий на каждом устройстве.',
        },
        following: {
            title: 'Подписка',
            description: 'Подпишитесь на сессию, чтобы получать её обновления и уведомления.',
        },
        conversations: {
            title: 'Беседы',
            description: 'Люди общаются и упоминают друг друга в общей сессии.',
        },
        board: {
            title: 'Доска сессий',
            description: 'Располагайте сессии и их элементы на общих досках.',
        },
        filteredListing: {
            title: 'Фильтрованный список',
            description: 'Фильтрует список сессий на этом Home до постраничной загрузки.',
        },
        usageLimitRecovery: {
            title: 'Восстановление после лимита',
            description: 'Подождать и продолжить или повторить, когда агент упирается в лимит использования.',
        },
    },
    machines: {
        title: 'Машины',
        description: 'Подключение к вашим машинам.',
        group: 'Машины',
        pools: {
            title: 'Пулы машин',
            description: 'Переключается на следующую машину, когда одна не в сети.',
        },
        transfer: {
            title: 'Передачи между машинами',
            description: 'Передача данных между машинами.',
            directPeer: {
                title: 'Прямые передачи',
                description: 'Передаёт данные напрямую между машинами.',
            },
            serverRouted: {
                title: 'Передачи через этот Home',
                description: 'Передаёт данные через этот Home, когда машины не могут соединиться напрямую.',
            },
        },
        peerMediation: {
            title: 'Соединения между машинами',
            description: 'Туннели, потоки и доступ между машинами.',
            observability: {
                title: 'Диагностика соединений',
                description: 'Показывает, как соединены туннели, потоки и превью между машинами.',
            },
        },
        tunnel: {
            title: 'Туннели между машинами',
            description: 'Открытие портов между машинами.',
            directPeer: {
                title: 'Прямые туннели',
                description: 'Открывает порты напрямую между машинами.',
            },
            serverRouted: {
                title: 'Туннели через этот Home',
                description: 'Открывает порты через этот Home, когда машины не могут соединиться напрямую.',
            },
        },
        liveStream: {
            title: 'Трансляции',
            description: 'Трансляция экрана машины.',
            directPeer: {
                title: 'Прямые трансляции',
                description: 'Транслирует экран машины прямо на ваше устройство.',
            },
            serverRouted: {
                title: 'Трансляции через этот Home',
                description: 'Транслирует экран машины через этот Home, если прямая трансляция не удалась.',
            },
        },
        rpc: {
            title: 'Вызовы машин',
            description: 'Прямая связь с машинами.',
            directPeer: {
                title: 'Прямые вызовы машин',
                description: 'Связывается с машиной напрямую, а не через этот Home.',
            },
        },
    },
    localServices: {
        title: 'Локальные сервисы',
        description: 'Смотрите и открывайте сервисы, запущенные на ваших машинах.',
        group: 'Локальные сервисы',
        inventory: {
            title: 'Список сервисов',
            description: 'Показывает порты и сервисы, работающие на каждой машине.',
        },
        managed: {
            title: 'Управляемые сервисы',
            description: 'Запускайте, называйте и отслеживайте сервисы из Happier.',
        },
        launcher: {
            title: 'Запуск сервисов',
            description: 'Предлагает сервисы для открытия и превью.',
        },
        actions: {
            title: 'Действия с сервисами',
            description: 'Копировать, открыть превью и забыть сервисы.',
            terminate: {
                title: 'Остановка сервисов',
                description: 'Останавливает процесс обнаруженного сервиса.',
            },
        },
        preview: {
            title: 'Превью сервисов',
            description: 'Приватное превью локального сервиса внутри сессии.',
        },
        publicPreview: {
            title: 'Публичные превью',
            description: 'Поделитесь превью сервиса по публичному адресу.',
        },
    },
    browser: {
        title: 'Браузер',
        description: 'Открывайте страницы, превью и размещённые представления в Happier.',
        group: 'Браузер',
        viewTargets: {
            title: 'Представления браузера',
            description: 'Открывает превью, страницы плагинов и ссылки в нужном представлении.',
        },
        internal: {
            title: 'Встроенный браузер',
            description: 'Просмотр в Happier с собственными сессиями и профилями.',
        },
        sidecar: {
            title: 'Вспомогательный браузер',
            description: 'Отдельный управляемый браузер для тяжёлой автоматизации.',
        },
        diagnostics: {
            title: 'Инструменты разработчика',
            description: 'Консоль, сеть и события devtools встроенного браузера.',
        },
        context: {
            title: 'Контекст браузера',
            description: 'Прикрепите содержимое страницы к сообщению или агенту.',
        },
        automation: {
            title: 'Автоматизация браузера',
            description: 'Агенты кликают, печатают и переходят по страницам во встроенном браузере.',
        },
        recording: {
            title: 'Записи браузера',
            description: 'Записывает сессии браузера как доказательство.',
        },
    },
    plugins: {
        title: 'Плагины не из Happier',
        description: 'Устанавливайте плагины из npm и собственных источников.',
        group: 'Плагины',
        webhooks: {
            title: 'Вебхуки плагинов',
            description: 'Плагины получают вебхуки от внешних сервисов.',
        },
        ui: {
            title: 'Экраны плагинов',
            description: 'Показывает экраны и панели, которые дают плагины.',
            hostedWeb: {
                title: 'Веб-экраны плагинов',
                description: 'Показывает экраны плагинов, сделанные для веба.',
            },
            reactNativeBundles: {
                title: 'Нативные экраны плагинов',
                description: 'Запускает доверенные экраны плагинов на React Native.',
            },
        },
    },
    devices: {
        title: 'Устройства',
        description: 'Симуляторы и подключённые устройства.',
        simulatorPreview: {
            title: 'Превью симуляторов',
            description: 'Показывает симуляторы и эмуляторы с ваших машин.',
        },
    },
    social: {
        friends: {
            title: 'Друзья',
            description: 'Добавляйте друзей и смотрите, чем они делятся.',
        },
    },
    auth: {
        group: 'Вход',
        recovery: {
            providerReset: {
                title: 'Сброс через провайдера',
                description: 'Восстановите аккаунт, войдя через его провайдера удостоверений.',
            },
        },
        login: {
            keyChallenge: {
                title: 'Вход по ключу',
                description: 'Войдите, подтвердив ключ устройства.',
            },
        },
        mtls: {
            title: 'Клиентские сертификаты',
            description: 'Вход по клиентскому сертификату (mTLS).',
        },
        ui: {
            recoveryKeyReminder: {
                title: 'Напоминание о ключе восстановления',
                description: 'Напоминает сохранить ключ восстановления.',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'Вход по сканированию',
                description: 'Войдите на телефоне, отсканировав код на компьютере.',
            },
            boundQrV2: {
                title: 'Более безопасные коды сопряжения',
                description: 'Коды сопряжения, которые работают только для этого Home и направления.',
            },
        },
    },
    encryption: {
        group: 'Шифрование',
        plaintextStorage: {
            title: 'Хранение без шифрования',
            description: 'Хранит сессии без сквозного шифрования.',
        },
        accountOptOut: {
            title: 'Отказ от шифрования',
            description: 'Каждый может отключить сквозное шифрование.',
        },
    },
    remoteHosts: {
        group: 'Удалённые хосты',
        management: {
            title: 'Удалённые хосты',
            description: 'Сохраняйте SSH-хосты для запуска сессий.',
        },
        secretMaterial: {
            title: 'Сохранённые секреты хостов',
            description: 'Сохраняйте пароли и ключи SSH-хостов.',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: 'Аккаунты без ключей',
            description: 'Аккаунты без ключей сквозного шифрования.',
        },
    },
    bugReports: {
        title: 'Отчёты об ошибках',
        description: 'Отправляйте отчёты об ошибках с диагностикой.',
    },
    terminal: {
        group: 'Терминал',
        embeddedPty: {
            title: 'Терминал',
            description: 'Откройте терминал на машине прямо в Happier.',
        },
        transport: {
            byteStream: {
                title: 'Потоковый терминал',
                description: 'Более быстрое соединение для встроенного терминала.',
            },
        },
    },
    search: {
        title: 'Поиск',
        description: 'Поиск по сессиям и расшифровкам.',
    },
    providers: {
        title: 'Провайдеры моделей',
        description: 'Подключайте провайдеров моделей и выбирайте модели для агентов.',
        group: 'Провайдеры моделей',
        localDiscovery: {
            title: 'Поиск локальных провайдеров',
            description: 'Находит серверы моделей на ваших машинах.',
        },
        localModelManagement: {
            title: 'Управление локальными моделями',
            description: 'Скачивайте локальные модели и управляйте ими.',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'Адрес сервиса отчётов',
            description: 'Куда отправляются отчёты об ошибках. Если поле пустое, сервис отчётов не предлагается.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: 'Диагностика по умолчанию',
            description: 'Форма отчёта включает диагностику, если автор отчёта не откажется.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: 'Самое большое вложение',
            description: 'Самый большой файл, который можно приложить к отчёту об ошибке, в байтах.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'Лимит времени загрузки',
            description: 'Сколько может длиться загрузка отчёта об ошибке, в миллисекундах.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: 'Допустимые типы вложений',
            description: 'Типы вложений, которые принимают отчёты об ошибках. Пустое значение принимает обычные типы.',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'Окно контекста',
            description: 'Насколько далеко в прошлое отчёт об ошибке собирает контекст, в миллисекундах.',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: 'Голос по подписке',
            description: 'Голосом могут пользоваться только подписчики. Если не задано, в продакшене это требуется, а в других конфигурациях нет.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'Самый большой манифест питомца',
            description: 'Самый большой принимаемый манифест питомца, в байтах.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'Самый большой спрайт-лист питомца',
            description: 'Самый большой принимаемый спрайт-лист питомца, в байтах.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'Самый большой пакет питомца',
            description: 'Самый большой принимаемый пакет питомца, в байтах.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: 'Импортированные питомцы на человека',
            description: 'Максимум импортированных питомцев, которых может хранить один человек.',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: 'Хранилище импортированных питомцев на человека',
            description: 'Максимум байтов импортированных питомцев, которые может хранить один человек.',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: 'Зашифрованные собственные питомцы',
            description: 'Зарезервировано на будущее. Зашифрованные собственные питомцы пока не синхронизируются, поэтому параметр остаётся выключенным.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'Самая большая передача через этот Home',
            description: 'Самый большой файл, который передаётся через этот Home, в байтах.',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: 'Одновременные передачи на соединение',
            description: 'Максимум передач через этот Home, которые одно соединение ведёт одновременно.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'Данные на туннель',
            description: 'Максимум байтов, которые передаёт один туннель через этот Home.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: 'Туннели на соединение',
            description: 'Максимум туннелей через этот Home, которые одно соединение держит открытыми.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Самый большой кадр туннеля',
            description: 'Самый большой кадр, который передаёт туннель через этот Home, в байтах.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'Кодировки туннелей',
            description: 'Кодировки кадров, которые принимают туннели через этот Home. Пустое значение использует стандартные.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: 'Предпочтительная кодировка туннеля',
            description: 'Кодировка кадров, используемая в первую очередь. Она должна быть одной из допустимых кодировок.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'Самый большой заголовок кадра',
            description: 'Самый большой двоичный заголовок кадра, в байтах.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'Самая большая полезная нагрузка кадра',
            description: 'Самая большая необработанная полезная нагрузка в одном кадре, в байтах.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'Самое большое сообщение в кадрах',
            description: 'Самое большое сообщение, разбитое на кадры, в байтах.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'Одновременные потоки на туннель',
            description: 'Максимум потоков, которые один туннель ведёт одновременно.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'Потоки на туннель',
            description: 'Максимум потоков, которые один туннель открывает за всё время работы.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'Данные на поток',
            description: 'Максимум байтов, которые передаёт один поток.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'Данные на туннель по всем потокам',
            description: 'Максимум байтов, которые передают вместе все потоки одного туннеля.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'Лимит простоя потока',
            description: 'Сколько поток может простаивать до закрытия, в миллисекундах.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'Лимит простоя туннеля',
            description: 'Сколько туннель через этот Home может простаивать до закрытия, в миллисекундах.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'Лимит бездействия туннеля',
            description: 'Сколько туннель может простаивать до закрытия, в миллисекундах.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'Самый долгий туннель',
            description: 'Максимальное время, в течение которого туннель остаётся открытым, в миллисекундах.',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'Порты, доступные туннелям',
            description: 'Порты, которые могут открывать туннели. Пустое значение разрешает только порты по умолчанию.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'Срок действия ссылки на превью',
            description: 'Сколько работает приватная ссылка на превью, в миллисекундах.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'Домен превью',
            description: 'Домен, который отдаёт каждое превью по собственному адресу. Пустое значение отдаёт превью по адресу этого Home.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: 'Режимы публичного превью',
            description: 'Способы сделать превью публичным.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: 'Самое долгое публичное превью',
            description: 'Максимальное время, в течение которого превью остаётся публичным, в миллисекундах. Пустое значение сохраняет стандартный лимит.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: 'Одновременные публичные превью',
            description: 'Максимум публичных превью одновременно. Пустое значение сохраняет стандартный лимит.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'Требовать DNS и TLS',
            description: 'Публичным превью нужны DNS и TLS.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: 'Журнал аудита публичных превью',
            description: 'Куда записываются публичные превью. Публичным превью он обязателен.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: 'Файл журнала аудита',
            description: 'Файл, в который пишется журнал аудита публичных превью.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'Разрешить тестовый журнал аудита',
            description: 'Только для разработки: принимать тестовый журнал аудита в памяти. В продакшене игнорируется.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: 'Лимиты запросов публичных превью',
            description: 'Профили лимитов запросов, которые могут использовать публичные превью.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'Проверка лимита запросов',
            description: 'Как ограничивается частота запросов к публичным превью. Публичным превью она обязательна.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'Запросы за окно',
            description: 'Сколько запросов публичное превью разрешает в каждом окне.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'Окно лимита запросов',
            description: 'Длительность каждого окна лимита запросов, в миллисекундах.',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'Разрешить тестовый ограничитель запросов',
            description: 'Только для разработки: принимать тестовый ограничитель запросов в памяти. В продакшене игнорируется.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: 'Вебхуки в обработке',
            description: 'Максимум запросов вебхуков, которые этот сервер обрабатывает одновременно.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Память для вебхуков',
            description: 'Максимум памяти для запросов вебхуков в обработке, в байтах. Пустое значение разрешает столько, сколько уже допускает лимит запросов.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'Вебхуки в минуту на маршрут',
            description: 'Запросы вебхуков в минуту на одном маршруте.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'Одновременные вебхуки на маршрут',
            description: 'Запросы вебхуков в обработке на одном маршруте.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'Вебхуки в минуту на эндпоинт',
            description: 'Запросы вебхуков в минуту на одном эндпоинте.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'Одновременные вебхуки на эндпоинт',
            description: 'Запросы вебхуков в обработке на одном эндпоинте.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: 'Вебхуки в минуту на человека',
            description: 'Запросы вебхуков в минуту для одного человека.',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: 'Одновременные вебхуки на человека',
            description: 'Запросы вебхуков в обработке для одного человека.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'Самый большой пакет экрана плагина',
            description: 'Самый большой пакет экрана плагина, который размещает этот Home, в байтах.',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: 'Хранилище экранов плагинов на человека',
            description: 'Максимум байтов пакетов экранов плагинов, которые может хранить один человек.',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'Самая большая строка данных плагина',
            description: 'Самая большая строка, которую сохраняет плагин, в байтах.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'Самая большая партия данных плагинов',
            description: 'Самая большая партия изменений данных плагинов, в байтах.',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'Строки в партии данных плагинов',
            description: 'Максимум строк в одной партии изменений данных плагинов.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: 'Строки данных плагинов на человека',
            description: 'Максимум строк данных плагинов, которые может хранить один человек.',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: 'Хранилище данных плагинов на человека',
            description: 'Максимум байтов данных плагинов, которые может хранить один человек.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: 'Максимальный битрейт трансляции',
            description: 'Максимальный битрейт трансляции через этот Home, в битах в секунду.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: 'Максимальная частота кадров трансляции',
            description: 'Максимальная частота кадров трансляции через этот Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'Самый большой кадр трансляции',
            description: 'Самый большой кадр трансляции через этот Home, в байтах.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'Самая долгая трансляция',
            description: 'Максимальная длительность трансляции через этот Home, в миллисекундах.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'Данные на трансляцию',
            description: 'Максимум байтов, которые передаёт одна трансляция через этот Home.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: 'Одновременные трансляции на человека',
            description: 'Максимум трансляций через этот Home, которые один человек ведёт одновременно.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: 'Одновременные трансляции на соединение',
            description: 'Максимум трансляций через этот Home, которые одно соединение ведёт одновременно.',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'Одновременные трансляции на машину',
            description: 'Максимум трансляций через этот Home, которые одна машина ведёт одновременно.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: 'ID ключа подписи соединений',
            description: 'Указывает ключ, который подписывает соединения между машинами. Без ключа подписи эти соединения выключены.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: 'Закрытый ключ подписи соединений',
            description: 'Закрытый ключ, который подписывает соединения между машинами.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: 'Открытый ключ подписи соединений',
            description: 'Открытый ключ, соответствующий ключу подписи. Если поле пустое, он выводится из закрытого ключа.',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: 'Срок действия ключа подписи',
            description: 'Когда истекает ключ подписи, в виде метки времени в миллисекундах.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'Поиск друзей по имени пользователя',
            description: 'Друзей можно найти по имени пользователя, а не только по привязанному аккаунту.',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: 'Провайдер сопоставления друзей',
            description: 'Провайдер входа, по которому сопоставляются друзья.',
        },
    },
};

const ja: typeof en = {
    teams: {
        title: 'チーム',
        description: 'セッション、マシン、アクセスを共有するグループ。',
        credentialResources: {
            title: 'チームの認証情報',
            description: 'チームがセッションと共有する認証情報。',
            externalApi: {
                title: 'チーム認証情報 API',
                description: '外部ツールが API 経由でチームの認証情報を使います。',
            },
        },
    },
    automations: {
        title: 'オートメーション',
        description: 'スケジュールやトリガーで動くエージェントの作業。',
    },
    workflows: {
        title: 'ワークフロー',
        description: '複数ステップのエージェントパイプライン。',
    },
    pets: {
        sync: {
            title: 'ペットの同期',
            description: '各メンバーのペットをすべてのデバイスに保ちます。',
        },
    },
    voice: {
        title: '音声',
        description: 'エージェントと話せます。',
        happierVoice: {
            title: 'Happier 音声',
            description: 'この Home が提供する音声サービスでの音声。',
        },
    },
    connectedServices: {
        group: '接続サービス',
        quotas: {
            title: 'クォータメーター',
            description: '接続中の各アカウントの残りクォータを表示します。',
        },
        subscription: {
            title: 'サブスクリプションの状態',
            description: '接続中の各アカウントのプランと状態を表示します。',
        },
        accountGroups: {
            title: 'アカウントグループ',
            description: '接続中のアカウントをプールにまとめます。',
        },
        accountFallback: {
            title: 'アカウントのフォールバック',
            description: '1 つを使い切ったらプール内の次のアカウントに切り替えます。',
        },
        autoQuotaReset: {
            title: 'クォータの自動リセット',
            description: 'プールの全アカウントを使い切ったら、蓄えたクォータリセットを使います。',
        },
        autoDisablePlanInvalid: {
            title: '使えないアカウントを除外',
            description: '選択したモデルを使えないプールのアカウントをオフにします。',
        },
        poolQuotaLimitSelection: {
            title: 'プールのクォータ上限',
            description: '各プールが従うプロバイダーのクォータを選びます。',
        },
    },
    updates: {
        ota: {
            title: 'OTA アップデート',
            description: 'ストアを通さずにアプリがアップデートをインストールします。',
        },
    },
    attachments: {
        uploads: {
            title: '添付ファイル',
            description: 'セッション内のエージェントにファイルや画像を送ります。',
        },
    },
    sharing: {
        group: '共有',
        session: {
            title: 'セッションの共有',
            description: 'この Home のメンバーとセッションを共有します。',
        },
        public: {
            title: '公開リンク',
            description: '公開リンクでセッションの内容を共有します。',
        },
        contentKeys: {
            title: '暗号化された共有',
            description: '鍵を交換し、共有セッションをエンドツーエンドで暗号化されたままにします。',
        },
        pendingQueueV2: {
            title: '共有メッセージキュー',
            description: 'エージェントが作業中の間、共有セッションのメッセージをキューに入れます。',
        },
        pendingDeliveryState: {
            title: 'キューの配信追跡',
            description: 'キューのどのメッセージがエージェントに届いたかを記録します。',
        },
    },
    sessions: {
        title: 'セッション',
        description: 'セッションとその操作。',
        group: 'セッション',
        handoff: {
            title: 'セッションの引き継ぎ',
            description: '実行中のセッションを別のマシンに移します。',
        },
        ephemeralRunner: {
            title: '使い捨てランナー',
            description: '使い捨てのマシンでセッションを開始します。',
        },
        agentSwitching: {
            title: 'エージェントの切り替え',
            description: '別のコーディングエージェントでセッションを続けます。',
        },
        folders: {
            title: 'セッションフォルダー',
            description: 'セッションをフォルダーで整理します。',
        },
        drafts: {
            title: '下書きの同期',
            description: '未送信のメッセージや新しいセッションの下書きをすべてのデバイスに保ちます。',
        },
        following: {
            title: 'フォロー',
            description: 'セッションをフォローして更新や通知を受け取ります。',
        },
        conversations: {
            title: '会話',
            description: '共有セッションの中でメンバーが話し、互いにメンションします。',
        },
        board: {
            title: 'セッションボード',
            description: 'セッションとその項目を共有ボードに並べます。',
        },
        filteredListing: {
            title: 'フィルター付き一覧',
            description: 'この Home でページ分割の前にセッション一覧を絞り込みます。',
        },
        usageLimitRecovery: {
            title: '使用量上限からの復帰',
            description: 'エージェントが使用量上限に達したら、待って再開するか再試行します。',
        },
    },
    machines: {
        title: 'マシン',
        description: 'マシンへの接続。',
        group: 'マシン',
        pools: {
            title: 'マシンプール',
            description: 'マシンがオフラインのときは次のマシンに切り替えます。',
        },
        transfer: {
            title: 'マシン間転送',
            description: 'マシン間のデータ転送。',
            directPeer: {
                title: '直接転送',
                description: 'マシン間で直接データを転送します。',
            },
            serverRouted: {
                title: 'この Home 経由の転送',
                description: 'マシン同士が直接つながらないとき、この Home 経由でデータを転送します。',
            },
        },
        peerMediation: {
            title: 'マシン間の接続',
            description: 'マシン間のトンネル、ストリーム、アクセス。',
            observability: {
                title: '接続の診断',
                description: 'マシン間のトンネル、ストリーム、プレビューのつながり方を表示します。',
            },
        },
        tunnel: {
            title: 'マシン間トンネル',
            description: 'マシン間でポートを開くこと。',
            directPeer: {
                title: '直接トンネル',
                description: 'マシン間で直接ポートを開きます。',
            },
            serverRouted: {
                title: 'この Home 経由のトンネル',
                description: 'マシン同士が直接つながらないとき、この Home 経由でポートを開きます。',
            },
        },
        liveStream: {
            title: 'ライブ配信',
            description: 'マシンの画面の配信。',
            directPeer: {
                title: '直接ライブ配信',
                description: 'マシンの画面をデバイスに直接配信します。',
            },
            serverRouted: {
                title: 'この Home 経由のライブ配信',
                description: '直接配信に失敗したとき、この Home 経由でマシンの画面を配信します。',
            },
        },
        rpc: {
            title: 'マシンの呼び出し',
            description: 'マシンへの直接接続。',
            directPeer: {
                title: 'マシンへの直接呼び出し',
                description: 'この Home を経由せず、マシンに直接接続します。',
            },
        },
    },
    localServices: {
        title: 'ローカルサービス',
        description: 'マシンで動いているサービスを表示して開きます。',
        group: 'ローカルサービス',
        inventory: {
            title: 'サービス一覧',
            description: '各マシンで動いているポートとサービスを一覧表示します。',
        },
        managed: {
            title: '管理対象サービス',
            description: 'Happier からサービスを起動、命名、監視します。',
        },
        launcher: {
            title: 'サービスランチャー',
            description: '開いたりプレビューしたりするサービスを提案します。',
        },
        actions: {
            title: 'サービス操作',
            description: 'サービスのコピー、プレビュー、削除。',
            terminate: {
                title: 'サービスの停止',
                description: '検出したサービスのプロセスを停止します。',
            },
        },
        preview: {
            title: 'サービスのプレビュー',
            description: 'セッション内でローカルサービスを非公開でプレビューします。',
        },
        publicPreview: {
            title: '公開プレビュー',
            description: 'サービスのプレビューを公開アドレスで共有します。',
        },
    },
    browser: {
        title: 'ブラウザー',
        description: 'Happier の中でページ、プレビュー、ホストされたビューを開きます。',
        group: 'ブラウザー',
        viewTargets: {
            title: 'ブラウザービュー',
            description: 'プレビュー、プラグインのページ、リンクを適切なビューで開きます。',
        },
        internal: {
            title: '内蔵ブラウザー',
            description: '独自のセッションとプロファイルで Happier の中を閲覧します。',
        },
        sidecar: {
            title: 'サイドカーブラウザー',
            description: '重い自動化のための別の管理ブラウザー。',
        },
        diagnostics: {
            title: 'ブラウザーの開発ツール',
            description: '内蔵ブラウザーのコンソール、ネットワーク、devtools イベント。',
        },
        context: {
            title: 'ブラウザーのコンテキスト',
            description: 'ページの内容をメッセージやエージェントに添付します。',
        },
        automation: {
            title: 'ブラウザーの自動化',
            description: 'エージェントが内蔵ブラウザーでクリック、入力、移動します。',
        },
        recording: {
            title: 'ブラウザーの録画',
            description: 'ブラウザーのセッションを証跡として録画します。',
        },
    },
    plugins: {
        title: 'Happier 外部のプラグイン',
        description: 'npm や独自のソースからプラグインをインストールします。',
        group: 'プラグイン',
        webhooks: {
            title: 'プラグインの Webhook',
            description: 'プラグインが外部サービスから Webhook を受け取ります。',
        },
        ui: {
            title: 'プラグインの画面',
            description: 'プラグインが提供する画面とパネルを表示します。',
            hostedWeb: {
                title: 'Web プラグインの画面',
                description: 'Web 向けに作られたプラグインの画面を表示します。',
            },
            reactNativeBundles: {
                title: 'ネイティブプラグインの画面',
                description: 'React Native で作られた信頼済みプラグインの画面を実行します。',
            },
        },
    },
    devices: {
        title: 'デバイス',
        description: 'シミュレーターと接続中のデバイス。',
        simulatorPreview: {
            title: 'シミュレーターのプレビュー',
            description: 'マシン上のシミュレーターやエミュレーターを表示します。',
        },
    },
    social: {
        friends: {
            title: '友達',
            description: '友達を追加して、共有しているものを見られます。',
        },
    },
    auth: {
        group: 'サインイン',
        recovery: {
            providerReset: {
                title: 'プロバイダーでのリセット',
                description: 'ID プロバイダーでサインインしてアカウントを復旧します。',
            },
        },
        login: {
            keyChallenge: {
                title: '鍵でのサインイン',
                description: 'デバイスの鍵を証明してサインインします。',
            },
        },
        mtls: {
            title: 'クライアント証明書',
            description: 'クライアント証明書 (mTLS) でサインインします。',
        },
        ui: {
            recoveryKeyReminder: {
                title: '復旧キーのリマインダー',
                description: '復旧キーを保存するよう促します。',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: 'スキャンでサインイン',
                description: 'パソコンのコードをスキャンしてスマートフォンでサインインします。',
            },
            boundQrV2: {
                title: 'より安全なペアリングコード',
                description: 'この Home とこの方向でのみ有効なペアリングコード。',
            },
        },
    },
    encryption: {
        group: '暗号化',
        plaintextStorage: {
            title: '暗号化なしの保存',
            description: 'エンドツーエンド暗号化なしでセッションを保存します。',
        },
        accountOptOut: {
            title: '暗号化の無効化',
            description: '各メンバーがエンドツーエンド暗号化をオフにできます。',
        },
    },
    remoteHosts: {
        group: 'リモートホスト',
        management: {
            title: 'リモートホスト',
            description: 'セッションを実行する SSH ホストを保存します。',
        },
        secretMaterial: {
            title: '保存したホストのシークレット',
            description: 'SSH ホストのパスワードと鍵を保存します。',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: '鍵のないアカウント',
            description: 'エンドツーエンド暗号化の鍵を持たないアカウント。',
        },
    },
    bugReports: {
        title: 'バグレポート',
        description: '診断情報付きでバグレポートを送ります。',
    },
    terminal: {
        group: 'ターミナル',
        embeddedPty: {
            title: 'ターミナル',
            description: 'Happier の中でマシンのターミナルを開きます。',
        },
        transport: {
            byteStream: {
                title: 'ストリーミングターミナル',
                description: '内蔵ターミナル向けのより高速な接続。',
            },
        },
    },
    search: {
        title: '検索',
        description: 'セッションとトランスクリプトを検索します。',
    },
    providers: {
        title: 'モデルプロバイダー',
        description: 'モデルプロバイダーを接続し、エージェントのモデルを選びます。',
        group: 'モデルプロバイダー',
        localDiscovery: {
            title: 'ローカルプロバイダーの検出',
            description: 'マシンで動いているモデルサーバーを見つけます。',
        },
        localModelManagement: {
            title: 'ローカルモデルの管理',
            description: 'ローカルモデルをダウンロードして管理します。',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: 'レポートサービスのアドレス',
            description: 'バグレポートの送信先。空欄の場合、レポートサービスは提供されません。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: '既定で診断情報を含める',
            description: '報告者がオプトアウトしない限り、レポートフォームに診断情報を含めます。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: '最大添付ファイルサイズ',
            description: 'バグレポートに添付できるファイルの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: 'アップロードの制限時間',
            description: 'バグレポートのアップロードにかけられる時間（ミリ秒単位）。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: '受け付ける添付ファイルの種類',
            description: 'バグレポートが受け付ける添付ファイルの種類。空欄の場合は通常の種類を受け付けます。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: 'コンテキストの収集期間',
            description: 'バグレポートがコンテキストをさかのぼって収集する期間（ミリ秒単位）。',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: '音声にはサブスクリプションが必要',
            description: 'サブスクライバーだけが音声を使えます。未設定の場合、本番環境では必須、それ以外の環境では不要です。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: 'ペットマニフェストの最大サイズ',
            description: '受け付けるペットマニフェストの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: 'ペットスプライトシートの最大サイズ',
            description: '受け付けるペットスプライトシートの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: 'ペットパッケージの最大サイズ',
            description: '受け付けるペットパッケージの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: '1 人あたりのインポートしたペット数',
            description: '1 人が保持できるインポートしたペットの最大数。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: '1 人あたりのインポートしたペットの容量',
            description: '1 人が保持できるインポートしたペットの最大バイト数。',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: '暗号化されたカスタムペット',
            description: '将来のために予約されています。暗号化されたカスタムペットはまだ同期されないため、オフのままです。',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: 'この Home 経由の最大転送サイズ',
            description: 'この Home 経由の転送で運べるファイルの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: '接続ごとの同時転送数',
            description: '1 つの接続がこの Home 経由で同時に実行できる転送の最大数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: 'トンネルあたりのデータ量',
            description: 'この Home 経由の 1 つのトンネルが運べる最大バイト数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: '接続ごとのトンネル数',
            description: '1 つの接続がこの Home 経由で同時に開いておけるトンネルの最大数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: 'トンネルフレームの最大サイズ',
            description: 'この Home 経由のトンネルが運べるフレームの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: 'トンネルのエンコーディング',
            description: 'この Home 経由のトンネルが受け付けるフレームエンコーディング。空欄の場合は標準のものを使います。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: '優先するトンネルエンコーディング',
            description: '最初に使うフレームエンコーディング。受け付けるエンコーディングのいずれかである必要があります。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: 'フレームヘッダーの最大サイズ',
            description: 'バイナリフレームヘッダーの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: 'フレームペイロードの最大サイズ',
            description: '1 フレーム内の生ペイロードの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: 'フレーム化メッセージの最大サイズ',
            description: 'フレーム化されたメッセージの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: 'トンネルごとの同時ストリーム数',
            description: '1 つのトンネルが同時に実行できるストリームの最大数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: 'トンネルごとのストリーム数',
            description: '1 つのトンネルが存続期間中に開けるストリームの最大数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: 'ストリームあたりのデータ量',
            description: '1 つのストリームが運べる最大バイト数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: 'トンネルの全ストリームのデータ量',
            description: '1 つのトンネルの全ストリームが合計で運べる最大バイト数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: 'アイドルストリームの制限時間',
            description: 'ストリームが閉じるまでにアイドル状態でいられる時間（ミリ秒単位）。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: 'アイドルトンネルの制限時間',
            description: 'この Home 経由のトンネルが閉じるまでにアイドル状態でいられる時間（ミリ秒単位）。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: 'トンネルのアイドル制限時間',
            description: 'トンネルが閉じるまでにアイドル状態でいられる時間（ミリ秒単位）。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: 'トンネルの最長時間',
            description: 'トンネルが開いていられる最長時間（ミリ秒単位）。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: 'トンネルで到達できるポート',
            description: 'トンネルが開けるポート。空欄の場合は既定のポートのみ許可します。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: 'プレビューリンクの有効期間',
            description: '非公開プレビューリンクが使える期間（ミリ秒単位）。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: 'プレビューのドメイン',
            description: '各プレビューを個別のアドレスで提供するドメイン。空欄の場合は、この Home のアドレス配下でプレビューを提供します。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: '公開プレビューのモード',
            description: 'プレビューを公開する方法。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: '公開プレビューの最長時間',
            description: 'プレビューを公開しておける最長時間（ミリ秒単位）。空欄の場合は標準の上限を使います。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: '同時公開プレビュー数',
            description: '同時に公開できるプレビューの最大数。空欄の場合は標準の上限を使います。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: 'DNS と TLS を必須にする',
            description: '公開プレビューには DNS と TLS が必要です。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: '公開プレビューの監査ログ',
            description: '公開プレビューの記録先。公開プレビューには必須です。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: '監査ログファイル',
            description: '公開プレビューの監査ログを書き込むファイル。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: 'テスト用監査ログを許可',
            description: '開発専用です。メモリ内のテスト用監査ログを受け付けます。本番環境では無視されます。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: '公開プレビューのレート制限',
            description: '公開プレビューが使えるレート制限プロファイル。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: 'レート制限チェッカー',
            description: '公開プレビューへのリクエストをレート制限する方法。公開プレビューには必須です。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: 'ウィンドウあたりのリクエスト数',
            description: '公開プレビューが各ウィンドウで許可するリクエスト数。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: 'レート制限ウィンドウ',
            description: '各レート制限ウィンドウの長さ（ミリ秒単位）。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: 'テスト用レートリミッターを許可',
            description: '開発専用です。メモリ内のテスト用レートリミッターを受け付けます。本番環境では無視されます。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: '処理中の Webhook',
            description: 'このサーバーが同時に処理する Webhook リクエストの最大数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Webhook のメモリ',
            description: '処理中の Webhook リクエストが使えるメモリの最大量（バイト単位）。空欄の場合は、リクエスト数の上限で許される分まで使えます。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: 'ルートごとの毎分の Webhook 数',
            description: '1 つのルートでの 1 分あたりの Webhook リクエスト数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: 'ルートごとの同時 Webhook 数',
            description: '1 つのルートで処理中の Webhook リクエスト数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: 'エンドポイントごとの毎分の Webhook 数',
            description: '1 つのエンドポイントでの 1 分あたりの Webhook リクエスト数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: 'エンドポイントごとの同時 Webhook 数',
            description: '1 つのエンドポイントで処理中の Webhook リクエスト数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: '1 人あたりの毎分の Webhook 数',
            description: '1 人あたりの 1 分間の Webhook リクエスト数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: '1 人あたりの同時 Webhook 数',
            description: '1 人あたりの処理中の Webhook リクエスト数。',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: 'プラグイン画面バンドルの最大サイズ',
            description: 'この Home がホストするプラグイン画面バンドルの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: '1 人あたりのプラグイン画面の容量',
            description: '1 人が保存できるプラグイン画面バンドルの最大バイト数。',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: 'プラグインデータ行の最大サイズ',
            description: 'プラグインが保存する行の最大サイズ（バイト単位）。',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: 'プラグインデータバッチの最大サイズ',
            description: 'プラグインデータの変更 1 バッチの最大サイズ（バイト単位）。',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: 'プラグインデータバッチあたりの行数',
            description: 'プラグインデータの変更 1 バッチに含まれる行の最大数。',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: '1 人あたりのプラグインデータ行数',
            description: '1 人が保存できるプラグインデータの最大行数。',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: '1 人あたりのプラグインデータ容量',
            description: '1 人が保存できるプラグインデータの最大バイト数。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: '配信の最大ビットレート',
            description: 'この Home 経由のライブ配信の最大ビットレート（ビット/秒）。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: '配信の最大フレームレート',
            description: 'この Home 経由のライブ配信の最大フレームレート。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: '配信フレームの最大サイズ',
            description: 'この Home 経由のライブ配信のフレームの最大サイズ（バイト単位）。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: 'ライブ配信の最長時間',
            description: 'この Home 経由のライブ配信を続けられる最長時間（ミリ秒単位）。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: 'ライブ配信あたりのデータ量',
            description: 'この Home 経由の 1 つのライブ配信が運べる最大バイト数。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: '1 人あたりの同時ライブ配信数',
            description: '1 人がこの Home 経由で同時に実行できるライブ配信の最大数。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: '接続ごとの同時ライブ配信数',
            description: '1 つの接続がこの Home 経由で同時に実行できるライブ配信の最大数。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: 'マシンごとの同時ライブ配信数',
            description: '1 台のマシンがこの Home 経由で同時に実行できるライブ配信の最大数。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: '接続署名鍵の ID',
            description: 'マシン間の接続に署名する鍵を指定します。署名鍵がない場合、これらの接続はオフになります。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: '接続署名用の秘密鍵',
            description: 'マシン間の接続に署名する秘密鍵。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: '接続署名用の公開鍵',
            description: '署名鍵に対応する公開鍵。空欄の場合は秘密鍵から導出されます。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: '署名鍵の有効期限',
            description: '署名鍵の有効期限（ミリ秒単位のタイムスタンプ）。',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: 'ユーザー名で友達を探す',
            description: 'リンクしたアカウントに加えて、ユーザー名でも友達を探せます。',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: '友達照合のプロバイダー',
            description: '友達の照合に使うサインインプロバイダー。',
        },
    },
};

const zhHans: typeof en = {
    teams: {
        title: '团队',
        description: '共享会话、机器和访问权限的群组。',
        credentialResources: {
            title: '团队凭据',
            description: '团队与其会话共享的凭据。',
            externalApi: {
                title: '团队凭据 API',
                description: '外部工具通过 API 使用团队的凭据。',
            },
        },
    },
    automations: {
        title: '自动化',
        description: '按计划或触发执行的代理任务。',
    },
    workflows: {
        title: '工作流',
        description: '多步骤的代理流水线。',
    },
    pets: {
        sync: {
            title: '宠物同步',
            description: '让每个人的宠物在其所有设备上保持一致。',
        },
    },
    voice: {
        title: '语音',
        description: '与你的代理对话。',
        happierVoice: {
            title: 'Happier 语音',
            description: '通过这个 Home 提供的语音服务使用语音。',
        },
    },
    connectedServices: {
        group: '已连接服务',
        quotas: {
            title: '配额计量',
            description: '显示每个已连接账户剩余的配额。',
        },
        subscription: {
            title: '订阅状态',
            description: '显示每个已连接账户的套餐和状态。',
        },
        accountGroups: {
            title: '账户组',
            description: '将已连接账户组成账户池。',
        },
        accountFallback: {
            title: '账户切换',
            description: '一个账户用完时切换到池中的下一个账户。',
        },
        autoQuotaReset: {
            title: '自动重置配额',
            description: '池中所有账户用完后，使用积攒的配额重置次数。',
        },
        autoDisablePlanInvalid: {
            title: '跳过不可用账户',
            description: '停用池中无法使用所选模型的账户。',
        },
        poolQuotaLimitSelection: {
            title: '账户池配额限制',
            description: '选择每个账户池遵循的提供商配额。',
        },
    },
    updates: {
        ota: {
            title: 'OTA 更新',
            description: '应用无需通过应用商店即可安装更新。',
        },
    },
    attachments: {
        uploads: {
            title: '附件',
            description: '向会话中的代理发送文件和图片。',
        },
    },
    sharing: {
        group: '共享',
        session: {
            title: '会话共享',
            description: '与这个 Home 上的某人共享会话。',
        },
        public: {
            title: '公开链接',
            description: '通过公开链接共享会话内容。',
        },
        contentKeys: {
            title: '加密共享',
            description: '交换密钥，让共享的会话保持端到端加密。',
        },
        pendingQueueV2: {
            title: '共享消息队列',
            description: '代理忙碌时，将共享会话的消息排入队列。',
        },
        pendingDeliveryState: {
            title: '队列送达跟踪',
            description: '记录哪些排队消息已送达代理。',
        },
    },
    sessions: {
        title: '会话',
        description: '会话及其控制。',
        group: '会话',
        handoff: {
            title: '会话移交',
            description: '将正在运行的会话移到另一台机器。',
        },
        ephemeralRunner: {
            title: '临时运行器',
            description: '在一次性机器上启动会话。',
        },
        agentSwitching: {
            title: '切换代理',
            description: '用另一个编码代理继续会话。',
        },
        folders: {
            title: '会话文件夹',
            description: '用文件夹整理会话。',
        },
        drafts: {
            title: '同步草稿',
            description: '在每台设备上保留未发送的消息和新会话草稿。',
        },
        following: {
            title: '关注',
            description: '关注会话以接收其更新和通知。',
        },
        conversations: {
            title: '对话',
            description: '成员在共享会话中交谈并互相提及。',
        },
        board: {
            title: '会话看板',
            description: '在共享看板上排列会话及其条目。',
        },
        filteredListing: {
            title: '筛选列表',
            description: '在分页之前筛选这个 Home 上的会话列表。',
        },
        usageLimitRecovery: {
            title: '用量限制恢复',
            description: '代理达到用量限制时，等待后继续或重试。',
        },
    },
    machines: {
        title: '机器',
        description: '与你的机器的连接。',
        group: '机器',
        pools: {
            title: '机器池',
            description: '一台机器离线时切换到下一台。',
        },
        transfer: {
            title: '机器间传输',
            description: '在机器之间传输数据。',
            directPeer: {
                title: '直接传输',
                description: '在机器之间直接传输数据。',
            },
            serverRouted: {
                title: '经由这个 Home 传输',
                description: '机器无法直接连接时，经由这个 Home 传输数据。',
            },
        },
        peerMediation: {
            title: '机器间连接',
            description: '机器之间的隧道、流和访问。',
            observability: {
                title: '连接诊断',
                description: '显示机器之间的隧道、流和预览是如何连接的。',
            },
        },
        tunnel: {
            title: '机器隧道',
            description: '在机器之间开放端口。',
            directPeer: {
                title: '直接隧道',
                description: '在机器之间直接开放端口。',
            },
            serverRouted: {
                title: '经由这个 Home 的隧道',
                description: '机器无法直接连接时，经由这个 Home 开放端口。',
            },
        },
        liveStream: {
            title: '直播',
            description: '串流机器的屏幕。',
            directPeer: {
                title: '直接直播',
                description: '将机器的屏幕直接串流到你的设备。',
            },
            serverRouted: {
                title: '经由这个 Home 的直播',
                description: '直接串流失败时，经由这个 Home 串流机器的屏幕。',
            },
        },
        rpc: {
            title: '机器调用',
            description: '直接连接机器。',
            directPeer: {
                title: '直接调用机器',
                description: '直接连接机器，而不经由这个 Home。',
            },
        },
    },
    localServices: {
        title: '本地服务',
        description: '查看并打开机器上运行的服务。',
        group: '本地服务',
        inventory: {
            title: '服务清单',
            description: '列出每台机器上运行的端口和服务。',
        },
        managed: {
            title: '托管服务',
            description: '在 Happier 中启动、命名和监控服务。',
        },
        launcher: {
            title: '服务启动器',
            description: '推荐可打开和预览的服务。',
        },
        actions: {
            title: '服务操作',
            description: '复制、预览和移除服务。',
            terminate: {
                title: '停止服务',
                description: '停止检测到的服务进程。',
            },
        },
        preview: {
            title: '服务预览',
            description: '在会话中私密预览本地服务。',
        },
        publicPreview: {
            title: '公开预览',
            description: '通过公开地址共享服务预览。',
        },
    },
    browser: {
        title: '浏览器',
        description: '在 Happier 中打开页面、预览和托管视图。',
        group: '浏览器',
        viewTargets: {
            title: '浏览器视图',
            description: '在合适的视图中打开预览、插件页面和链接。',
        },
        internal: {
            title: '内置浏览器',
            description: '在 Happier 中使用独立的会话和配置文件浏览。',
        },
        sidecar: {
            title: '辅助浏览器',
            description: '用于繁重自动化的独立托管浏览器。',
        },
        diagnostics: {
            title: '浏览器开发者工具',
            description: '内置浏览器的控制台、网络和 devtools 事件。',
        },
        context: {
            title: '浏览器上下文',
            description: '将页面内容附加到消息或代理。',
        },
        automation: {
            title: '浏览器自动化',
            description: '代理在内置浏览器中点击、输入和导航。',
        },
        recording: {
            title: '浏览器录制',
            description: '将浏览器会话录制为证据。',
        },
    },
    plugins: {
        title: 'Happier 之外的插件',
        description: '从 npm 和你自己的来源安装插件。',
        group: '插件',
        webhooks: {
            title: '插件 Webhook',
            description: '插件接收外部服务的 Webhook。',
        },
        ui: {
            title: '插件界面',
            description: '显示插件提供的界面和面板。',
            hostedWeb: {
                title: 'Web 插件界面',
                description: '显示为 Web 构建的插件界面。',
            },
            reactNativeBundles: {
                title: '原生插件界面',
                description: '运行用 React Native 构建的受信任插件界面。',
            },
        },
    },
    devices: {
        title: '设备',
        description: '模拟器和已连接的设备。',
        simulatorPreview: {
            title: '模拟器预览',
            description: '显示你机器上的模拟器。',
        },
    },
    social: {
        friends: {
            title: '好友',
            description: '添加好友并查看他们共享的内容。',
        },
    },
    auth: {
        group: '登录',
        recovery: {
            providerReset: {
                title: '通过提供商重置',
                description: '通过账户的身份提供商登录来恢复账户。',
            },
        },
        login: {
            keyChallenge: {
                title: '密钥登录',
                description: '通过证明设备的密钥登录。',
            },
        },
        mtls: {
            title: '客户端证书',
            description: '使用客户端证书 (mTLS) 登录。',
        },
        ui: {
            recoveryKeyReminder: {
                title: '恢复密钥提醒',
                description: '提醒成员保存恢复密钥。',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: '扫码登录',
                description: '在手机上扫描电脑上的代码来登录。',
            },
            boundQrV2: {
                title: '更安全的配对码',
                description: '只对这个 Home 和这个方向有效的配对码。',
            },
        },
    },
    encryption: {
        group: '加密',
        plaintextStorage: {
            title: '不加密存储',
            description: '不使用端到端加密存储会话。',
        },
        accountOptOut: {
            title: '关闭加密',
            description: '每个人都可以关闭端到端加密。',
        },
    },
    remoteHosts: {
        group: '远程主机',
        management: {
            title: '远程主机',
            description: '保存用于运行会话的 SSH 主机。',
        },
        secretMaterial: {
            title: '已保存的主机密钥',
            description: '保存 SSH 主机的密码和密钥。',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: '无密钥账户',
            description: '没有端到端加密密钥的账户。',
        },
    },
    bugReports: {
        title: '错误报告',
        description: '发送附带诊断信息的错误报告。',
    },
    terminal: {
        group: '终端',
        embeddedPty: {
            title: '终端',
            description: '在 Happier 中打开机器上的终端。',
        },
        transport: {
            byteStream: {
                title: '流式终端',
                description: '为内置终端提供更快的连接。',
            },
        },
    },
    search: {
        title: '搜索',
        description: '搜索会话和转录内容。',
    },
    providers: {
        title: '模型提供商',
        description: '连接模型提供商并为代理选择模型。',
        group: '模型提供商',
        localDiscovery: {
            title: '发现本地提供商',
            description: '查找机器上运行的模型服务器。',
        },
        localModelManagement: {
            title: '本地模型管理',
            description: '下载并管理本地模型。',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: '报告服务地址',
            description: '错误报告的发送位置。留空则不提供报告服务。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: '默认包含诊断信息',
            description: '除非报告者选择不包含，报告表单会附带诊断信息。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: '附件大小上限',
            description: '错误报告可附加的最大文件，以字节为单位。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: '上传时限',
            description: '错误报告上传可用的时长，以毫秒为单位。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: '接受的附件类型',
            description: '错误报告接受的附件类型。留空则接受常用类型。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: '上下文时间窗口',
            description: '错误报告回溯收集上下文的时长，以毫秒为单位。',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: '语音需要订阅',
            description: '只有订阅者可以使用语音。未设置时，生产环境要求订阅，其他环境不要求。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: '宠物清单大小上限',
            description: '接受的宠物清单最大大小，以字节为单位。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: '宠物精灵图大小上限',
            description: '接受的宠物精灵图最大大小，以字节为单位。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: '宠物包大小上限',
            description: '接受的宠物包最大大小，以字节为单位。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: '每人导入的宠物数',
            description: '每人最多可保留的导入宠物数量。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: '每人导入宠物的存储空间',
            description: '每人最多可保留的导入宠物字节数。',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: '加密的自定义宠物',
            description: '预留供日后使用。加密的自定义宠物尚不同步，因此保持关闭。',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: '经由这个 Home 的传输上限',
            description: '经由这个 Home 的传输可携带的最大文件，以字节为单位。',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: '每个连接的同时传输数',
            description: '一个连接经由这个 Home 同时进行的传输数上限。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: '每条隧道的数据量',
            description: '经由这个 Home 的一条隧道最多可携带的字节数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: '每个连接的隧道数',
            description: '一个连接经由这个 Home 同时保持打开的隧道数上限。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: '隧道帧大小上限',
            description: '经由这个 Home 的隧道可携带的最大帧，以字节为单位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: '隧道编码',
            description: '经由这个 Home 的隧道接受的帧编码。留空则使用标准编码。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: '首选隧道编码',
            description: '优先使用的帧编码。必须是接受的编码之一。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: '帧头大小上限',
            description: '二进制帧头的最大大小，以字节为单位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: '帧负载大小上限',
            description: '单个帧中原始负载的最大大小，以字节为单位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: '分帧消息大小上限',
            description: '分帧消息的最大大小，以字节为单位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: '每条隧道的同时流数',
            description: '一条隧道同时运行的流数上限。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: '每条隧道的流数',
            description: '一条隧道在其生命周期内可打开的流数上限。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: '每个流的数据量',
            description: '一个流最多可携带的字节数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: '每条隧道所有流的数据量',
            description: '一条隧道的所有流合计最多可携带的字节数。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: '空闲流时限',
            description: '流在关闭前可保持空闲的时长，以毫秒为单位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: '空闲隧道时限',
            description: '经由这个 Home 的隧道在关闭前可保持空闲的时长，以毫秒为单位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: '隧道空闲时限',
            description: '隧道在关闭前可保持空闲的时长，以毫秒为单位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: '隧道最长时长',
            description: '隧道保持打开的最长时间，以毫秒为单位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: '隧道可访问的端口',
            description: '隧道可开放的端口。留空则仅允许默认端口。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: '预览链接有效期',
            description: '私密预览链接的有效时长，以毫秒为单位。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: '预览域名',
            description: '为每个预览提供独立地址的域名。留空则在这个 Home 的地址下提供预览。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: '公开预览模式',
            description: '预览可以公开的方式。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: '公开预览最长时长',
            description: '预览保持公开的最长时间，以毫秒为单位。留空则使用标准上限。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: '同时公开的预览数',
            description: '同时公开的预览数上限。留空则使用标准上限。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: '要求 DNS 和 TLS',
            description: '公开预览需要 DNS 和 TLS。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: '公开预览审计日志',
            description: '公开预览的记录位置。公开预览必须配置此项。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: '审计日志文件',
            description: '公开预览审计日志写入的文件。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: '允许测试审计日志',
            description: '仅用于开发：接受内存中的测试审计日志。生产环境中会被忽略。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: '公开预览速率限制',
            description: '公开预览可使用的速率限制配置。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: '速率限制检查器',
            description: '公开预览请求的速率限制方式。公开预览必须配置此项。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: '每个窗口的请求数',
            description: '公开预览在每个窗口内允许的请求数。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: '速率限制窗口',
            description: '每个速率限制窗口的时长，以毫秒为单位。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: '允许测试速率限制器',
            description: '仅用于开发：接受内存中的测试速率限制器。生产环境中会被忽略。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: '处理中的 Webhook',
            description: '此服务器同时处理的 Webhook 请求数上限。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Webhook 内存',
            description: '处理中的 Webhook 请求最多可使用的内存，以字节为单位。留空则按请求数上限所允许的量。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: '每个路由每分钟的 Webhook 数',
            description: '一个路由上每分钟的 Webhook 请求数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: '每个路由的同时 Webhook 数',
            description: '一个路由上处理中的 Webhook 请求数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: '每个端点每分钟的 Webhook 数',
            description: '一个端点上每分钟的 Webhook 请求数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: '每个端点的同时 Webhook 数',
            description: '一个端点上处理中的 Webhook 请求数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: '每人每分钟的 Webhook 数',
            description: '每人每分钟的 Webhook 请求数。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: '每人的同时 Webhook 数',
            description: '每人处理中的 Webhook 请求数。',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: '插件界面包大小上限',
            description: '这个 Home 托管的插件界面包最大大小，以字节为单位。',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: '每人的插件界面存储空间',
            description: '每人最多可存储的插件界面包字节数。',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: '插件数据行大小上限',
            description: '插件存储的单行最大大小，以字节为单位。',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: '插件数据批次大小上限',
            description: '一批插件数据更改的最大大小，以字节为单位。',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: '每批插件数据的行数',
            description: '一批插件数据更改中的行数上限。',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: '每人的插件数据行数',
            description: '每人最多可存储的插件数据行数。',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: '每人的插件数据存储空间',
            description: '每人最多可存储的插件数据字节数。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: '直播最高码率',
            description: '经由这个 Home 的直播的最高码率，以比特/秒为单位。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: '直播最高帧率',
            description: '经由这个 Home 的直播的最高帧率。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: '直播帧大小上限',
            description: '经由这个 Home 的直播的最大帧，以字节为单位。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: '直播最长时长',
            description: '经由这个 Home 的直播可持续的最长时间，以毫秒为单位。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: '每场直播的数据量',
            description: '经由这个 Home 的一场直播最多可携带的字节数。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: '每人的同时直播数',
            description: '每人经由这个 Home 同时进行的直播数上限。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: '每个连接的同时直播数',
            description: '一个连接经由这个 Home 同时进行的直播数上限。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: '每台机器的同时直播数',
            description: '一台机器经由这个 Home 同时进行的直播数上限。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: '连接签名密钥 ID',
            description: '指定为机器之间的连接签名的密钥。没有签名密钥时，这些连接会关闭。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: '连接签名私钥',
            description: '为机器之间的连接签名的私钥。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: '连接签名公钥',
            description: '与签名密钥匹配的公钥。留空时从私钥推导。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: '签名密钥到期时间',
            description: '签名密钥的到期时间，以毫秒时间戳表示。',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: '按用户名查找好友',
            description: '除了通过关联账户，也可以按用户名查找好友。',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: '好友匹配提供商',
            description: '用于匹配好友的登录提供商。',
        },
    },
};

const zhHant: typeof en = {
    teams: {
        title: '團隊',
        description: '共享工作階段、機器和存取權限的群組。',
        credentialResources: {
            title: '團隊憑證',
            description: '團隊與其工作階段共享的憑證。',
            externalApi: {
                title: '團隊憑證 API',
                description: '外部工具透過 API 使用團隊的憑證。',
            },
        },
    },
    automations: {
        title: '自動化',
        description: '依排程或觸發執行的代理工作。',
    },
    workflows: {
        title: '工作流程',
        description: '多步驟的代理管線。',
    },
    pets: {
        sync: {
            title: '寵物同步',
            description: '讓每個人的寵物在其所有裝置上保持一致。',
        },
    },
    voice: {
        title: '語音',
        description: '與你的代理對話。',
        happierVoice: {
            title: 'Happier 語音',
            description: '透過這個 Home 提供的語音服務使用語音。',
        },
    },
    connectedServices: {
        group: '已連結服務',
        quotas: {
            title: '配額計量',
            description: '顯示每個已連結帳號剩餘的配額。',
        },
        subscription: {
            title: '訂閱狀態',
            description: '顯示每個已連結帳號的方案和狀態。',
        },
        accountGroups: {
            title: '帳號群組',
            description: '將已連結的帳號組成帳號池。',
        },
        accountFallback: {
            title: '帳號備援',
            description: '一個帳號用完時切換到池中的下一個帳號。',
        },
        autoQuotaReset: {
            title: '自動重設配額',
            description: '池中所有帳號用完後，使用累積的配額重設次數。',
        },
        autoDisablePlanInvalid: {
            title: '略過無法使用的帳號',
            description: '停用池中無法使用所選模型的帳號。',
        },
        poolQuotaLimitSelection: {
            title: '帳號池配額限制',
            description: '選擇每個帳號池依循的供應商配額。',
        },
    },
    updates: {
        ota: {
            title: 'OTA 更新',
            description: 'App 不必透過商店即可安裝更新。',
        },
    },
    attachments: {
        uploads: {
            title: '附件',
            description: '傳送檔案和圖片給工作階段中的代理。',
        },
    },
    sharing: {
        group: '分享',
        session: {
            title: '工作階段分享',
            description: '與這個 Home 上的某人分享工作階段。',
        },
        public: {
            title: '公開連結',
            description: '透過公開連結分享工作階段內容。',
        },
        contentKeys: {
            title: '加密分享',
            description: '交換金鑰，讓分享的工作階段保持端對端加密。',
        },
        pendingQueueV2: {
            title: '共享訊息佇列',
            description: '代理忙碌時，將共享工作階段的訊息排入佇列。',
        },
        pendingDeliveryState: {
            title: '佇列送達追蹤',
            description: '記錄哪些排入佇列的訊息已送達代理。',
        },
    },
    sessions: {
        title: '工作階段',
        description: '工作階段及其控制項。',
        group: '工作階段',
        handoff: {
            title: '工作階段移交',
            description: '將執行中的工作階段移到另一台機器。',
        },
        ephemeralRunner: {
            title: '臨時執行器',
            description: '在一次性機器上啟動工作階段。',
        },
        agentSwitching: {
            title: '切換代理',
            description: '用另一個程式碼代理繼續工作階段。',
        },
        folders: {
            title: '工作階段資料夾',
            description: '用資料夾整理工作階段。',
        },
        drafts: {
            title: '同步草稿',
            description: '在每台裝置上保留未傳送的訊息和新工作階段草稿。',
        },
        following: {
            title: '追蹤',
            description: '追蹤工作階段以接收其更新和通知。',
        },
        conversations: {
            title: '對話',
            description: '成員在共享工作階段中交談並互相提及。',
        },
        board: {
            title: '工作階段看板',
            description: '在共享看板上排列工作階段及其項目。',
        },
        filteredListing: {
            title: '篩選清單',
            description: '在分頁之前篩選這個 Home 上的工作階段清單。',
        },
        usageLimitRecovery: {
            title: '用量上限復原',
            description: '代理達到用量上限時，等待後繼續或重試。',
        },
    },
    machines: {
        title: '機器',
        description: '與你的機器的連線。',
        group: '機器',
        pools: {
            title: '機器池',
            description: '一台機器離線時切換到下一台。',
        },
        transfer: {
            title: '機器間傳輸',
            description: '在機器之間傳輸資料。',
            directPeer: {
                title: '直接傳輸',
                description: '在機器之間直接傳輸資料。',
            },
            serverRouted: {
                title: '經由這個 Home 傳輸',
                description: '機器無法直接連線時，經由這個 Home 傳輸資料。',
            },
        },
        peerMediation: {
            title: '機器間連線',
            description: '機器之間的通道、串流和存取。',
            observability: {
                title: '連線診斷',
                description: '顯示機器之間的通道、串流和預覽如何連線。',
            },
        },
        tunnel: {
            title: '機器通道',
            description: '在機器之間開放連接埠。',
            directPeer: {
                title: '直接通道',
                description: '在機器之間直接開放連接埠。',
            },
            serverRouted: {
                title: '經由這個 Home 的通道',
                description: '機器無法直接連線時，經由這個 Home 開放連接埠。',
            },
        },
        liveStream: {
            title: '直播',
            description: '串流機器的畫面。',
            directPeer: {
                title: '直接直播',
                description: '將機器的畫面直接串流到你的裝置。',
            },
            serverRouted: {
                title: '經由這個 Home 的直播',
                description: '直接串流失敗時，經由這個 Home 串流機器的畫面。',
            },
        },
        rpc: {
            title: '機器呼叫',
            description: '直接連線到機器。',
            directPeer: {
                title: '直接呼叫機器',
                description: '直接連線到機器，而不經由這個 Home。',
            },
        },
    },
    localServices: {
        title: '本機服務',
        description: '查看並開啟機器上執行的服務。',
        group: '本機服務',
        inventory: {
            title: '服務清單',
            description: '列出每台機器上執行的連接埠和服務。',
        },
        managed: {
            title: '受管服務',
            description: '在 Happier 中啟動、命名和監控服務。',
        },
        launcher: {
            title: '服務啟動器',
            description: '推薦可開啟和預覽的服務。',
        },
        actions: {
            title: '服務操作',
            description: '複製、預覽和移除服務。',
            terminate: {
                title: '停止服務',
                description: '停止偵測到的服務程序。',
            },
        },
        preview: {
            title: '服務預覽',
            description: '在工作階段中私密預覽本機服務。',
        },
        publicPreview: {
            title: '公開預覽',
            description: '透過公開位址分享服務預覽。',
        },
    },
    browser: {
        title: '瀏覽器',
        description: '在 Happier 中開啟頁面、預覽和託管檢視。',
        group: '瀏覽器',
        viewTargets: {
            title: '瀏覽器檢視',
            description: '在合適的檢視中開啟預覽、外掛頁面和連結。',
        },
        internal: {
            title: '內建瀏覽器',
            description: '在 Happier 中以獨立的工作階段和設定檔瀏覽。',
        },
        sidecar: {
            title: '輔助瀏覽器',
            description: '用於大量自動化的獨立受管瀏覽器。',
        },
        diagnostics: {
            title: '瀏覽器開發人員工具',
            description: '內建瀏覽器的主控台、網路和 devtools 事件。',
        },
        context: {
            title: '瀏覽器內容',
            description: '將頁面內容附加到訊息或代理。',
        },
        automation: {
            title: '瀏覽器自動化',
            description: '代理在內建瀏覽器中點按、輸入和瀏覽。',
        },
        recording: {
            title: '瀏覽器錄製',
            description: '將瀏覽器工作階段錄製為證據。',
        },
    },
    plugins: {
        title: 'Happier 以外的外掛',
        description: '從 npm 和你自己的來源安裝外掛。',
        group: '外掛',
        webhooks: {
            title: '外掛 Webhook',
            description: '外掛接收外部服務的 Webhook。',
        },
        ui: {
            title: '外掛畫面',
            description: '顯示外掛提供的畫面和面板。',
            hostedWeb: {
                title: 'Web 外掛畫面',
                description: '顯示為 Web 打造的外掛畫面。',
            },
            reactNativeBundles: {
                title: '原生外掛畫面',
                description: '執行以 React Native 打造的受信任外掛畫面。',
            },
        },
    },
    devices: {
        title: '裝置',
        description: '模擬器和已連接的裝置。',
        simulatorPreview: {
            title: '模擬器預覽',
            description: '顯示你機器上的模擬器。',
        },
    },
    social: {
        friends: {
            title: '好友',
            description: '新增好友並查看他們分享的內容。',
        },
    },
    auth: {
        group: '登入',
        recovery: {
            providerReset: {
                title: '透過供應商重設',
                description: '透過帳號的身分識別供應商登入來復原帳號。',
            },
        },
        login: {
            keyChallenge: {
                title: '金鑰登入',
                description: '透過證明裝置的金鑰登入。',
            },
        },
        mtls: {
            title: '用戶端憑證',
            description: '使用用戶端憑證 (mTLS) 登入。',
        },
        ui: {
            recoveryKeyReminder: {
                title: '復原金鑰提醒',
                description: '提醒成員儲存復原金鑰。',
            },
        },
        pairing: {
            desktopQrMobileScan: {
                title: '掃描登入',
                description: '在手機上掃描電腦上的代碼來登入。',
            },
            boundQrV2: {
                title: '更安全的配對碼',
                description: '只對這個 Home 和這個方向有效的配對碼。',
            },
        },
    },
    encryption: {
        group: '加密',
        plaintextStorage: {
            title: '不加密儲存',
            description: '不使用端對端加密儲存工作階段。',
        },
        accountOptOut: {
            title: '關閉加密',
            description: '每個人都可以關閉端對端加密。',
        },
    },
    remoteHosts: {
        group: '遠端主機',
        management: {
            title: '遠端主機',
            description: '儲存用來執行工作階段的 SSH 主機。',
        },
        secretMaterial: {
            title: '已儲存的主機密鑰',
            description: '儲存 SSH 主機的密碼和金鑰。',
        },
    },
    e2ee: {
        keylessAccounts: {
            title: '無金鑰帳號',
            description: '沒有端對端加密金鑰的帳號。',
        },
    },
    bugReports: {
        title: '錯誤回報',
        description: '傳送附帶診斷資訊的錯誤回報。',
    },
    terminal: {
        group: '終端機',
        embeddedPty: {
            title: '終端機',
            description: '在 Happier 中開啟機器上的終端機。',
        },
        transport: {
            byteStream: {
                title: '串流終端機',
                description: '為內建終端機提供更快的連線。',
            },
        },
    },
    search: {
        title: '搜尋',
        description: '搜尋工作階段和逐字稿。',
    },
    providers: {
        title: '模型供應商',
        description: '連結模型供應商並為代理選擇模型。',
        group: '模型供應商',
        localDiscovery: {
            title: '尋找本機供應商',
            description: '尋找機器上執行的模型伺服器。',
        },
        localModelManagement: {
            title: '本機模型管理',
            description: '下載並管理本機模型。',
        },
    },
    keys: {
        HAPPIER_FEATURE_BUG_REPORTS__PROVIDER_URL: {
            title: '回報服務位址',
            description: '錯誤回報的傳送位置。留空則不提供回報服務。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__DEFAULT_INCLUDE_DIAGNOSTICS: {
            title: '預設包含診斷資訊',
            description: '除非回報者選擇不包含，回報表單會附上診斷資訊。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__MAX_ARTIFACT_BYTES: {
            title: '附件大小上限',
            description: '錯誤回報可附加的最大檔案，以位元組為單位。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__UPLOAD_TIMEOUT_MS: {
            title: '上傳時限',
            description: '錯誤回報上傳可用的時間，以毫秒為單位。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__ACCEPTED_ARTIFACT_KINDS: {
            title: '接受的附件類型',
            description: '錯誤回報接受的附件類型。留空則接受常用類型。',
        },
        HAPPIER_FEATURE_BUG_REPORTS__CONTEXT_WINDOW_MS: {
            title: '內容時間範圍',
            description: '錯誤回報往前收集內容的時間長度，以毫秒為單位。',
        },
        HAPPIER_FEATURE_VOICE__REQUIRE_SUBSCRIPTION: {
            title: '語音需要訂閱',
            description: '只有訂閱者可以使用語音。未設定時，正式環境需要訂閱，其他環境則不需要。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_MANIFEST_BYTES: {
            title: '寵物資訊清單大小上限',
            description: '接受的寵物資訊清單最大大小，以位元組為單位。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_SPRITESHEET_BYTES: {
            title: '寵物圖像表大小上限',
            description: '接受的寵物圖像表最大大小，以位元組為單位。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_CANONICAL_PACKAGE_BYTES: {
            title: '寵物套件大小上限',
            description: '接受的寵物套件最大大小，以位元組為單位。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PETS_PER_ACCOUNT: {
            title: '每人匯入的寵物數',
            description: '每人最多可保留的匯入寵物數量。',
        },
        HAPPIER_FEATURE_PETS_SYNC__MAX_IMPORTED_PET_BYTES_PER_ACCOUNT: {
            title: '每人匯入寵物的儲存空間',
            description: '每人最多可保留的匯入寵物位元組數。',
        },
        HAPPIER_FEATURE_PETS_SYNC__ENCRYPTED_CUSTOM_PET_SYNC_POLICY: {
            title: '加密的自訂寵物',
            description: '保留供日後使用。加密的自訂寵物尚未同步，因此保持關閉。',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES: {
            title: '經由這個 Home 的傳輸上限',
            description: '經由這個 Home 的傳輸可攜帶的最大檔案，以位元組為單位。',
        },
        HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_ACTIVE_TRANSFERS_PER_SOCKET: {
            title: '每個連線的同時傳輸數',
            description: '一個連線經由這個 Home 同時進行的傳輸數上限。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES: {
            title: '每個通道的資料量',
            description: '經由這個 Home 的一個通道最多可攜帶的位元組數。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_ACTIVE_TUNNELS_PER_SOCKET: {
            title: '每個連線的通道數',
            description: '一個連線經由這個 Home 同時保持開啟的通道數上限。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: '通道訊框大小上限',
            description: '經由這個 Home 的通道可攜帶的最大訊框，以位元組為單位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__SUPPORTED_ENCODINGS: {
            title: '通道編碼',
            description: '經由這個 Home 的通道接受的訊框編碼。留空則使用標準編碼。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__PREFERRED_ENCODING: {
            title: '偏好的通道編碼',
            description: '優先使用的訊框編碼。必須是接受的編碼之一。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BINARY_HEADER_BYTES: {
            title: '訊框標頭大小上限',
            description: '二進位訊框標頭的最大大小，以位元組為單位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_RAW_PAYLOAD_BYTES: {
            title: '訊框酬載大小上限',
            description: '單一訊框中原始酬載的最大大小，以位元組為單位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_FRAMED_MESSAGE_BYTES: {
            title: '分框訊息大小上限',
            description: '分框訊息的最大大小，以位元組為單位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_CONCURRENT_SUBSTREAMS: {
            title: '每個通道的同時串流數',
            description: '一個通道同時執行的串流數上限。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_TOTAL_SUBSTREAMS: {
            title: '每個通道的串流數',
            description: '一個通道在其存續期間可開啟的串流數上限。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_BYTES_PER_SUBSTREAM: {
            title: '每個串流的資料量',
            description: '一個串流最多可攜帶的位元組數。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_AGGREGATE_BYTES: {
            title: '每個通道所有串流的資料量',
            description: '一個通道的所有串流合計最多可攜帶的位元組數。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SUBSTREAM_IDLE_MS: {
            title: '閒置串流時限',
            description: '串流在關閉前可保持閒置的時間，以毫秒為單位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__MAX_SESSION_IDLE_MS: {
            title: '閒置通道時限',
            description: '經由這個 Home 的通道在關閉前可保持閒置的時間，以毫秒為單位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_IDLE_MS: {
            title: '通道閒置時限',
            description: '通道在關閉前可保持閒置的時間，以毫秒為單位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL__MAX_DURATION_MS: {
            title: '通道最長時間',
            description: '通道保持開啟的最長時間，以毫秒為單位。',
        },
        HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS: {
            title: '通道可連線的連接埠',
            description: '通道可開放的連接埠。留空則只允許預設連接埠。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__TOKEN_TTL_MS: {
            title: '預覽連結有效期',
            description: '私密預覽連結的有效時間，以毫秒為單位。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: {
            title: '預覽網域',
            description: '為每個預覽提供獨立位址的網域。留空則在這個 Home 的位址下提供預覽。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOWED_MODES: {
            title: '公開預覽模式',
            description: '預覽可以公開的方式。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_TTL_MS: {
            title: '公開預覽最長時間',
            description: '預覽保持公開的最長時間，以毫秒為單位。留空則使用標準上限。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__MAX_CONCURRENT_EXPOSURES: {
            title: '同時公開的預覽數',
            description: '同時公開的預覽數上限。留空則使用標準上限。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__DNS_TLS_REQUIRED: {
            title: '要求 DNS 和 TLS',
            description: '公開預覽需要 DNS 和 TLS。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_SINK: {
            title: '公開預覽稽核記錄',
            description: '公開預覽的記錄位置。公開預覽必須設定此項。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__AUDIT_LOG_PATH: {
            title: '稽核記錄檔',
            description: '公開預覽稽核記錄寫入的檔案。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_AUDIT_SINK: {
            title: '允許測試稽核記錄',
            description: '僅供開發使用：接受記憶體中的測試稽核記錄。正式環境中會忽略。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_PROFILE_IDS: {
            title: '公開預覽速率限制',
            description: '公開預覽可使用的速率限制設定檔。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER: {
            title: '速率限制檢查器',
            description: '公開預覽要求的速率限制方式。公開預覽必須設定此項。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS: {
            title: '每個時間窗的要求數',
            description: '公開預覽在每個時間窗內允許的要求數。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS: {
            title: '速率限制時間窗',
            description: '每個速率限制時間窗的長度，以毫秒為單位。',
        },
        HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: {
            title: '允許測試速率限制器',
            description: '僅供開發使用：接受記憶體中的測試速率限制器。正式環境中會忽略。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_REQUESTS: {
            title: '處理中的 Webhook',
            description: '此伺服器同時處理的 Webhook 要求數上限。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__PROCESS_MAX_WORKING_BYTES: {
            title: 'Webhook 記憶體',
            description: '處理中的 Webhook 要求最多可使用的記憶體，以位元組為單位。留空則依要求數上限所允許的量。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_RATE_PER_MINUTE: {
            title: '每個路由每分鐘的 Webhook 數',
            description: '一個路由上每分鐘的 Webhook 要求數。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ROUTE_CONCURRENCY: {
            title: '每個路由的同時 Webhook 數',
            description: '一個路由上處理中的 Webhook 要求數。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_RATE_PER_MINUTE: {
            title: '每個端點每分鐘的 Webhook 數',
            description: '一個端點上每分鐘的 Webhook 要求數。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENDPOINT_CONCURRENCY: {
            title: '每個端點的同時 Webhook 數',
            description: '一個端點上處理中的 Webhook 要求數。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_RATE_PER_MINUTE: {
            title: '每人每分鐘的 Webhook 數',
            description: '每人每分鐘的 Webhook 要求數。',
        },
        HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ACCOUNT_CONCURRENCY: {
            title: '每人的同時 Webhook 數',
            description: '每人處理中的 Webhook 要求數。',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ARTIFACT_BYTES: {
            title: '外掛畫面套件大小上限',
            description: '這個 Home 託管的外掛畫面套件最大大小，以位元組為單位。',
        },
        HAPPIER_FEATURE_PLUGINS_UI_ARTIFACT_HOSTING__MAX_ACCOUNT_BYTES: {
            title: '每人的外掛畫面儲存空間',
            description: '每人最多可儲存的外掛畫面套件位元組數。',
        },
        HAPPIER_COLLECTION_MAX_ROW_ENCODED_BYTES: {
            title: '外掛資料列大小上限',
            description: '外掛儲存的單一資料列最大大小，以位元組為單位。',
        },
        HAPPIER_COLLECTION_MAX_BATCH_BYTES: {
            title: '外掛資料批次大小上限',
            description: '一批外掛資料變更的最大大小，以位元組為單位。',
        },
        HAPPIER_COLLECTION_MAX_BATCH_ROWS: {
            title: '每批外掛資料的列數',
            description: '一批外掛資料變更中的列數上限。',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_ROWS: {
            title: '每人的外掛資料列數',
            description: '每人最多可儲存的外掛資料列數。',
        },
        HAPPIER_COLLECTION_MAX_ACCOUNT_BYTES: {
            title: '每人的外掛資料儲存空間',
            description: '每人最多可儲存的外掛資料位元組數。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: {
            title: '直播最高位元率',
            description: '經由這個 Home 的直播最高位元率，以位元/秒為單位。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: {
            title: '直播最高影格速率',
            description: '經由這個 Home 的直播最高影格速率。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: {
            title: '直播影格大小上限',
            description: '經由這個 Home 的直播最大影格，以位元組為單位。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: {
            title: '直播最長時間',
            description: '經由這個 Home 的直播可持續的最長時間，以毫秒為單位。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: {
            title: '每場直播的資料量',
            description: '經由這個 Home 的一場直播最多可攜帶的位元組數。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: {
            title: '每人的同時直播數',
            description: '每人經由這個 Home 同時進行的直播數上限。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: {
            title: '每個連線的同時直播數',
            description: '一個連線經由這個 Home 同時進行的直播數上限。',
        },
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: {
            title: '每台機器的同時直播數',
            description: '一台機器經由這個 Home 同時進行的直播數上限。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: {
            title: '連線簽署金鑰 ID',
            description: '指定為機器之間的連線簽署的金鑰。沒有簽署金鑰時，這些連線會關閉。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: {
            title: '連線簽署私密金鑰',
            description: '為機器之間的連線簽署的私密金鑰。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: {
            title: '連線簽署公開金鑰',
            description: '與簽署金鑰相符的公開金鑰。留空時從私密金鑰推導。',
        },
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: {
            title: '簽署金鑰到期時間',
            description: '簽署金鑰的到期時間，以毫秒時間戳記表示。',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: {
            title: '依使用者名稱尋找好友',
            description: '除了透過連結的帳號，也可以依使用者名稱尋找好友。',
        },
        HAPPIER_FEATURE_SOCIAL_FRIENDS__IDENTITY_PROVIDER: {
            title: '好友比對供應商',
            description: '用於比對好友的登入供應商。',
        },
    },
};

export const homeFeatureTranslations = {
    en,
    de,
    es,
    fr,
    it,
    pt,
    ca,
    pl,
    ru,
    ja,
    zhHans,
    zhHant,
} as const;
