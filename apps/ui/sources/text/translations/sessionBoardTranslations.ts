/**
 * Copy for the shared Session Board.
 *
 * One module rather than per-locale blocks, because the Board, the compact
 * sidebar, the mobile Cockpit, inline transcript references and the Companion all
 * read the SAME item-state vocabulary. When "this widget cannot be shown" is
 * written once, five surfaces cannot drift into five different explanations of the
 * same record.
 *
 * `widget` is deliberately the product word here; the protocol and persistence say
 * `item`.
 */

type SessionBoardStateTranslation = Readonly<{ title: string; reason: string }>;

type SessionBoardTranslation = Readonly<{
    title: string;
    views: Readonly<{
        label: string;
        overview: string;
        createTitle: string;
        renameTitle: string;
        /** Announced once when the view being read was removed by someone else. */
        reconciled: (params: Readonly<{ title: string }>) => string;
        empty: SessionBoardStateTranslation;
        actions: Readonly<{
            create: string;
            rename: string;
            /** Logical order, mirrored by RTL rather than named left/right. */
            moveBefore: string;
            moveAfter: string;
            remove: string;
        }>;
        remove: Readonly<{
            title: (params: Readonly<{ title: string }>) => string;
            moveMessage: (params: Readonly<{ title: string }>) => string;
            unpinMessage: string;
        }>;
    }>;
    /** Readable items the shared layout places nowhere. */
    recovered: Readonly<{ title: string; description: string; pin: string }>;
    /** Typed Board mutation results. A durable change never fails silently. */
    mutation: Readonly<{
        conflict: string;
        outcomeUnknown: string;
        denied: string;
        offline: string;
        unavailable: string;
        updateRequired: string;
        hostedHtmlSourceTooLarge: string;
        noteTooLarge: string;
        invalid: string;
        notFound: string;
        storageFailed: string;
        serverFailed: string;
        failed: string;
    }>;
    add: Readonly<{ note: string; interactiveView: string; fromPlugins: string }>;
    /** The installed-widget Add picker over the exact current Session projection. */
    picker: Readonly<{
        title: string;
        description: string;
        add: string;
        empty: SessionBoardStateTranslation;
        /** Two installed plugins may legitimately share a display name. */
        qualified: (params: Readonly<{ plugin: string; pluginId: string }>) => string;
    }>;
    width: Readonly<{ compact: string; medium: string; wide: string; full: string }>;
    /** Semantic vertical intent stored on the item, never a pixel value. */
    height: Readonly<{ auto: string; compact: string; regular: string; tall: string }>;
    board: Readonly<{
        loading: SessionBoardStateTranslation;
        locked: SessionBoardStateTranslation;
        unopenable: SessionBoardStateTranslation;
        unsupported: SessionBoardStateTranslation;
        unavailable: SessionBoardStateTranslation;
        offline: string;
        stale: string;
    }>;
    empty: Readonly<{
        editor: Readonly<{
            title: string;
            description: string;
            askAgent: string;
            /**
             * Placed in the Session composer, ready to finish. It is a beginning,
             * not a message: the Board never sends anything on the person's behalf.
             */
            askAgentPrompt: string;
        }>;
        viewer: Readonly<{ title: string; description: string }>;
    }>;
    item: Readonly<{
        untitled: string;
        renameA11y: string;
        /** The reorder handle's own name; it must not borrow the Board-views label. */
        reorderA11y: (params: Readonly<{ title: string }>) => string;
        a11yLabelWithWidth: (params: Readonly<{ title: string; width: string }>) => string;
        menuGroups: Readonly<{ content: string; movement: string; geometry: string; destructive: string }>;
        loading: SessionBoardStateTranslation;
        locked: SessionBoardStateTranslation;
        unopenable: SessionBoardStateTranslation;
        unsupported: SessionBoardStateTranslation;
        missing: SessionBoardStateTranslation;
        removed: SessionBoardStateTranslation;
        pluginUnavailable: SessionBoardStateTranslation;
        rendererUnavailable: SessionBoardStateTranslation;
        provenance: Readonly<{
            note: string;
            interactiveView: string;
            /** The plugin is absent from this device's projection; its id beats "a plugin". */
            pluginMissing: (params: Readonly<{ pluginId: string }>) => string;
            /** The contribution's own title beside the installed plugin's display name. */
            pluginSurface: (params: Readonly<{ plugin: string; surface: string }>) => string;
            /** Assistive disambiguation when two installed plugins share a display name. */
            pluginQualified: (params: Readonly<{ label: string; pluginId: string }>) => string;
        }>;
        actions: Readonly<{
            remove: string;
            openHere: string;
            managePlugin: string;
            prepareEncryption: string;
            /** Open the canonical full-content route for a clipped or read-only note. */
            readFull: string;
            /** Starts the inline title editor, so rename is not pointer-only. */
            rename: string;
            /** Drop this view's placement; the shared record survives. */
            unpin: string;
            /** Names the destination board view; never a code-joined "label: title". */
            moveToView: (params: Readonly<{ title: string }>) => string;
        }>;
        /**
         * What assistive technology hears after a completed move. Each locale
         * authors one whole sentence; the app never joins fragments with its own
         * punctuation, which reads as an unfinished phrase in every language.
         */
        moved: Readonly<{
            before: (params: Readonly<{ title: string }>) => string;
            after: (params: Readonly<{ title: string }>) => string;
            reordered: (params: Readonly<{ title: string }>) => string;
            toView: (params: Readonly<{ title: string; view: string }>) => string;
        }>;
        /** The reorder handle's staged position, spoken rather than read as "2 / 4". */
        movePosition: (params: Readonly<{ position: number; total: number }>) => string;
        /** The reorder handle's staged cross-view destination. */
        moveTargetView: (params: Readonly<{ title: string }>) => string;
        /** The one confirmation before a shared record and every placement are deleted. */
        remove: Readonly<{ title: string; message: string }>;
    }>;
    note: Readonly<{
        titlePlaceholder: string;
        titleA11y: string;
        untitled: string;
        offline: string;
        unavailable: string;
        failed: string;
        outcomeUnknown: string;
        saved: string;
        conflict: Readonly<{
            message: string;
            reviewLatest: string;
            applyMine: string;
            latestHeading: string;
        }>;
    }>;
    /**
     * The one capability review a caller-authored interactive view gets before
     * it may reach the Host API. Rows are counts and fixed phrases; the exact
     * manifest, revision and fingerprint stay on the diagnostics channel.
     */
    hostedHtmlApproval: Readonly<{
        title: string;
        body: string;
        resources: (params: Readonly<{ count: number }>) => string;
        actions: (params: Readonly<{ count: number }>) => string;
        /** Fixed phrase, present only when the view asks to send Session messages. */
        sendMessages: string;
        loadsFrom: (params: Readonly<{ origin: string }>) => string;
        allow: string;
        notNow: string;
        /** After `Not now`: nothing is recorded, and the review stays one tap away. */
        declined: Readonly<{ title: string; reason: string; review: string }>;
    }>;
    sidebar: Readonly<{ openInDetails: string }>;
    /** The full-screen Cockpit Board; the desktop grid has no search field. */
    mobile: Readonly<{ searchPlaceholder: string }>;
    /**
     * The transcript's reference to an item an Agent Board Action just wrote. It
     * is a mirror, not a placement, so its one affordance names the real
     * destination rather than borrowing "Open here".
     */
    inline: Readonly<{
        openBoard: string;
        openBoardA11y: (params: Readonly<{ title: string }>) => string;
    }>;
    /** Viewer-local Companion copy. Product says "Companion"; persistence says item. */
    companion: Readonly<{
        title: string;
        empty: SessionBoardStateTranslation;
        actions: Readonly<{
            addSummary: string;
            addItem: (params: Readonly<{ title: string }>) => string;
            /** Logical edges, localized to the reader's current direction. */
            moveToLeading: string;
            moveToTrailing: string;
            /** Linear order jumps; reorder is never drag-only. */
            moveToFirst: string;
            moveToLast: string;
            compact: string;
            comfortable: string;
            openFull: string;
            openOnBoard: string;
            collapse: string;
            expand: string;
            hide: string;
            /** Local only: the shared record survives, so the wording is not destructive. */
            addToCompanion: string;
            removeFromCompanion: string;
            undo: string;
            menuA11y: string;
            itemMenuA11y: (params: Readonly<{ title: string }>) => string;
        }>;
        a11y: Readonly<{
            headerAction: (params: Readonly<{ count: number }>) => string;
            show: (params: Readonly<{ count: number }>) => string;
            expand: (params: Readonly<{ count: number }>) => string;
        }>;
        summary: Readonly<{
            title: string;
            untitled: string;
            approvals: (params: Readonly<{ count: number }>) => string;
            workflows: (params: Readonly<{ count: number }>) => string;
            changedFiles: (params: Readonly<{ count: number }>) => string;
            tokens: (params: Readonly<{ count: number }>) => string;
            contextPercent: (params: Readonly<{ percent: number }>) => string;
            contextOnly: string;
            moreDetails: string;
            moreDetailsA11y: (params: Readonly<{ count: number }>) => string;
            /** Lane 09A admitted it could not see everything it describes. */
            partial: string;
        }>;
        /** Transient feedback through the app's ONE presentation-notice owner. */
        notices: Readonly<{
            shown: string;
            hidden: string;
            added: string;
            removed: string;
            reordered: string;
            moved: string;
            boardOpened: string;
            returnedToChat: string;
            boardViewSelected: string;
            boardItemRevealed: string;
            fullOpened: string;
        }>;
    }>;
}>;

export const sessionBoardTranslations = {
    en: {
        title: 'Board',
        views: {
            label: 'Board views',
            overview: 'Overview',
            createTitle: 'New board view',
            renameTitle: 'Rename board view',
            reconciled: ({ title }) => `That board view was removed. Showing ${title}.`,
            empty: {
                title: 'Nothing in this view',
                reason: 'Add a widget here, or switch to another board view.',
            },
            actions: {
                create: 'New view',
                rename: 'Rename view',
                moveBefore: 'Move view earlier',
                moveAfter: 'Move view later',
                remove: 'Delete view',
            },
            remove: {
                title: ({ title }) => `Delete “${title}”?`,
                moveMessage: ({ title }) => `Its widgets move to ${title}. Nothing is deleted from the session.`,
                unpinMessage: 'Its widgets stay in the session but are no longer pinned to a view.',
            },
        },
        add: { note: 'Note', interactiveView: 'Interactive view', fromPlugins: 'From plugins…' },
        picker: {
            title: 'Add from plugins',
            description: 'Installed plugins can contribute widgets to this Session.',
            add: 'Add to Board',
            empty: { title: 'No plugin widgets available', reason: 'Install or enable a plugin that contributes a Session widget.' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: 'Compact', medium: 'Medium', wide: 'Wide', full: 'Full width' },
        height: { auto: 'Fit content', compact: 'Short', regular: 'Medium', tall: 'Tall' },
        board: {
            loading: { title: 'Opening the board', reason: 'Loading what this session has pinned here.' },
            locked: {
                title: 'The board is still encrypted',
                reason: 'This device cannot open the session yet. Nothing was lost.',
            },
            unopenable: {
                title: 'The board layout cannot be read',
                reason: 'Its stored organization could not be opened. Individual widgets are unaffected.',
            },
            unsupported: {
                title: 'This board needs a newer Happier',
                reason: 'Everything is preserved. Open it on a supported device or update Happier.',
            },
            unavailable: {
                title: 'The board is not available here yet',
                reason: 'Nothing was lost. It becomes available once this Home enables boards.',
            },
            offline: 'Offline — showing the last version you loaded.',
            stale: 'Showing the last version you loaded.',
        },
        empty: {
            editor: {
                title: 'Add your first widget',
                description: 'The board is shared with everyone who can read this session.',
                askAgent: 'Ask the agent',
                askAgentPrompt: 'Put something on this board that shows ',
            },
            viewer: {
                title: 'Nothing on the board yet',
                description: 'Whatever people or agents pin to this session shows up here.',
            },
        },
        item: {
            untitled: 'Untitled widget',
            renameA11y: 'Widget title',
            reorderA11y: ({ title }) => `Reorder ${title}`,
        a11yLabelWithWidth: ({ title, width }) => `${title}, ${width}`,
        menuGroups: { content: 'Read and edit', movement: 'Movement', geometry: 'Size', destructive: 'Remove' },
            loading: { title: 'Loading this widget', reason: 'Fetching its content from this Home.' },
            locked: {
                title: 'Encrypted details unavailable',
                reason: 'This widget stays encrypted until this device can open the session.',
            },
            unopenable: {
                title: 'This widget cannot be shown',
                reason: 'Its stored content could not be read. The rest of the board is unaffected.',
            },
            unsupported: {
                title: 'This widget needs a newer Happier',
                reason: 'Its content is preserved. Open it on a supported device or update Happier.',
            },
            missing: {
                title: 'This widget is missing',
                reason: 'The board still points at it, but its content is not on this Home.',
            },
            removed: {
                title: 'This widget was removed from the board',
                reason: 'Someone with edit access deleted it for everyone.',
            },
            pluginUnavailable: {
                title: 'Plugin unavailable on this device',
                reason: 'The widget is preserved. It will render again once the plugin is available here.',
            },
            rendererUnavailable: {
                title: 'This widget cannot be shown on this device',
                reason: 'Its content is preserved. Open it on a device that supports interactive views.',
            },
            provenance: {
                note: 'Note',
                interactiveView: 'Interactive view',
                pluginMissing: ({ pluginId }) => `From ${pluginId} · not installed`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'Remove from board',
                openHere: 'Open here',
                managePlugin: 'Manage plugin',
                prepareEncryption: 'Set up encryption',
                readFull: 'Read full note',
                rename: 'Rename widget',
                unpin: 'Unpin from this view',
                moveToView: ({ title }) => `Move to ${title}`,
            },
            moved: {
                before: ({ title }) => `${title} moved earlier.`,
                after: ({ title }) => `${title} moved later.`,
                reordered: ({ title }) => `${title} moved.`,
                toView: ({ title, view }) => `${title} moved to ${view}.`,
            },
            movePosition: ({ position, total }) => `Position ${position} of ${total}`,
            moveTargetView: ({ title }) => `Board view ${title}`,
            remove: {
                title: 'Remove this widget?',
                message: 'Everyone who can read this session loses it. Installed plugins stay installed.',
            },
        },
        note: {
            titlePlaceholder: 'Title',
            titleA11y: 'Note title',
            untitled: 'Untitled note',
            offline: 'Saving needs a connection to this Home.',
            unavailable: 'Board changes are not available on this Home yet.',
            failed: 'Happier could not save this note. Your text is still here.',
            outcomeUnknown: 'Happier could not confirm whether this note saved. Refresh before saving again.',
            saved: 'Note saved',
            conflict: {
                message: 'This note changed on another device.',
                reviewLatest: 'Review latest',
                applyMine: 'Apply my changes',
                latestHeading: 'Latest version',
            },
        },
        recovered: {
            title: 'Recovered items',
            description: 'These widgets are in this session but are not on any board view.',
            pin: 'Add to this view',
        },
        mutation: {
            conflict: 'This board changed on another device. Refresh to see the latest.',
            outcomeUnknown: 'Happier could not confirm whether that change was saved.',
            denied: 'You no longer have permission to change this board.',
            offline: 'Changing the board needs a connection to this Home.',
            unavailable: 'This Home cannot change the board yet.',
            updateRequired: 'Update Happier to make this board change.',
            hostedHtmlSourceTooLarge: 'This interactive view is too large to save. Your draft is still here.',
            noteTooLarge: 'This note is too large to save. Your text is still here.',
            invalid: 'That board change is not valid. Review it and try again.',
            notFound: 'That board item is no longer available. Refresh to see the latest board.',
            storageFailed: 'Happier could not secure that board change. Your work is still here.',
            serverFailed: 'This Home could not complete that board change. Try again.',
            failed: 'Happier could not apply that board change.',
        },
        hostedHtmlApproval: {
            title: 'Allow this interactive view?',
            body: 'Approval applies to this view in this session. Sending a message still needs you to click inside the view.',
            resources: ({ count }) => (count === 1 ? 'Can read 1 session resource' : `Can read ${count} session resources`),
            actions: ({ count }) => (count === 1 ? 'Can run 1 action' : `Can run ${count} actions`),
            sendMessages: 'Can ask Happier to send messages',
            loadsFrom: ({ origin }) => `Loads from ${origin}`,
            allow: 'Allow',
            notNow: 'Not now',
            declined: {
                title: 'Interactive view not allowed yet',
                reason: 'Review what it asks for whenever you are ready.',
                review: 'Review',
            },
        },
        sidebar: { openInDetails: 'Open in Details' },
        mobile: { searchPlaceholder: 'Search this board' },
        inline: {
            openBoard: 'Open Board',
            openBoardA11y: ({ title }) => `Open “${title}” on the board`,
        },
        companion: {
            title: 'Companion',
            empty: {
                title: 'Nothing in your Companion',
                reason: 'Keep the session summary or a board widget beside chat.',
            },
            actions: {
                addSummary: 'Add session summary',
                addItem: ({ title }) => `Add ${title}`,
                moveToLeading: 'Move to the left side',
                moveToTrailing: 'Move to the right side',
                moveToFirst: 'Move to top',
                moveToLast: 'Move to bottom',
                compact: 'Compact size',
                comfortable: 'Comfortable size',
                openFull: 'Open full companion',
                openOnBoard: 'Open on the board',
                collapse: 'Collapse companion',
                expand: 'Expand companion',
                hide: 'Hide companion',
                addToCompanion: 'Add to companion',
                removeFromCompanion: 'Remove from companion',
                undo: 'Undo',
                menuA11y: 'Companion options',
                itemMenuA11y: ({ title }) => `Options for ${title}`,
            },
            a11y: {
                headerAction: ({ count }) => `Companion, ${count} items`,
                show: ({ count }) => `Show companion, ${count} items`,
                expand: ({ count }) => `Expand companion, ${count} items`,
            },
            summary: {
                title: 'Session summary',
                untitled: 'Session',
                approvals: ({ count }) => `${count} waiting for you`,
                workflows: ({ count }) => `${count} workflows running`,
                changedFiles: ({ count }) => `${count} changed`,
                tokens: ({ count }) => `${count} tokens`,
                contextPercent: ({ percent }) => `${percent}% context`,
                contextOnly: 'Context used',
                moreDetails: 'More details',
                moreDetailsA11y: ({ count }) => `More details, ${count} more rows`,
                partial: 'Some details are not visible from here.',
            },
            notices: {
                shown: 'Companion shown',
                hidden: 'Companion hidden',
                added: 'Added to companion',
                removed: 'Removed from companion',
                reordered: 'Companion reordered',
                moved: 'Companion moved',
                boardOpened: 'Board opened by the agent',
                returnedToChat: 'Returned to Chat by the agent',
                boardViewSelected: 'Board view selected by the agent',
                boardItemRevealed: 'Board item opened by the agent',
                fullOpened: 'Companion opened by the agent',
            },
        },
    },
    de: {
        title: 'Pinnwand',
        views: {
            label: 'Pinnwand-Ansichten',
            overview: 'Übersicht',
            createTitle: 'Neue Pinnwand-Ansicht',
            renameTitle: 'Pinnwand-Ansicht umbenennen',
            reconciled: ({ title }) => `Diese Pinnwand-Ansicht wurde entfernt. ${title} wird angezeigt.`,
            empty: {
                title: 'Nichts in dieser Ansicht',
                reason: 'Füge hier ein Widget hinzu oder wechsle zu einer anderen Ansicht.',
            },
            actions: {
                create: 'Neue Ansicht',
                rename: 'Ansicht umbenennen',
                moveBefore: 'Ansicht nach vorn',
                moveAfter: 'Ansicht nach hinten',
                remove: 'Ansicht löschen',
            },
            remove: {
                title: ({ title }) => `„${title}“ löschen?`,
                moveMessage: ({ title }) => `Die Widgets wandern zu ${title}. Aus der Session wird nichts gelöscht.`,
                unpinMessage: 'Die Widgets bleiben in der Session, sind aber an keine Ansicht mehr geheftet.',
            },
        },
        add: { note: 'Notiz', interactiveView: 'Interaktive Ansicht', fromPlugins: 'Aus Plugins…' },
        picker: {
            title: 'Aus Plugins hinzufügen',
            description: 'Installierte Plugins können Widgets zu dieser Session beitragen.',
            add: 'Zum Board hinzufügen',
            empty: { title: 'Keine Plugin-Widgets verfügbar', reason: 'Installiere oder aktiviere ein Plugin, das ein Session-Widget bereitstellt.' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: 'Kompakt', medium: 'Mittel', wide: 'Breit', full: 'Volle Breite' },
        height: { auto: 'An Inhalt anpassen', compact: 'Niedrig', regular: 'Mittel', tall: 'Hoch' },
        board: {
            loading: { title: 'Pinnwand wird geöffnet', reason: 'Wir laden, was an diese Sitzung geheftet ist.' },
            locked: {
                title: 'Die Pinnwand ist noch verschlüsselt',
                reason: 'Dieses Gerät kann die Sitzung noch nicht öffnen. Es ging nichts verloren.',
            },
            unopenable: {
                title: 'Die Anordnung lässt sich nicht lesen',
                reason: 'Die gespeicherte Anordnung ließ sich nicht öffnen. Einzelne Widgets sind davon nicht betroffen.',
            },
            unsupported: {
                title: 'Diese Pinnwand braucht ein neueres Happier',
                reason: 'Alles bleibt erhalten. Öffne sie auf einem unterstützten Gerät oder aktualisiere Happier.',
            },
            unavailable: {
                title: 'Die Pinnwand ist hier noch nicht verfügbar',
                reason: 'Es ging nichts verloren. Sie erscheint, sobald dieses Home Pinnwände aktiviert.',
            },
            offline: 'Offline — du siehst den zuletzt geladenen Stand.',
            stale: 'Du siehst den zuletzt geladenen Stand.',
        },
        empty: {
            editor: {
                title: 'Füge dein erstes Widget hinzu',
                description: 'Die Pinnwand sehen alle, die diese Sitzung lesen dürfen.',
                askAgent: 'Den Agenten fragen',
                askAgentPrompt: 'Stelle etwas auf dieses Board, das Folgendes zeigt: ',
            },
            viewer: {
                title: 'Noch nichts angeheftet',
                description: 'Was Menschen oder Agenten an diese Sitzung heften, erscheint hier.',
            },
        },
        item: {
            untitled: 'Widget ohne Titel',
            renameA11y: 'Widget-Titel',
            reorderA11y: ({ title }) => `${title} neu anordnen`,
            a11yLabelWithWidth: ({ title, width }) => `${title}, ${width}`,
            menuGroups: { content: 'Lesen und bearbeiten', movement: 'Verschieben', geometry: 'Größe', destructive: 'Entfernen' },
            loading: { title: 'Widget wird geladen', reason: 'Der Inhalt wird von diesem Home geholt.' },
            locked: {
                title: 'Verschlüsselte Inhalte nicht verfügbar',
                reason: 'Dieses Widget bleibt verschlüsselt, bis dieses Gerät die Sitzung öffnen kann.',
            },
            unopenable: {
                title: 'Dieses Widget lässt sich nicht anzeigen',
                reason: 'Der gespeicherte Inhalt ließ sich nicht lesen. Der Rest der Pinnwand bleibt nutzbar.',
            },
            unsupported: {
                title: 'Dieses Widget braucht ein neueres Happier',
                reason: 'Der Inhalt bleibt erhalten. Öffne es auf einem unterstützten Gerät oder aktualisiere Happier.',
            },
            missing: {
                title: 'Dieses Widget fehlt',
                reason: 'Die Pinnwand verweist noch darauf, aber der Inhalt liegt nicht auf diesem Home.',
            },
            removed: {
                title: 'Dieses Widget wurde entfernt',
                reason: 'Jemand mit Bearbeitungsrecht hat es für alle gelöscht.',
            },
            pluginUnavailable: {
                title: 'Plugin auf diesem Gerät nicht verfügbar',
                reason: 'Das Widget bleibt erhalten. Es wird wieder angezeigt, sobald das Plugin hier verfügbar ist.',
            },
            rendererUnavailable: {
                title: 'Dieses Widget lässt sich hier nicht anzeigen',
                reason: 'Der Inhalt bleibt erhalten. Öffne es auf einem Gerät, das interaktive Ansichten unterstützt.',
            },
            provenance: {
                note: 'Notiz',
                interactiveView: 'Interaktive Ansicht',
                pluginMissing: ({ pluginId }) => `Von ${pluginId} · nicht installiert`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'Von der Pinnwand entfernen',
                openHere: 'Hier öffnen',
                managePlugin: 'Plugin verwalten',
                prepareEncryption: 'Verschlüsselung einrichten',
                readFull: 'Ganze Notiz lesen',
                rename: 'Widget umbenennen',
                unpin: 'Aus dieser Ansicht lösen',
                moveToView: ({ title }) => `Nach ${title} verschieben`,
            },
            moved: {
                before: ({ title }) => `${title} nach vorn verschoben.`,
                after: ({ title }) => `${title} nach hinten verschoben.`,
                reordered: ({ title }) => `${title} verschoben.`,
                toView: ({ title, view }) => `${title} nach ${view} verschoben.`,
            },
            movePosition: ({ position, total }) => `Position ${position} von ${total}`,
            moveTargetView: ({ title }) => `Pinnwand-Ansicht ${title}`,
            remove: {
                title: 'Dieses Widget entfernen?',
                message: 'Alle, die diese Session lesen können, verlieren es. Installierte Plugins bleiben installiert.',
            },
        },
        note: {
            titlePlaceholder: 'Titel',
            titleA11y: 'Notiztitel',
            untitled: 'Notiz ohne Titel',
            offline: 'Zum Speichern brauchst du eine Verbindung zu diesem Home.',
            unavailable: 'Änderungen an der Pinnwand sind auf diesem Home noch nicht möglich.',
            failed: 'Happier konnte diese Notiz nicht speichern. Dein Text ist noch da.',
            outcomeUnknown: 'Happier konnte nicht bestätigen, ob die Notiz gespeichert wurde. Lade neu, bevor du erneut speicherst.',
            saved: 'Notiz gespeichert',
            conflict: {
                message: 'Diese Notiz wurde auf einem anderen Gerät geändert.',
                reviewLatest: 'Neueste Fassung ansehen',
                applyMine: 'Meine Änderungen übernehmen',
                latestHeading: 'Neueste Fassung',
            },
        },
        recovered: {
            title: 'Wiederhergestellte Elemente',
            description: 'Diese Widgets gehören zur Session, liegen aber in keiner Pinnwand-Ansicht.',
            pin: 'Zu dieser Ansicht hinzufügen',
        },
        mutation: {
            conflict: 'Diese Pinnwand wurde auf einem anderen Gerät geändert. Lade neu, um den aktuellen Stand zu sehen.',
            outcomeUnknown: 'Happier konnte nicht bestätigen, ob die Änderung gespeichert wurde.',
            denied: 'Du darfst diese Pinnwand nicht mehr ändern.',
            offline: 'Änderungen an der Pinnwand brauchen eine Verbindung zu diesem Home.',
            unavailable: 'Dieses Home kann die Pinnwand noch nicht ändern.',
            updateRequired: 'Aktualisiere Happier für diese Pinnwand-Änderung.',
            hostedHtmlSourceTooLarge: 'Diese interaktive Ansicht ist zu groß zum Speichern. Dein Entwurf ist noch da.',
            noteTooLarge: 'Diese Notiz ist zu groß zum Speichern. Dein Text ist noch da.',
            invalid: 'Diese Pinnwand-Änderung ist ungültig. Prüfe sie und versuche es erneut.',
            notFound: 'Dieses Pinnwand-Element ist nicht mehr verfügbar. Lade die Pinnwand neu.',
            storageFailed: 'Happier konnte diese Pinnwand-Änderung nicht sicher speichern. Deine Arbeit ist noch da.',
            serverFailed: 'Dieses Home konnte die Pinnwand-Änderung nicht abschließen. Versuche es erneut.',
            failed: 'Happier konnte diese Pinnwand-Änderung nicht anwenden.',
        },
        hostedHtmlApproval: {
            title: 'Diese interaktive Ansicht erlauben?',
            body: 'Die Freigabe gilt für diese Ansicht in dieser Sitzung. Zum Senden einer Nachricht musst du weiterhin in die Ansicht klicken.',
            resources: ({ count }) => (count === 1 ? 'Kann 1 Sitzungsressource lesen' : `Kann ${count} Sitzungsressourcen lesen`),
            actions: ({ count }) => (count === 1 ? 'Kann 1 Aktion ausführen' : `Kann ${count} Aktionen ausführen`),
            sendMessages: 'Kann Happier bitten, Nachrichten zu senden',
            loadsFrom: ({ origin }) => `Lädt von ${origin}`,
            allow: 'Erlauben',
            notNow: 'Nicht jetzt',
            declined: {
                title: 'Interaktive Ansicht noch nicht erlaubt',
                reason: 'Sieh dir jederzeit an, was sie anfordert.',
                review: 'Prüfen',
            },
        },
        sidebar: { openInDetails: 'In den Details öffnen' },
        mobile: { searchPlaceholder: 'Dieses Board durchsuchen' },
        inline: {
            openBoard: 'Pinnwand öffnen',
            openBoardA11y: ({ title }) => `„${title}“ auf der Pinnwand öffnen`,
        },
        companion: {
            title: 'Begleiter',
            empty: {
                title: 'Nichts in deinem Begleiter',
                reason: 'Behalte die Sitzungsübersicht oder ein Pinnwand-Widget neben dem Chat.',
            },
            actions: {
                addSummary: 'Sitzungsübersicht hinzufügen',
                addItem: ({ title }) => `${title} hinzufügen`,
                moveToLeading: 'Nach links verschieben',
                moveToTrailing: 'Nach rechts verschieben',
                moveToFirst: 'Ganz nach oben verschieben',
                moveToLast: 'Ganz nach unten verschieben',
                compact: 'Kompakte Größe',
                comfortable: 'Komfortable Größe',
                openFull: 'Begleiter vollständig öffnen',
                openOnBoard: 'Auf der Pinnwand öffnen',
                collapse: 'Begleiter einklappen',
                expand: 'Begleiter ausklappen',
                hide: 'Begleiter ausblenden',
                addToCompanion: 'Zum Begleiter hinzufügen',
                removeFromCompanion: 'Aus Begleiter entfernen',
                undo: 'Rückgängig',
                menuA11y: 'Begleiter-Optionen',
                itemMenuA11y: ({ title }) => `Optionen für ${title}`,
            },
            a11y: {
                headerAction: ({ count }) => `Begleiter, ${count} Elemente`,
                show: ({ count }) => `Begleiter anzeigen, ${count} Elemente`,
                expand: ({ count }) => `Begleiter ausklappen, ${count} Elemente`,
            },
            summary: {
                title: 'Sitzungsübersicht',
                untitled: 'Sitzung',
                approvals: ({ count }) => `${count} warten auf dich`,
                workflows: ({ count }) => `${count} Workflows laufen`,
                changedFiles: ({ count }) => `${count} geändert`,
                tokens: ({ count }) => `${count} Tokens`,
                contextPercent: ({ percent }) => `${percent} % Kontext`,
                contextOnly: 'Kontext genutzt',
                moreDetails: 'Mehr Details',
                moreDetailsA11y: ({ count }) => `Mehr Details, ${count} weitere Zeilen`,
                partial: 'Einige Details sind von hier aus nicht sichtbar.',
            },
            notices: {
                shown: 'Begleiter eingeblendet',
                hidden: 'Begleiter ausgeblendet',
                added: 'Zum Begleiter hinzugefügt',
                removed: 'Aus Begleiter entfernt',
                reordered: 'Begleiter neu sortiert',
                moved: 'Begleiter verschoben',
                boardOpened: 'Pinnwand vom Agenten geöffnet',
                returnedToChat: 'Vom Agenten zum Chat zurückgekehrt',
                boardViewSelected: 'Pinnwand-Ansicht vom Agenten ausgewählt',
                boardItemRevealed: 'Pinnwand-Element vom Agenten geöffnet',
                fullOpened: 'Begleiter vom Agenten geöffnet',
            },
        },
    },
    fr: {
        title: 'Tableau',
        views: {
            label: 'Vues du tableau',
            overview: 'Vue d’ensemble',
            createTitle: 'Nouvelle vue du tableau',
            renameTitle: 'Renommer la vue du tableau',
            reconciled: ({ title }) => `Cette vue du tableau a été supprimée. Affichage de ${title}.`,
            empty: {
                title: 'Rien dans cette vue',
                reason: 'Ajoutez un widget ici, ou passez à une autre vue du tableau.',
            },
            actions: {
                create: 'Nouvelle vue',
                rename: 'Renommer la vue',
                moveBefore: 'Déplacer la vue avant',
                moveAfter: 'Déplacer la vue après',
                remove: 'Supprimer la vue',
            },
            remove: {
                title: ({ title }) => `Supprimer « ${title} » ?`,
                moveMessage: ({ title }) => `Ses widgets passent dans ${title}. Rien n’est supprimé de la session.`,
                unpinMessage: 'Ses widgets restent dans la session mais ne sont plus épinglés à une vue.',
            },
        },
        add: { note: 'Nouvelle note', interactiveView: 'Vue interactive', fromPlugins: 'Depuis les plugins…' },
        picker: {
            title: 'Ajouter depuis les plugins',
            description: 'Les plugins installés peuvent fournir des widgets à cette session.',
            add: 'Ajouter au tableau',
            empty: { title: 'Aucun widget de plugin disponible', reason: 'Installe ou active un plugin qui fournit un widget de session.' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: 'Compacte', medium: 'Moyenne', wide: 'Large', full: 'Pleine largeur' },
        height: { auto: 'Ajuster au contenu', compact: 'Basse', regular: 'Moyenne', tall: 'Haute' },
        board: {
            loading: { title: 'Ouverture du tableau', reason: 'Chargement de ce qui est épinglé à cette session.' },
            locked: {
                title: 'Le tableau est encore chiffré',
                reason: 'Cet appareil ne peut pas encore ouvrir la session. Rien n’est perdu.',
            },
            unopenable: {
                title: 'L’organisation du tableau est illisible',
                reason: 'L’organisation enregistrée n’a pas pu être ouverte. Les widgets eux-mêmes ne sont pas touchés.',
            },
            unsupported: {
                title: 'Ce tableau demande une version plus récente de Happier',
                reason: 'Tout est conservé. Ouvre-le sur un appareil compatible ou mets Happier à jour.',
            },
            unavailable: {
                title: 'Le tableau n’est pas encore disponible ici',
                reason: 'Rien n’est perdu. Il apparaîtra dès que ce Home activera les tableaux.',
            },
            offline: 'Hors ligne — tu vois la dernière version chargée.',
            stale: 'Tu vois la dernière version chargée.',
        },
        empty: {
            editor: {
                title: 'Ajoute ton premier widget',
                description: 'Le tableau est partagé avec toutes les personnes qui peuvent lire cette session.',
                askAgent: 'Demander à l’agent',
                askAgentPrompt: 'Place sur ce tableau quelque chose qui montre ',
            },
            viewer: {
                title: 'Rien sur le tableau pour l’instant',
                description: 'Ce que les personnes ou les agents épinglent à cette session apparaîtra ici.',
            },
        },
        item: {
            untitled: 'Widget sans titre',
            renameA11y: 'Titre du widget',
            reorderA11y: ({ title }) => `Réorganiser ${title}`,
            a11yLabelWithWidth: ({ title, width }) => `${title}, ${width}`,
            menuGroups: { content: 'Lire et modifier', movement: 'Déplacement', geometry: 'Taille', destructive: 'Supprimer' },
            loading: { title: 'Chargement du widget', reason: 'Récupération de son contenu depuis ce Home.' },
            locked: {
                title: 'Contenu chiffré indisponible',
                reason: 'Ce widget reste chiffré tant que cet appareil ne peut pas ouvrir la session.',
            },
            unopenable: {
                title: 'Ce widget ne peut pas être affiché',
                reason: 'Son contenu enregistré n’a pas pu être lu. Le reste du tableau reste utilisable.',
            },
            unsupported: {
                title: 'Ce widget demande une version plus récente de Happier',
                reason: 'Son contenu est conservé. Ouvre-le sur un appareil compatible ou mets Happier à jour.',
            },
            missing: {
                title: 'Ce widget est introuvable',
                reason: 'Le tableau y renvoie encore, mais son contenu n’est pas sur ce Home.',
            },
            removed: {
                title: 'Ce widget a été retiré du tableau',
                reason: 'Une personne ayant les droits d’édition l’a supprimé pour tout le monde.',
            },
            pluginUnavailable: {
                title: 'Plugin indisponible sur cet appareil',
                reason: 'Le widget est conservé. Il s’affichera de nouveau dès que le plugin sera disponible ici.',
            },
            rendererUnavailable: {
                title: 'Ce widget ne peut pas s’afficher sur cet appareil',
                reason: 'Son contenu est conservé. Ouvre-le sur un appareil qui prend en charge les vues interactives.',
            },
            provenance: {
                note: 'Note',
                interactiveView: 'Vue interactive',
                pluginMissing: ({ pluginId }) => `De ${pluginId} · non installé`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'Retirer du tableau',
                openHere: 'Ouvrir ici',
                managePlugin: 'Gérer le plugin',
                prepareEncryption: 'Configurer le chiffrement',
                readFull: 'Lire la note entière',
                rename: 'Renommer le widget',
                unpin: 'Détacher de cette vue',
                moveToView: ({ title }) => `Déplacer vers ${title}`,
            },
            moved: {
                before: ({ title }) => `${title} déplacé vers l’avant.`,
                after: ({ title }) => `${title} déplacé vers l’arrière.`,
                reordered: ({ title }) => `${title} déplacé.`,
                toView: ({ title, view }) => `${title} déplacé vers ${view}.`,
            },
            movePosition: ({ position, total }) => `Position ${position} sur ${total}`,
            moveTargetView: ({ title }) => `Vue du tableau ${title}`,
            remove: {
                title: 'Retirer ce widget ?',
                message: 'Toutes les personnes qui peuvent lire cette session le perdent. Les plugins installés restent installés.',
            },
        },
        note: {
            titlePlaceholder: 'Titre',
            titleA11y: 'Titre de la note',
            untitled: 'Note sans titre',
            offline: 'Pour enregistrer, il faut une connexion à ce Home.',
            unavailable: 'Les modifications du tableau ne sont pas encore disponibles sur ce Home.',
            failed: 'Happier n’a pas pu enregistrer cette note. Ton texte est toujours là.',
            outcomeUnknown: 'Happier n’a pas pu confirmer l’enregistrement de cette note. Actualise avant de réessayer.',
            saved: 'Note enregistrée',
            conflict: {
                message: 'Cette note a changé sur un autre appareil.',
                reviewLatest: 'Voir la dernière version',
                applyMine: 'Appliquer mes modifications',
                latestHeading: 'Dernière version',
            },
        },
        recovered: {
            title: 'Éléments récupérés',
            description: 'Ces widgets appartiennent à la session mais ne figurent dans aucune vue du tableau.',
            pin: 'Ajouter à cette vue',
        },
        mutation: {
            conflict: 'Ce tableau a changé sur un autre appareil. Actualisez pour voir la dernière version.',
            outcomeUnknown: 'Happier n’a pas pu confirmer si la modification a été enregistrée.',
            denied: 'Vous n’avez plus la permission de modifier ce tableau.',
            offline: 'Modifier le tableau nécessite une connexion à ce Home.',
            unavailable: 'Ce Home ne peut pas encore modifier le tableau.',
            updateRequired: 'Mettez Happier à jour pour appliquer cette modification.',
            hostedHtmlSourceTooLarge: 'Cette vue interactive est trop volumineuse pour être enregistrée. Votre brouillon est toujours là.',
            noteTooLarge: 'Cette note est trop volumineuse pour être enregistrée. Votre texte est toujours là.',
            invalid: 'Cette modification du tableau n’est pas valide. Vérifiez-la puis réessayez.',
            notFound: 'Cet élément n’est plus disponible. Actualisez le tableau.',
            storageFailed: 'Happier n’a pas pu sécuriser cette modification. Votre travail est toujours là.',
            serverFailed: 'Ce Home n’a pas pu terminer cette modification. Réessayez.',
            failed: 'Happier n’a pas pu appliquer cette modification du tableau.',
        },
        hostedHtmlApproval: {
            title: 'Autoriser cette vue interactive ?',
            body: 'L’autorisation s’applique à cette vue dans cette session. Pour envoyer un message, vous devez toujours cliquer dans la vue.',
            resources: ({ count }) => (count === 1 ? 'Peut lire 1 ressource de session' : `Peut lire ${count} ressources de session`),
            actions: ({ count }) => (count === 1 ? 'Peut exécuter 1 action' : `Peut exécuter ${count} actions`),
            sendMessages: 'Peut demander à Happier d’envoyer des messages',
            loadsFrom: ({ origin }) => `Charge depuis ${origin}`,
            allow: 'Autoriser',
            notNow: 'Pas maintenant',
            declined: {
                title: 'Vue interactive pas encore autorisée',
                reason: 'Consultez ce qu’elle demande quand vous le souhaitez.',
                review: 'Consulter',
            },
        },
        sidebar: { openInDetails: 'Ouvrir dans les détails' },
        mobile: { searchPlaceholder: 'Rechercher dans ce tableau' },
        inline: {
            openBoard: 'Ouvrir le tableau',
            openBoardA11y: ({ title }) => `Ouvrir « ${title} » dans le tableau`,
        },
        companion: {
            title: 'Compagnon',
            empty: {
                title: 'Rien dans votre compagnon',
                reason: 'Gardez le résumé de session ou un widget du tableau à côté du chat.',
            },
            actions: {
                addSummary: 'Ajouter le résumé de session',
                addItem: ({ title }) => `Ajouter ${title}`,
                moveToLeading: 'Déplacer vers la gauche',
                moveToTrailing: 'Déplacer vers la droite',
                moveToFirst: 'Déplacer tout en haut',
                moveToLast: 'Déplacer tout en bas',
                compact: 'Taille compacte',
                comfortable: 'Taille confortable',
                openFull: 'Ouvrir le compagnon complet',
                openOnBoard: 'Ouvrir sur le tableau',
                collapse: 'Réduire le compagnon',
                expand: 'Développer le compagnon',
                hide: 'Masquer le compagnon',
                addToCompanion: 'Ajouter au compagnon',
                removeFromCompanion: 'Retirer du compagnon',
                undo: 'Annuler',
                menuA11y: 'Options du compagnon',
                itemMenuA11y: ({ title }) => `Options pour ${title}`,
            },
            a11y: {
                headerAction: ({ count }) => `Compagnon, ${count} éléments`,
                show: ({ count }) => `Afficher le compagnon, ${count} éléments`,
                expand: ({ count }) => `Développer le compagnon, ${count} éléments`,
            },
            summary: {
                title: 'Résumé de session',
                untitled: 'Session',
                approvals: ({ count }) => `${count} en attente`,
                workflows: ({ count }) => `${count} workflows en cours`,
                changedFiles: ({ count }) => `${count} modifiés`,
                tokens: ({ count }) => `${count} jetons`,
                contextPercent: ({ percent }) => `${percent} % de contexte`,
                contextOnly: 'Contexte utilisé',
                moreDetails: 'Plus de détails',
                moreDetailsA11y: ({ count }) => `Plus de détails, ${count} lignes supplémentaires`,
                partial: 'Certains détails ne sont pas visibles ici.',
            },
            notices: {
                shown: 'Compagnon affiché',
                hidden: 'Compagnon masqué',
                added: 'Ajouté au compagnon',
                removed: 'Retiré du compagnon',
                reordered: 'Compagnon réorganisé',
                moved: 'Compagnon déplacé',
                boardOpened: 'Tableau ouvert par l’agent',
                returnedToChat: 'Retour au chat par l’agent',
                boardViewSelected: 'Vue du tableau sélectionnée par l’agent',
                boardItemRevealed: 'Élément du tableau ouvert par l’agent',
                fullOpened: 'Compagnon ouvert par l’agent',
            },
        },
    },
    ru: {
        title: 'Доска',
        views: {
            label: 'Виды доски',
            overview: 'Обзор',
            createTitle: 'Новый вид доски',
            renameTitle: 'Переименовать вид доски',
            reconciled: ({ title }) => `Этот вид доски удалён. Показан ${title}.`,
            empty: {
                title: 'В этом виде пусто',
                reason: 'Добавьте сюда виджет или перейдите к другому виду доски.',
            },
            actions: {
                create: 'Новый вид',
                rename: 'Переименовать вид',
                moveBefore: 'Переместить вид раньше',
                moveAfter: 'Переместить вид позже',
                remove: 'Удалить вид',
            },
            remove: {
                title: ({ title }) => `Удалить «${title}»?`,
                moveMessage: ({ title }) => `Его виджеты перейдут в ${title}. Из сессии ничего не удаляется.`,
                unpinMessage: 'Его виджеты останутся в сессии, но перестанут быть закреплены за видом.',
            },
        },
        add: { note: 'Заметка', interactiveView: 'Интерактивный вид', fromPlugins: 'Из плагинов…' },
        picker: {
            title: 'Добавить из плагинов',
            description: 'Установленные плагины могут добавлять виджеты в эту сессию.',
            add: 'Добавить на доску',
            empty: { title: 'Нет доступных виджетов', reason: 'Установите или включите плагин с виджетом сессии.' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: 'Узкий', medium: 'Средний', wide: 'Широкий', full: 'Во всю ширину' },
        height: { auto: 'По содержимому', compact: 'Низкая', regular: 'Средняя', tall: 'Высокая' },
        board: {
            loading: { title: 'Открываем доску', reason: 'Загружаем то, что закреплено в этой сессии.' },
            locked: {
                title: 'Доска пока зашифрована',
                reason: 'Это устройство ещё не может открыть сессию. Ничего не потеряно.',
            },
            unopenable: {
                title: 'Не удалось прочитать структуру доски',
                reason: 'Сохранённую структуру не удалось открыть. Сами виджеты не пострадали.',
            },
            unsupported: {
                title: 'Для этой доски нужна более новая версия Happier',
                reason: 'Всё сохранено. Откройте её на поддерживаемом устройстве или обновите Happier.',
            },
            unavailable: {
                title: 'Доска здесь пока недоступна',
                reason: 'Ничего не потеряно. Она появится, когда этот Home включит доски.',
            },
            offline: 'Нет сети — показана последняя загруженная версия.',
            stale: 'Показана последняя загруженная версия.',
        },
        empty: {
            editor: {
                title: 'Добавьте первый виджет',
                description: 'Доску видят все, кто может читать эту сессию.',
                askAgent: 'Попросить агента',
                askAgentPrompt: 'Разместите на этой доске то, что показывает ',
            },
            viewer: {
                title: 'На доске пока пусто',
                description: 'Здесь появится всё, что люди или агенты закрепят в этой сессии.',
            },
        },
        item: {
            untitled: 'Виджет без названия',
            renameA11y: 'Название виджета',
            reorderA11y: ({ title }) => `Переместить ${title}`,
            a11yLabelWithWidth: ({ title, width }) => `${title}, ${width}`,
            menuGroups: { content: 'Чтение и правка', movement: 'Перемещение', geometry: 'Размер', destructive: 'Удаление' },
            loading: { title: 'Загружаем виджет', reason: 'Получаем содержимое с этого Home.' },
            locked: {
                title: 'Зашифрованное содержимое недоступно',
                reason: 'Виджет остаётся зашифрованным, пока это устройство не сможет открыть сессию.',
            },
            unopenable: {
                title: 'Этот виджет нельзя показать',
                reason: 'Сохранённое содержимое не удалось прочитать. Остальная доска работает.',
            },
            unsupported: {
                title: 'Для этого виджета нужна более новая версия Happier',
                reason: 'Содержимое сохранено. Откройте его на поддерживаемом устройстве или обновите Happier.',
            },
            missing: {
                title: 'Виджет не найден',
                reason: 'Доска всё ещё ссылается на него, но содержимого нет на этом Home.',
            },
            removed: {
                title: 'Этот виджет убрали с доски',
                reason: 'Кто-то с правами на редактирование удалил его для всех.',
            },
            pluginUnavailable: {
                title: 'Плагин недоступен на этом устройстве',
                reason: 'Виджет сохранён. Он снова появится, когда плагин станет доступен здесь.',
            },
            rendererUnavailable: {
                title: 'Этот виджет нельзя показать на этом устройстве',
                reason: 'Содержимое сохранено. Откройте его там, где поддерживаются интерактивные виды.',
            },
            provenance: {
                note: 'Заметка',
                interactiveView: 'Интерактивный вид',
                pluginMissing: ({ pluginId }) => `Из ${pluginId} · не установлен`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'Убрать с доски',
                openHere: 'Открыть здесь',
                managePlugin: 'Управлять плагином',
                prepareEncryption: 'Настроить шифрование',
                readFull: 'Читать заметку целиком',
                rename: 'Переименовать виджет',
                unpin: 'Открепить от этого вида',
                moveToView: ({ title }) => `Переместить в «${title}»`,
            },
            moved: {
                before: ({ title }) => `${title} перемещён раньше.`,
                after: ({ title }) => `${title} перемещён позже.`,
                reordered: ({ title }) => `${title} перемещён.`,
                toView: ({ title, view }) => `${title} перемещён в «${view}».`,
            },
            movePosition: ({ position, total }) => `Позиция ${position} из ${total}`,
            moveTargetView: ({ title }) => `Вид доски «${title}»`,
            remove: {
                title: 'Убрать этот виджет?',
                message: 'Его потеряют все, кто может читать эту сессию. Установленные плагины останутся установленными.',
            },
        },
        note: {
            titlePlaceholder: 'Заголовок',
            titleA11y: 'Заголовок заметки',
            untitled: 'Заметка без названия',
            offline: 'Для сохранения нужна связь с этим Home.',
            unavailable: 'Изменение доски на этом Home пока недоступно.',
            failed: 'Happier не смог сохранить заметку. Ваш текст на месте.',
            outcomeUnknown: 'Happier не смог подтвердить сохранение. Обновите, прежде чем сохранять снова.',
            saved: 'Заметка сохранена',
            conflict: {
                message: 'Эту заметку изменили на другом устройстве.',
                reviewLatest: 'Посмотреть последнюю версию',
                applyMine: 'Применить мои изменения',
                latestHeading: 'Последняя версия',
            },
        },
        recovered: {
            title: 'Восстановленные элементы',
            description: 'Эти виджеты есть в сессии, но не размещены ни в одном виде доски.',
            pin: 'Добавить в этот вид',
        },
        mutation: {
            conflict: 'Доска изменилась на другом устройстве. Обновите, чтобы увидеть актуальную версию.',
            outcomeUnknown: 'Happier не смог подтвердить, сохранилось ли изменение.',
            denied: 'У вас больше нет прав изменять эту доску.',
            offline: 'Для изменения доски нужно подключение к этому Home.',
            unavailable: 'Этот Home пока не может изменять доску.',
            updateRequired: 'Обновите Happier, чтобы применить это изменение доски.',
            hostedHtmlSourceTooLarge: 'Эта интерактивная панель слишком велика для сохранения. Ваш черновик остался на месте.',
            noteTooLarge: 'Эта заметка слишком велика для сохранения. Ваш текст остался на месте.',
            invalid: 'Это изменение доски недопустимо. Проверьте его и повторите попытку.',
            notFound: 'Этот элемент доски больше недоступен. Обновите доску.',
            storageFailed: 'Happier не смог безопасно сохранить изменение. Ваша работа не потеряна.',
            serverFailed: 'Этот Home не смог завершить изменение доски. Повторите попытку.',
            failed: 'Happier не смог применить это изменение доски.',
        },
        hostedHtmlApproval: {
            title: 'Разрешить эту интерактивную панель?',
            body: 'Разрешение действует для этой панели в этой сессии. Чтобы отправить сообщение, по-прежнему нужно нажать внутри панели.',
            resources: ({ count }) => `Может читать ресурсы сессии: ${count}`,
            actions: ({ count }) => `Может выполнять действия: ${count}`,
            sendMessages: 'Может просить Happier отправлять сообщения',
            loadsFrom: ({ origin }) => `Загружает с ${origin}`,
            allow: 'Разрешить',
            notNow: 'Не сейчас',
            declined: {
                title: 'Интерактивная панель пока не разрешена',
                reason: 'Просмотрите её запросы, когда будете готовы.',
                review: 'Просмотреть',
            },
        },
        sidebar: { openInDetails: 'Открыть в деталях' },
        mobile: { searchPlaceholder: 'Поиск по этой доске' },
        inline: {
            openBoard: 'Открыть доску',
            openBoardA11y: ({ title }) => `Открыть «${title}» на доске`,
        },
        companion: {
            title: 'Спутник',
            empty: {
                title: 'В спутнике пусто',
                reason: 'Держите сводку сессии или виджет доски рядом с чатом.',
            },
            actions: {
                addSummary: 'Добавить сводку сессии',
                addItem: ({ title }) => `Добавить «${title}»`,
                moveToLeading: 'Переместить влево',
                moveToTrailing: 'Переместить вправо',
                moveToFirst: 'Переместить в начало',
                moveToLast: 'Переместить в конец',
                compact: 'Компактный размер',
                comfortable: 'Свободный размер',
                openFull: 'Открыть спутник полностью',
                openOnBoard: 'Открыть на доске',
                collapse: 'Свернуть спутник',
                expand: 'Развернуть спутник',
                hide: 'Скрыть спутник',
                addToCompanion: 'Добавить в спутник',
                removeFromCompanion: 'Убрать из спутника',
                undo: 'Отменить',
                menuA11y: 'Параметры спутника',
                itemMenuA11y: ({ title }) => `Параметры «${title}»`,
            },
            a11y: {
                headerAction: ({ count }) => `Спутник, элементов: ${count}`,
                show: ({ count }) => `Показать спутник, элементов: ${count}`,
                expand: ({ count }) => `Развернуть спутник, элементов: ${count}`,
            },
            summary: {
                title: 'Сводка сессии',
                untitled: 'Сессия',
                approvals: ({ count }) => `Ожидают вас: ${count}`,
                workflows: ({ count }) => `Выполняется процессов: ${count}`,
                changedFiles: ({ count }) => `Изменено: ${count}`,
                tokens: ({ count }) => `Токенов: ${count}`,
                contextPercent: ({ percent }) => `${percent} % контекста`,
                contextOnly: 'Контекст использован',
                moreDetails: 'Подробнее',
                moreDetailsA11y: ({ count }) => `Подробнее, ещё строк: ${count}`,
                partial: 'Некоторые сведения отсюда не видны.',
            },
            notices: {
                shown: 'Спутник показан',
                hidden: 'Спутник скрыт',
                added: 'Добавлено в спутник',
                removed: 'Убрано из спутника',
                reordered: 'Порядок в спутнике изменён',
                moved: 'Спутник перемещён',
                boardOpened: 'Доска открыта агентом',
                returnedToChat: 'Агент вернулся в чат',
                boardViewSelected: 'Агент выбрал представление доски',
                boardItemRevealed: 'Агент открыл элемент доски',
                fullOpened: 'Агент открыл спутник',
            },
        },
    },
    pl: {
        title: 'Tablica',
        views: {
            label: 'Widoki tablicy',
            overview: 'Przegląd',
            createTitle: 'Nowy widok tablicy',
            renameTitle: 'Zmień nazwę widoku tablicy',
            reconciled: ({ title }) => `Ten widok tablicy został usunięty. Pokazujemy ${title}.`,
            empty: {
                title: 'Nic w tym widoku',
                reason: 'Dodaj tu widżet albo przejdź do innego widoku tablicy.',
            },
            actions: {
                create: 'Nowy widok',
                rename: 'Zmień nazwę widoku',
                moveBefore: 'Przesuń widok wcześniej',
                moveAfter: 'Przesuń widok później',
                remove: 'Usuń widok',
            },
            remove: {
                title: ({ title }) => `Usunąć „${title}”?`,
                moveMessage: ({ title }) => `Jego widżety przejdą do ${title}. Nic nie znika z sesji.`,
                unpinMessage: 'Jego widżety zostają w sesji, ale nie są już przypięte do żadnego widoku.',
            },
        },
        add: { note: 'Notatka', interactiveView: 'Widok interaktywny', fromPlugins: 'Z wtyczek…' },
        picker: {
            title: 'Dodaj z wtyczek',
            description: 'Zainstalowane wtyczki mogą dodawać widgety do tej sesji.',
            add: 'Dodaj do tablicy',
            empty: { title: 'Brak dostępnych widgetów', reason: 'Zainstaluj lub włącz wtyczkę z widgetem sesji.' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: 'Wąski', medium: 'Średni', wide: 'Szeroki', full: 'Pełna szerokość' },
        height: { auto: 'Dopasuj do treści', compact: 'Niska', regular: 'Średnia', tall: 'Wysoka' },
        board: {
            loading: { title: 'Otwieramy tablicę', reason: 'Wczytujemy to, co przypięto do tej sesji.' },
            locked: {
                title: 'Tablica jest wciąż zaszyfrowana',
                reason: 'To urządzenie nie może jeszcze otworzyć sesji. Nic nie zginęło.',
            },
            unopenable: {
                title: 'Nie można odczytać układu tablicy',
                reason: 'Zapisanego układu nie udało się otworzyć. Same widżety są nienaruszone.',
            },
            unsupported: {
                title: 'Ta tablica wymaga nowszego Happiera',
                reason: 'Wszystko jest zachowane. Otwórz ją na obsługiwanym urządzeniu lub zaktualizuj Happiera.',
            },
            unavailable: {
                title: 'Tablica nie jest tu jeszcze dostępna',
                reason: 'Nic nie zginęło. Pojawi się, gdy ten Home włączy tablice.',
            },
            offline: 'Offline — widzisz ostatnio wczytaną wersję.',
            stale: 'Widzisz ostatnio wczytaną wersję.',
        },
        empty: {
            editor: {
                title: 'Dodaj pierwszy widżet',
                description: 'Tablicę widzi każdy, kto może czytać tę sesję.',
                askAgent: 'Poproś agenta',
                askAgentPrompt: 'Umieść na tej tablicy coś, co pokazuje ',
            },
            viewer: {
                title: 'Na tablicy jeszcze pusto',
                description: 'Pojawi się tu wszystko, co ludzie lub agenci przypną do tej sesji.',
            },
        },
        item: {
            untitled: 'Widżet bez tytułu',
            renameA11y: 'Tytuł widżetu',
            reorderA11y: ({ title }) => `Zmień kolejność: ${title}`,
            a11yLabelWithWidth: ({ title, width }) => `${title}, ${width}`,
            menuGroups: { content: 'Odczyt i edycja', movement: 'Przenoszenie', geometry: 'Rozmiar', destructive: 'Usuwanie' },
            loading: { title: 'Wczytujemy widżet', reason: 'Pobieramy jego treść z tego Home.' },
            locked: {
                title: 'Zaszyfrowana treść niedostępna',
                reason: 'Widżet pozostaje zaszyfrowany, dopóki to urządzenie nie otworzy sesji.',
            },
            unopenable: {
                title: 'Nie można pokazać tego widżetu',
                reason: 'Zapisanej treści nie udało się odczytać. Reszta tablicy działa dalej.',
            },
            unsupported: {
                title: 'Ten widżet wymaga nowszego Happiera',
                reason: 'Treść jest zachowana. Otwórz go na obsługiwanym urządzeniu lub zaktualizuj Happiera.',
            },
            missing: {
                title: 'Nie znaleziono tego widżetu',
                reason: 'Tablica wciąż na niego wskazuje, ale treści nie ma na tym Home.',
            },
            removed: {
                title: 'Ten widżet usunięto z tablicy',
                reason: 'Ktoś z prawem edycji skasował go dla wszystkich.',
            },
            pluginUnavailable: {
                title: 'Wtyczka niedostępna na tym urządzeniu',
                reason: 'Widżet jest zachowany. Wyświetli się ponownie, gdy wtyczka będzie tu dostępna.',
            },
            rendererUnavailable: {
                title: 'Tego widżetu nie da się pokazać na tym urządzeniu',
                reason: 'Treść jest zachowana. Otwórz go tam, gdzie widoki interaktywne są obsługiwane.',
            },
            provenance: {
                note: 'Notatka',
                interactiveView: 'Widok interaktywny',
                pluginMissing: ({ pluginId }) => `Z ${pluginId} · niezainstalowana`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'Usuń z tablicy',
                openHere: 'Otwórz tutaj',
                managePlugin: 'Zarządzaj wtyczką',
                prepareEncryption: 'Skonfiguruj szyfrowanie',
                readFull: 'Przeczytaj całą notatkę',
                rename: 'Zmień nazwę widżetu',
                unpin: 'Odepnij z tego widoku',
                moveToView: ({ title }) => `Przenieś do ${title}`,
            },
            moved: {
                before: ({ title }) => `${title} przeniesiono wcześniej.`,
                after: ({ title }) => `${title} przeniesiono później.`,
                reordered: ({ title }) => `${title} przeniesiono.`,
                toView: ({ title, view }) => `${title} przeniesiono do ${view}.`,
            },
            movePosition: ({ position, total }) => `Pozycja ${position} z ${total}`,
            moveTargetView: ({ title }) => `Widok tablicy ${title}`,
            remove: {
                title: 'Usunąć ten widżet?',
                message: 'Stracą go wszyscy, którzy mogą czytać tę sesję. Zainstalowane wtyczki pozostaną zainstalowane.',
            },
        },
        note: {
            titlePlaceholder: 'Tytuł',
            titleA11y: 'Tytuł notatki',
            untitled: 'Notatka bez tytułu',
            offline: 'Zapis wymaga połączenia z tym Home.',
            unavailable: 'Zmiany tablicy nie są jeszcze dostępne na tym Home.',
            failed: 'Happier nie zapisał tej notatki. Twój tekst nadal tu jest.',
            outcomeUnknown: 'Happier nie potwierdził zapisu notatki. Odśwież, zanim zapiszesz ponownie.',
            saved: 'Notatka zapisana',
            conflict: {
                message: 'Ta notatka zmieniła się na innym urządzeniu.',
                reviewLatest: 'Zobacz najnowszą wersję',
                applyMine: 'Zastosuj moje zmiany',
                latestHeading: 'Najnowsza wersja',
            },
        },
        recovered: {
            title: 'Odzyskane elementy',
            description: 'Te widżety należą do sesji, ale nie ma ich w żadnym widoku tablicy.',
            pin: 'Dodaj do tego widoku',
        },
        mutation: {
            conflict: 'Ta tablica zmieniła się na innym urządzeniu. Odśwież, aby zobaczyć najnowszą wersję.',
            outcomeUnknown: 'Happier nie potwierdził, czy zmiana została zapisana.',
            denied: 'Nie masz już uprawnień do zmiany tej tablicy.',
            offline: 'Zmiana tablicy wymaga połączenia z tym Home.',
            unavailable: 'Ten Home nie może jeszcze zmieniać tablicy.',
            updateRequired: 'Zaktualizuj Happier, aby wprowadzić tę zmianę tablicy.',
            hostedHtmlSourceTooLarge: 'Ten widok interaktywny jest zbyt duży, aby go zapisać. Twój szkic nadal tu jest.',
            noteTooLarge: 'Ta notatka jest zbyt duża, aby ją zapisać. Twój tekst nadal tu jest.',
            invalid: 'Ta zmiana tablicy jest nieprawidłowa. Sprawdź ją i spróbuj ponownie.',
            notFound: 'Ten element tablicy nie jest już dostępny. Odśwież tablicę.',
            storageFailed: 'Happier nie mógł bezpiecznie zapisać tej zmiany. Twoja praca nadal tu jest.',
            serverFailed: 'Ten Home nie mógł ukończyć zmiany tablicy. Spróbuj ponownie.',
            failed: 'Happier nie mógł zastosować tej zmiany tablicy.',
        },
        hostedHtmlApproval: {
            title: 'Zezwolić na ten widok interaktywny?',
            body: 'Zgoda dotyczy tego widoku w tej sesji. Aby wysłać wiadomość, nadal trzeba kliknąć wewnątrz widoku.',
            resources: ({ count }) => (count === 1 ? 'Może odczytać 1 zasób sesji' : `Może odczytać zasoby sesji: ${count}`),
            actions: ({ count }) => (count === 1 ? 'Może uruchomić 1 akcję' : `Może uruchomić akcje: ${count}`),
            sendMessages: 'Może poprosić Happier o wysłanie wiadomości',
            loadsFrom: ({ origin }) => `Ładuje z ${origin}`,
            allow: 'Zezwól',
            notNow: 'Nie teraz',
            declined: {
                title: 'Widok interaktywny jeszcze niedozwolony',
                reason: 'Sprawdź, o co prosi, kiedy będziesz gotowy.',
                review: 'Sprawdź',
            },
        },
        sidebar: { openInDetails: 'Otwórz w szczegółach' },
        mobile: { searchPlaceholder: 'Szukaj na tej tablicy' },
        inline: {
            openBoard: 'Otwórz tablicę',
            openBoardA11y: ({ title }) => `Otwórz „${title}” na tablicy`,
        },
        companion: {
            title: 'Towarzysz',
            empty: {
                title: 'Nic w towarzyszu',
                reason: 'Trzymaj podsumowanie sesji lub widżet tablicy obok czatu.',
            },
            actions: {
                addSummary: 'Dodaj podsumowanie sesji',
                addItem: ({ title }) => `Dodaj ${title}`,
                moveToLeading: 'Przenieś na lewą stronę',
                moveToTrailing: 'Przenieś na prawą stronę',
                moveToFirst: 'Przenieś na górę',
                moveToLast: 'Przenieś na dół',
                compact: 'Rozmiar kompaktowy',
                comfortable: 'Rozmiar wygodny',
                openFull: 'Otwórz pełnego towarzysza',
                openOnBoard: 'Otwórz na tablicy',
                collapse: 'Zwiń towarzysza',
                expand: 'Rozwiń towarzysza',
                hide: 'Ukryj towarzysza',
                addToCompanion: 'Dodaj do towarzysza',
                removeFromCompanion: 'Usuń z towarzysza',
                undo: 'Cofnij',
                menuA11y: 'Opcje towarzysza',
                itemMenuA11y: ({ title }) => `Opcje dla ${title}`,
            },
            a11y: {
                headerAction: ({ count }) => `Towarzysz, elementy: ${count}`,
                show: ({ count }) => `Pokaż towarzysza, elementy: ${count}`,
                expand: ({ count }) => `Rozwiń towarzysza, elementy: ${count}`,
            },
            summary: {
                title: 'Podsumowanie sesji',
                untitled: 'Sesja',
                approvals: ({ count }) => `Czeka na Ciebie: ${count}`,
                workflows: ({ count }) => `Trwających przepływów: ${count}`,
                changedFiles: ({ count }) => `Zmieniono: ${count}`,
                tokens: ({ count }) => `Tokeny: ${count}`,
                contextPercent: ({ percent }) => `${percent}% kontekstu`,
                contextOnly: 'Wykorzystany kontekst',
                moreDetails: 'Więcej szczegółów',
                moreDetailsA11y: ({ count }) => `Więcej szczegółów, kolejnych wierszy: ${count}`,
                partial: 'Niektóre szczegóły nie są tu widoczne.',
            },
            notices: {
                shown: 'Pokazano towarzysza',
                hidden: 'Ukryto towarzysza',
                added: 'Dodano do towarzysza',
                removed: 'Usunięto z towarzysza',
                reordered: 'Zmieniono kolejność towarzysza',
                moved: 'Przeniesiono towarzysza',
                boardOpened: 'Tablica otwarta przez agenta',
                returnedToChat: 'Agent wrócił do czatu',
                boardViewSelected: 'Agent wybrał widok tablicy',
                boardItemRevealed: 'Agent otworzył element tablicy',
                fullOpened: 'Agent otworzył towarzysza',
            },
        },
    },
    es: {
        title: 'Tablero',
        views: {
            label: 'Vistas del tablero',
            overview: 'Resumen',
            createTitle: 'Nueva vista del tablero',
            renameTitle: 'Renombrar la vista del tablero',
            reconciled: ({ title }) => `Esa vista del tablero se eliminó. Mostrando ${title}.`,
            empty: {
                title: 'Nada en esta vista',
                reason: 'Añade un widget aquí o cambia a otra vista del tablero.',
            },
            actions: {
                create: 'Nueva vista',
                rename: 'Renombrar la vista',
                moveBefore: 'Mover la vista antes',
                moveAfter: 'Mover la vista después',
                remove: 'Eliminar la vista',
            },
            remove: {
                title: ({ title }) => `¿Eliminar «${title}»?`,
                moveMessage: ({ title }) => `Sus widgets pasan a ${title}. No se elimina nada de la sesión.`,
                unpinMessage: 'Sus widgets siguen en la sesión, pero dejan de estar fijados a una vista.',
            },
        },
        add: { note: 'Nota', interactiveView: 'Vista interactiva', fromPlugins: 'Desde plugins…' },
        picker: {
            title: 'Añadir desde plugins',
            description: 'Los plugins instalados pueden aportar widgets a esta sesión.',
            add: 'Añadir al tablero',
            empty: { title: 'No hay widgets de plugins', reason: 'Instala o activa un plugin que aporte un widget de sesión.' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: 'Estrecho', medium: 'Medio', wide: 'Ancho', full: 'Ancho completo' },
        height: { auto: 'Ajustar al contenido', compact: 'Baja', regular: 'Media', tall: 'Alta' },
        board: {
            loading: { title: 'Abriendo el tablero', reason: 'Cargando lo que está fijado en esta sesión.' },
            locked: {
                title: 'El tablero sigue cifrado',
                reason: 'Este dispositivo aún no puede abrir la sesión. No se perdió nada.',
            },
            unopenable: {
                title: 'No se puede leer la organización del tablero',
                reason: 'No se pudo abrir la organización guardada. Los widgets en sí no se ven afectados.',
            },
            unsupported: {
                title: 'Este tablero necesita un Happier más reciente',
                reason: 'Todo se conserva. Ábrelo en un dispositivo compatible o actualiza Happier.',
            },
            unavailable: {
                title: 'El tablero todavía no está disponible aquí',
                reason: 'No se perdió nada. Aparecerá cuando este Home active los tableros.',
            },
            offline: 'Sin conexión: ves la última versión que cargaste.',
            stale: 'Ves la última versión que cargaste.',
        },
        empty: {
            editor: {
                title: 'Añade tu primer widget',
                description: 'El tablero lo ve todo el mundo que pueda leer esta sesión.',
                askAgent: 'Pedírselo al agente',
                askAgentPrompt: 'Coloca en este tablero algo que muestre ',
            },
            viewer: {
                title: 'Todavía no hay nada en el tablero',
                description: 'Aquí aparecerá lo que las personas o los agentes fijen en esta sesión.',
            },
        },
        item: {
            untitled: 'Widget sin título',
            renameA11y: 'Título del widget',
            reorderA11y: ({ title }) => `Reordenar ${title}`,
            a11yLabelWithWidth: ({ title, width }) => `${title}, ${width}`,
            menuGroups: { content: 'Leer y editar', movement: 'Movimiento', geometry: 'Tamaño', destructive: 'Eliminar' },
            loading: { title: 'Cargando este widget', reason: 'Obteniendo su contenido de este Home.' },
            locked: {
                title: 'Contenido cifrado no disponible',
                reason: 'Este widget seguirá cifrado hasta que este dispositivo pueda abrir la sesión.',
            },
            unopenable: {
                title: 'No se puede mostrar este widget',
                reason: 'No se pudo leer su contenido guardado. El resto del tablero sigue disponible.',
            },
            unsupported: {
                title: 'Este widget necesita un Happier más reciente',
                reason: 'Su contenido se conserva. Ábrelo en un dispositivo compatible o actualiza Happier.',
            },
            missing: {
                title: 'No se encuentra este widget',
                reason: 'El tablero sigue apuntando a él, pero su contenido no está en este Home.',
            },
            removed: {
                title: 'Este widget se quitó del tablero',
                reason: 'Alguien con permiso de edición lo borró para todo el mundo.',
            },
            pluginUnavailable: {
                title: 'Plugin no disponible en este dispositivo',
                reason: 'El widget se conserva. Volverá a mostrarse cuando el plugin esté disponible aquí.',
            },
            rendererUnavailable: {
                title: 'No se puede mostrar este widget en este dispositivo',
                reason: 'Su contenido se conserva. Ábrelo donde se admitan las vistas interactivas.',
            },
            provenance: {
                note: 'Nota',
                interactiveView: 'Vista interactiva',
                pluginMissing: ({ pluginId }) => `De ${pluginId} · no instalado`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'Quitar del tablero',
                openHere: 'Abrir aquí',
                managePlugin: 'Gestionar el plugin',
                prepareEncryption: 'Configurar el cifrado',
                readFull: 'Leer la nota completa',
                rename: 'Cambiar el nombre del widget',
                unpin: 'Quitar de esta vista',
                moveToView: ({ title }) => `Mover a ${title}`,
            },
            moved: {
                before: ({ title }) => `${title} se movió antes.`,
                after: ({ title }) => `${title} se movió después.`,
                reordered: ({ title }) => `${title} se movió.`,
                toView: ({ title, view }) => `${title} se movió a ${view}.`,
            },
            movePosition: ({ position, total }) => `Posición ${position} de ${total}`,
            moveTargetView: ({ title }) => `Vista del tablero ${title}`,
            remove: {
                title: '¿Quitar este widget?',
                message: 'Lo pierde todo el mundo que pueda leer esta sesión. Los plugins instalados siguen instalados.',
            },
        },
        note: {
            titlePlaceholder: 'Título',
            titleA11y: 'Título de la nota',
            untitled: 'Nota sin título',
            offline: 'Para guardar hace falta conexión con este Home.',
            unavailable: 'Los cambios del tablero aún no están disponibles en este Home.',
            failed: 'Happier no pudo guardar esta nota. Tu texto sigue aquí.',
            outcomeUnknown: 'Happier no pudo confirmar si la nota se guardó. Actualiza antes de volver a guardar.',
            saved: 'Nota guardada',
            conflict: {
                message: 'Esta nota cambió en otro dispositivo.',
                reviewLatest: 'Ver la última versión',
                applyMine: 'Aplicar mis cambios',
                latestHeading: 'Última versión',
            },
        },
        recovered: {
            title: 'Elementos recuperados',
            description: 'Estos widgets están en la sesión pero no en ninguna vista del tablero.',
            pin: 'Añadir a esta vista',
        },
        mutation: {
            conflict: 'Este tablero cambió en otro dispositivo. Actualiza para ver lo último.',
            outcomeUnknown: 'Happier no pudo confirmar si ese cambio se guardó.',
            denied: 'Ya no tienes permiso para cambiar este tablero.',
            offline: 'Cambiar el tablero necesita conexión con este Home.',
            unavailable: 'Este Home todavía no puede cambiar el tablero.',
            updateRequired: 'Actualiza Happier para hacer este cambio en el tablero.',
            hostedHtmlSourceTooLarge: 'Esta vista interactiva es demasiado grande para guardarla. Tu borrador sigue aquí.',
            noteTooLarge: 'Esta nota es demasiado grande para guardarla. Tu texto sigue aquí.',
            invalid: 'Ese cambio del tablero no es válido. Revísalo e inténtalo de nuevo.',
            notFound: 'Ese elemento ya no está disponible. Actualiza el tablero.',
            storageFailed: 'Happier no pudo proteger ese cambio. Tu trabajo sigue aquí.',
            serverFailed: 'Este Home no pudo completar el cambio del tablero. Inténtalo de nuevo.',
            failed: 'Happier no pudo aplicar ese cambio del tablero.',
        },
        hostedHtmlApproval: {
            title: '¿Permitir esta vista interactiva?',
            body: 'La aprobación se aplica a esta vista en esta sesión. Para enviar un mensaje sigue siendo necesario hacer clic dentro de la vista.',
            resources: ({ count }) => (count === 1 ? 'Puede leer 1 recurso de la sesión' : `Puede leer ${count} recursos de la sesión`),
            actions: ({ count }) => (count === 1 ? 'Puede ejecutar 1 acción' : `Puede ejecutar ${count} acciones`),
            sendMessages: 'Puede pedir a Happier que envíe mensajes',
            loadsFrom: ({ origin }) => `Carga desde ${origin}`,
            allow: 'Permitir',
            notNow: 'Ahora no',
            declined: {
                title: 'Vista interactiva aún no permitida',
                reason: 'Revisa lo que solicita cuando quieras.',
                review: 'Revisar',
            },
        },
        sidebar: { openInDetails: 'Abrir en Detalles' },
        mobile: { searchPlaceholder: 'Buscar en este tablero' },
        inline: {
            openBoard: 'Abrir el tablero',
            openBoardA11y: ({ title }) => `Abrir «${title}» en el tablero`,
        },
        companion: {
            title: 'Acompañante',
            empty: {
                title: 'No hay nada en tu acompañante',
                reason: 'Mantén el resumen de la sesión o un widget del tablero junto al chat.',
            },
            actions: {
                addSummary: 'Añadir resumen de la sesión',
                addItem: ({ title }) => `Añadir ${title}`,
                moveToLeading: 'Mover al lado izquierdo',
                moveToTrailing: 'Mover al lado derecho',
                moveToFirst: 'Mover al principio',
                moveToLast: 'Mover al final',
                compact: 'Tamaño compacto',
                comfortable: 'Tamaño cómodo',
                openFull: 'Abrir acompañante completo',
                openOnBoard: 'Abrir en el tablero',
                collapse: 'Contraer acompañante',
                expand: 'Expandir acompañante',
                hide: 'Ocultar acompañante',
                addToCompanion: 'Añadir al acompañante',
                removeFromCompanion: 'Quitar del acompañante',
                undo: 'Deshacer',
                menuA11y: 'Opciones del acompañante',
                itemMenuA11y: ({ title }) => `Opciones de ${title}`,
            },
            a11y: {
                headerAction: ({ count }) => `Acompañante, ${count} elementos`,
                show: ({ count }) => `Mostrar acompañante, ${count} elementos`,
                expand: ({ count }) => `Expandir acompañante, ${count} elementos`,
            },
            summary: {
                title: 'Resumen de la sesión',
                untitled: 'Sesión',
                approvals: ({ count }) => `${count} esperándote`,
                workflows: ({ count }) => `${count} flujos en curso`,
                changedFiles: ({ count }) => `${count} cambiados`,
                tokens: ({ count }) => `${count} tokens`,
                contextPercent: ({ percent }) => `${percent} % de contexto`,
                contextOnly: 'Contexto usado',
                moreDetails: 'Más detalles',
                moreDetailsA11y: ({ count }) => `Más detalles, ${count} filas más`,
                partial: 'Algunos detalles no se ven desde aquí.',
            },
            notices: {
                shown: 'Acompañante mostrado',
                hidden: 'Acompañante oculto',
                added: 'Añadido al acompañante',
                removed: 'Quitado del acompañante',
                reordered: 'Acompañante reordenado',
                moved: 'Acompañante movido',
                boardOpened: 'El agente abrió el tablero',
                returnedToChat: 'El agente volvió al chat',
                boardViewSelected: 'El agente seleccionó una vista del tablero',
                boardItemRevealed: 'El agente abrió un elemento del tablero',
                fullOpened: 'El agente abrió el acompañante',
            },
        },
    },
    it: {
        title: 'Bacheca',
        views: {
            label: 'Viste della bacheca',
            overview: 'Panoramica',
            createTitle: 'Nuova vista della bacheca',
            renameTitle: 'Rinomina la vista della bacheca',
            reconciled: ({ title }) => `Quella vista della bacheca è stata rimossa. Mostriamo ${title}.`,
            empty: {
                title: 'Niente in questa vista',
                reason: 'Aggiungi qui un widget oppure passa a un’altra vista della bacheca.',
            },
            actions: {
                create: 'Nuova vista',
                rename: 'Rinomina la vista',
                moveBefore: 'Sposta la vista prima',
                moveAfter: 'Sposta la vista dopo',
                remove: 'Elimina la vista',
            },
            remove: {
                title: ({ title }) => `Eliminare «${title}»?`,
                moveMessage: ({ title }) => `I suoi widget passano in ${title}. Dalla sessione non viene eliminato nulla.`,
                unpinMessage: 'I suoi widget restano nella sessione ma non sono più fissati a una vista.',
            },
        },
        add: { note: 'Nota', interactiveView: 'Vista interattiva', fromPlugins: 'Dai plugin…' },
        picker: {
            title: 'Aggiungi dai plugin',
            description: 'I plugin installati possono fornire widget a questa sessione.',
            add: 'Aggiungi alla board',
            empty: { title: 'Nessun widget disponibile', reason: 'Installa o abilita un plugin che fornisce un widget di sessione.' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: 'Stretto', medium: 'Medio', wide: 'Largo', full: 'Larghezza piena' },
        height: { auto: 'Adatta al contenuto', compact: 'Bassa', regular: 'Media', tall: 'Alta' },
        board: {
            loading: { title: 'Apertura della bacheca', reason: 'Carichiamo ciò che è fissato a questa sessione.' },
            locked: {
                title: 'La bacheca è ancora cifrata',
                reason: 'Questo dispositivo non può ancora aprire la sessione. Non è andato perso nulla.',
            },
            unopenable: {
                title: 'Impossibile leggere la disposizione della bacheca',
                reason: 'La disposizione salvata non si è aperta. I singoli widget non sono toccati.',
            },
            unsupported: {
                title: 'Questa bacheca richiede un Happier più recente',
                reason: 'Tutto è conservato. Aprila su un dispositivo compatibile o aggiorna Happier.',
            },
            unavailable: {
                title: 'La bacheca non è ancora disponibile qui',
                reason: 'Non è andato perso nulla. Comparirà quando questo Home abiliterà le bacheche.',
            },
            offline: 'Offline: stai vedendo l’ultima versione caricata.',
            stale: 'Stai vedendo l’ultima versione caricata.',
        },
        empty: {
            editor: {
                title: 'Aggiungi il tuo primo widget',
                description: 'La bacheca è condivisa con chiunque possa leggere questa sessione.',
                askAgent: 'Chiedi all’agente',
                askAgentPrompt: 'Metti su questa bacheca qualcosa che mostri ',
            },
            viewer: {
                title: 'Ancora niente in bacheca',
                description: 'Qui comparirà tutto ciò che persone o agenti fissano a questa sessione.',
            },
        },
        item: {
            untitled: 'Widget senza titolo',
            renameA11y: 'Titolo del widget',
            reorderA11y: ({ title }) => `Riordina ${title}`,
            a11yLabelWithWidth: ({ title, width }) => `${title}, ${width}`,
            menuGroups: { content: 'Leggi e modifica', movement: 'Spostamento', geometry: 'Dimensioni', destructive: 'Rimuovi' },
            loading: { title: 'Caricamento del widget', reason: 'Recuperiamo il contenuto da questo Home.' },
            locked: {
                title: 'Contenuto cifrato non disponibile',
                reason: 'Questo widget resta cifrato finché il dispositivo non può aprire la sessione.',
            },
            unopenable: {
                title: 'Impossibile mostrare questo widget',
                reason: 'Il contenuto salvato non è leggibile. Il resto della bacheca resta utilizzabile.',
            },
            unsupported: {
                title: 'Questo widget richiede un Happier più recente',
                reason: 'Il contenuto è conservato. Aprilo su un dispositivo compatibile o aggiorna Happier.',
            },
            missing: {
                title: 'Widget non trovato',
                reason: 'La bacheca lo indica ancora, ma il contenuto non è su questo Home.',
            },
            removed: {
                title: 'Questo widget è stato tolto dalla bacheca',
                reason: 'Qualcuno con permessi di modifica lo ha eliminato per tutti.',
            },
            pluginUnavailable: {
                title: 'Plugin non disponibile su questo dispositivo',
                reason: 'Il widget è conservato. Tornerà visibile quando il plugin sarà disponibile qui.',
            },
            rendererUnavailable: {
                title: 'Impossibile mostrare questo widget su questo dispositivo',
                reason: 'Il contenuto è conservato. Aprilo dove le viste interattive sono supportate.',
            },
            provenance: {
                note: 'Nota',
                interactiveView: 'Vista interattiva',
                pluginMissing: ({ pluginId }) => `Da ${pluginId} · non installato`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'Togli dalla bacheca',
                openHere: 'Apri qui',
                managePlugin: 'Gestisci il plugin',
                prepareEncryption: 'Configura la cifratura',
                readFull: 'Leggi tutta la nota',
                rename: 'Rinomina il widget',
                unpin: 'Togli da questa vista',
                moveToView: ({ title }) => `Sposta in ${title}`,
            },
            moved: {
                before: ({ title }) => `${title} spostato prima.`,
                after: ({ title }) => `${title} spostato dopo.`,
                reordered: ({ title }) => `${title} spostato.`,
                toView: ({ title, view }) => `${title} spostato in ${view}.`,
            },
            movePosition: ({ position, total }) => `Posizione ${position} di ${total}`,
            moveTargetView: ({ title }) => `Vista della bacheca ${title}`,
            remove: {
                title: 'Togliere questo widget?',
                message: 'Lo perde chiunque possa leggere questa sessione. I plugin installati restano installati.',
            },
        },
        note: {
            titlePlaceholder: 'Titolo',
            titleA11y: 'Titolo della nota',
            untitled: 'Nota senza titolo',
            offline: 'Per salvare serve una connessione a questo Home.',
            unavailable: 'Le modifiche alla bacheca non sono ancora disponibili su questo Home.',
            failed: 'Happier non è riuscito a salvare questa nota. Il tuo testo è ancora qui.',
            outcomeUnknown: 'Happier non ha potuto confermare il salvataggio. Aggiorna prima di salvare di nuovo.',
            saved: 'Nota salvata',
            conflict: {
                message: 'Questa nota è cambiata su un altro dispositivo.',
                reviewLatest: 'Vedi l’ultima versione',
                applyMine: 'Applica le mie modifiche',
                latestHeading: 'Ultima versione',
            },
        },
        recovered: {
            title: 'Elementi recuperati',
            description: 'Questi widget sono nella sessione ma non compaiono in nessuna vista della bacheca.',
            pin: 'Aggiungi a questa vista',
        },
        mutation: {
            conflict: 'Questa bacheca è cambiata su un altro dispositivo. Aggiorna per vedere l’ultima versione.',
            outcomeUnknown: 'Happier non ha potuto confermare se la modifica è stata salvata.',
            denied: 'Non hai più il permesso di modificare questa bacheca.',
            offline: 'Modificare la bacheca richiede una connessione a questo Home.',
            unavailable: 'Questo Home non può ancora modificare la bacheca.',
            updateRequired: 'Aggiorna Happier per applicare questa modifica alla bacheca.',
            hostedHtmlSourceTooLarge: 'Questa vista interattiva è troppo grande per essere salvata. La bozza è ancora qui.',
            noteTooLarge: 'Questa nota è troppo grande per essere salvata. Il testo è ancora qui.',
            invalid: 'Questa modifica alla bacheca non è valida. Controllala e riprova.',
            notFound: 'Questo elemento non è più disponibile. Aggiorna la bacheca.',
            storageFailed: 'Happier non ha potuto proteggere questa modifica. Il tuo lavoro è ancora qui.',
            serverFailed: 'Questo Home non ha potuto completare la modifica. Riprova.',
            failed: 'Happier non ha potuto applicare quella modifica alla bacheca.',
        },
        hostedHtmlApproval: {
            title: 'Consentire questa vista interattiva?',
            body: 'L’approvazione vale per questa vista in questa sessione. Per inviare un messaggio devi comunque fare clic nella vista.',
            resources: ({ count }) => (count === 1 ? 'Può leggere 1 risorsa della sessione' : `Può leggere ${count} risorse della sessione`),
            actions: ({ count }) => (count === 1 ? 'Può eseguire 1 azione' : `Può eseguire ${count} azioni`),
            sendMessages: 'Può chiedere a Happier di inviare messaggi',
            loadsFrom: ({ origin }) => `Carica da ${origin}`,
            allow: 'Consenti',
            notNow: 'Non ora',
            declined: {
                title: 'Vista interattiva non ancora consentita',
                reason: 'Controlla cosa richiede quando vuoi.',
                review: 'Controlla',
            },
        },
        sidebar: { openInDetails: 'Apri nei dettagli' },
        mobile: { searchPlaceholder: 'Cerca in questa bacheca' },
        inline: {
            openBoard: 'Apri la bacheca',
            openBoardA11y: ({ title }) => `Apri “${title}” nella bacheca`,
        },
        companion: {
            title: 'Compagno',
            empty: {
                title: 'Niente nel tuo compagno',
                reason: 'Tieni il riepilogo della sessione o un widget della bacheca accanto alla chat.',
            },
            actions: {
                addSummary: 'Aggiungi riepilogo sessione',
                addItem: ({ title }) => `Aggiungi ${title}`,
                moveToLeading: 'Sposta a sinistra',
                moveToTrailing: 'Sposta a destra',
                moveToFirst: 'Sposta in cima',
                moveToLast: 'Sposta in fondo',
                compact: 'Dimensione compatta',
                comfortable: 'Dimensione comoda',
                openFull: 'Apri compagno completo',
                openOnBoard: 'Apri nella bacheca',
                collapse: 'Comprimi compagno',
                expand: 'Espandi compagno',
                hide: 'Nascondi compagno',
                addToCompanion: 'Aggiungi al compagno',
                removeFromCompanion: 'Rimuovi dal compagno',
                undo: 'Annulla',
                menuA11y: 'Opzioni compagno',
                itemMenuA11y: ({ title }) => `Opzioni per ${title}`,
            },
            a11y: {
                headerAction: ({ count }) => `Compagno, ${count} elementi`,
                show: ({ count }) => `Mostra compagno, ${count} elementi`,
                expand: ({ count }) => `Espandi compagno, ${count} elementi`,
            },
            summary: {
                title: 'Riepilogo sessione',
                untitled: 'Sessione',
                approvals: ({ count }) => `${count} in attesa di te`,
                workflows: ({ count }) => `${count} flussi in corso`,
                changedFiles: ({ count }) => `${count} modificati`,
                tokens: ({ count }) => `${count} token`,
                contextPercent: ({ percent }) => `${percent}% di contesto`,
                contextOnly: 'Contesto usato',
                moreDetails: 'Altri dettagli',
                moreDetailsA11y: ({ count }) => `Altri dettagli, ${count} righe in più`,
                partial: 'Alcuni dettagli non sono visibili da qui.',
            },
            notices: {
                shown: 'Compagno mostrato',
                hidden: 'Compagno nascosto',
                added: 'Aggiunto al compagno',
                removed: 'Rimosso dal compagno',
                reordered: 'Compagno riordinato',
                moved: 'Compagno spostato',
                boardOpened: 'Bacheca aperta dall’agente',
                returnedToChat: 'L’agente è tornato alla chat',
                boardViewSelected: 'Vista della bacheca selezionata dall’agente',
                boardItemRevealed: 'Elemento della bacheca aperto dall’agente',
                fullOpened: 'Compagno aperto dall’agente',
            },
        },
    },
    pt: {
        title: 'Quadro',
        views: {
            label: 'Vistas do quadro',
            overview: 'Visão geral',
            createTitle: 'Nova vista do quadro',
            renameTitle: 'Mudar o nome da vista do quadro',
            reconciled: ({ title }) => `Essa vista do quadro foi removida. A mostrar ${title}.`,
            empty: {
                title: 'Nada nesta vista',
                reason: 'Adicione aqui um widget ou mude para outra vista do quadro.',
            },
            actions: {
                create: 'Nova vista',
                rename: 'Mudar o nome da vista',
                moveBefore: 'Mover a vista para antes',
                moveAfter: 'Mover a vista para depois',
                remove: 'Eliminar a vista',
            },
            remove: {
                title: ({ title }) => `Eliminar «${title}»?`,
                moveMessage: ({ title }) => `Os widgets passam para ${title}. Nada é eliminado da sessão.`,
                unpinMessage: 'Os widgets continuam na sessão, mas deixam de estar fixados a uma vista.',
            },
        },
        add: { note: 'Nota', interactiveView: 'Vista interativa', fromPlugins: 'Dos plugins…' },
        picker: {
            title: 'Adicionar dos plugins',
            description: 'Plugins instalados podem fornecer widgets a esta sessão.',
            add: 'Adicionar ao quadro',
            empty: { title: 'Nenhum widget disponível', reason: 'Instale ou ative um plugin que forneça um widget de sessão.' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: 'Estreito', medium: 'Médio', wide: 'Largo', full: 'Largura total' },
        height: { auto: 'Ajustar ao conteúdo', compact: 'Baixa', regular: 'Média', tall: 'Alta' },
        board: {
            loading: { title: 'A abrir o quadro', reason: 'A carregar o que está fixado nesta sessão.' },
            locked: {
                title: 'O quadro ainda está cifrado',
                reason: 'Este dispositivo ainda não consegue abrir a sessão. Nada se perdeu.',
            },
            unopenable: {
                title: 'Não é possível ler a organização do quadro',
                reason: 'A organização guardada não abriu. Os widgets em si não foram afetados.',
            },
            unsupported: {
                title: 'Este quadro precisa de um Happier mais recente',
                reason: 'Tudo fica preservado. Abre-o num dispositivo compatível ou atualiza o Happier.',
            },
            unavailable: {
                title: 'O quadro ainda não está disponível aqui',
                reason: 'Nada se perdeu. Aparece assim que este Home ativar os quadros.',
            },
            offline: 'Sem ligação — estás a ver a última versão carregada.',
            stale: 'Estás a ver a última versão carregada.',
        },
        empty: {
            editor: {
                title: 'Adiciona o teu primeiro widget',
                description: 'O quadro é partilhado com quem puder ler esta sessão.',
                askAgent: 'Pedir ao agente',
                askAgentPrompt: 'Coloca neste quadro algo que mostre ',
            },
            viewer: {
                title: 'Ainda não há nada no quadro',
                description: 'Aqui aparece tudo o que pessoas ou agentes fixarem nesta sessão.',
            },
        },
        item: {
            untitled: 'Widget sem título',
            renameA11y: 'Título do widget',
            reorderA11y: ({ title }) => `Reordenar ${title}`,
            a11yLabelWithWidth: ({ title, width }) => `${title}, ${width}`,
            menuGroups: { content: 'Ler e editar', movement: 'Mover', geometry: 'Tamanho', destructive: 'Remover' },
            loading: { title: 'A carregar este widget', reason: 'A obter o conteúdo deste Home.' },
            locked: {
                title: 'Conteúdo cifrado indisponível',
                reason: 'Este widget continua cifrado até este dispositivo conseguir abrir a sessão.',
            },
            unopenable: {
                title: 'Não é possível mostrar este widget',
                reason: 'O conteúdo guardado não pôde ser lido. O resto do quadro continua utilizável.',
            },
            unsupported: {
                title: 'Este widget precisa de um Happier mais recente',
                reason: 'O conteúdo fica preservado. Abre-o num dispositivo compatível ou atualiza o Happier.',
            },
            missing: {
                title: 'Este widget não foi encontrado',
                reason: 'O quadro ainda aponta para ele, mas o conteúdo não está neste Home.',
            },
            removed: {
                title: 'Este widget foi retirado do quadro',
                reason: 'Alguém com permissão de edição apagou-o para toda a gente.',
            },
            pluginUnavailable: {
                title: 'Plugin indisponível neste dispositivo',
                reason: 'O widget fica preservado. Volta a aparecer assim que o plugin estiver disponível aqui.',
            },
            rendererUnavailable: {
                title: 'Não é possível mostrar este widget neste dispositivo',
                reason: 'O conteúdo fica preservado. Abre-o onde as vistas interativas forem suportadas.',
            },
            provenance: {
                note: 'Nota',
                interactiveView: 'Vista interativa',
                pluginMissing: ({ pluginId }) => `De ${pluginId} · não instalado`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'Remover do quadro',
                openHere: 'Abrir aqui',
                managePlugin: 'Gerir o plugin',
                prepareEncryption: 'Configurar a cifra',
                readFull: 'Ler a nota completa',
                rename: 'Mudar o nome do widget',
                unpin: 'Desafixar desta vista',
                moveToView: ({ title }) => `Mover para ${title}`,
            },
            moved: {
                before: ({ title }) => `${title} movido para antes.`,
                after: ({ title }) => `${title} movido para depois.`,
                reordered: ({ title }) => `${title} movido.`,
                toView: ({ title, view }) => `${title} movido para ${view}.`,
            },
            movePosition: ({ position, total }) => `Posição ${position} de ${total}`,
            moveTargetView: ({ title }) => `Vista do quadro ${title}`,
            remove: {
                title: 'Remover este widget?',
                message: 'Perde-o toda a gente que possa ler esta sessão. Os plugins instalados continuam instalados.',
            },
        },
        note: {
            titlePlaceholder: 'Título',
            titleA11y: 'Título da nota',
            untitled: 'Nota sem título',
            offline: 'Para guardar é preciso ligação a este Home.',
            unavailable: 'As alterações ao quadro ainda não estão disponíveis neste Home.',
            failed: 'O Happier não conseguiu guardar esta nota. O teu texto continua aqui.',
            outcomeUnknown: 'O Happier não conseguiu confirmar se a nota foi guardada. Atualiza antes de guardar de novo.',
            saved: 'Nota guardada',
            conflict: {
                message: 'Esta nota mudou noutro dispositivo.',
                reviewLatest: 'Ver a versão mais recente',
                applyMine: 'Aplicar as minhas alterações',
                latestHeading: 'Versão mais recente',
            },
        },
        recovered: {
            title: 'Itens recuperados',
            description: 'Estes widgets estão na sessão mas não aparecem em nenhuma vista do quadro.',
            pin: 'Adicionar a esta vista',
        },
        mutation: {
            conflict: 'Este quadro mudou noutro dispositivo. Atualize para ver a versão mais recente.',
            outcomeUnknown: 'O Happier não conseguiu confirmar se a alteração foi guardada.',
            denied: 'Já não tem permissão para alterar este quadro.',
            offline: 'Alterar o quadro precisa de ligação a este Home.',
            unavailable: 'Este Home ainda não consegue alterar o quadro.',
            updateRequired: 'Atualize o Happier para fazer esta alteração ao quadro.',
            hostedHtmlSourceTooLarge: 'Esta vista interativa é demasiado grande para guardar. O seu rascunho continua aqui.',
            noteTooLarge: 'Esta nota é demasiado grande para guardar. O seu texto continua aqui.',
            invalid: 'Esta alteração ao quadro não é válida. Reveja-a e tente novamente.',
            notFound: 'Este item já não está disponível. Atualize o quadro.',
            storageFailed: 'O Happier não conseguiu proteger esta alteração. O seu trabalho continua aqui.',
            serverFailed: 'Este Home não conseguiu concluir a alteração. Tente novamente.',
            failed: 'O Happier não conseguiu aplicar essa alteração ao quadro.',
        },
        hostedHtmlApproval: {
            title: 'Permitir esta vista interativa?',
            body: 'A aprovação aplica-se a esta vista nesta sessão. Para enviar uma mensagem continua a ser preciso clicar dentro da vista.',
            resources: ({ count }) => (count === 1 ? 'Pode ler 1 recurso da sessão' : `Pode ler ${count} recursos da sessão`),
            actions: ({ count }) => (count === 1 ? 'Pode executar 1 ação' : `Pode executar ${count} ações`),
            sendMessages: 'Pode pedir ao Happier para enviar mensagens',
            loadsFrom: ({ origin }) => `Carrega de ${origin}`,
            allow: 'Permitir',
            notNow: 'Agora não',
            declined: {
                title: 'Vista interativa ainda não permitida',
                reason: 'Reveja o que ela pede quando quiser.',
                review: 'Rever',
            },
        },
        sidebar: { openInDetails: 'Abrir nos detalhes' },
        mobile: { searchPlaceholder: 'Pesquisar neste quadro' },
        inline: {
            openBoard: 'Abrir o quadro',
            openBoardA11y: ({ title }) => `Abrir “${title}” no quadro`,
        },
        companion: {
            title: 'Companheiro',
            empty: {
                title: 'Nada no seu companheiro',
                reason: 'Mantenha o resumo da sessão ou um widget do quadro ao lado do chat.',
            },
            actions: {
                addSummary: 'Adicionar resumo da sessão',
                addItem: ({ title }) => `Adicionar ${title}`,
                moveToLeading: 'Mover para o lado esquerdo',
                moveToTrailing: 'Mover para o lado direito',
                moveToFirst: 'Mover para o topo',
                moveToLast: 'Mover para o fim',
                compact: 'Tamanho compacto',
                comfortable: 'Tamanho confortável',
                openFull: 'Abrir companheiro completo',
                openOnBoard: 'Abrir no quadro',
                collapse: 'Recolher companheiro',
                expand: 'Expandir companheiro',
                hide: 'Ocultar companheiro',
                addToCompanion: 'Adicionar ao companheiro',
                removeFromCompanion: 'Remover do companheiro',
                undo: 'Desfazer',
                menuA11y: 'Opções do companheiro',
                itemMenuA11y: ({ title }) => `Opções de ${title}`,
            },
            a11y: {
                headerAction: ({ count }) => `Companheiro, ${count} itens`,
                show: ({ count }) => `Mostrar companheiro, ${count} itens`,
                expand: ({ count }) => `Expandir companheiro, ${count} itens`,
            },
            summary: {
                title: 'Resumo da sessão',
                untitled: 'Sessão',
                approvals: ({ count }) => `${count} à sua espera`,
                workflows: ({ count }) => `${count} fluxos em execução`,
                changedFiles: ({ count }) => `${count} alterados`,
                tokens: ({ count }) => `${count} tokens`,
                contextPercent: ({ percent }) => `${percent}% de contexto`,
                contextOnly: 'Contexto usado',
                moreDetails: 'Mais detalhes',
                moreDetailsA11y: ({ count }) => `Mais detalhes, mais ${count} linhas`,
                partial: 'Alguns detalhes não estão visíveis daqui.',
            },
            notices: {
                shown: 'Companheiro apresentado',
                hidden: 'Companheiro ocultado',
                added: 'Adicionado ao companheiro',
                removed: 'Removido do companheiro',
                reordered: 'Companheiro reordenado',
                moved: 'Companheiro movido',
                boardOpened: 'Quadro aberto pelo agente',
                returnedToChat: 'O agente voltou ao chat',
                boardViewSelected: 'Vista do quadro selecionada pelo agente',
                boardItemRevealed: 'Item do quadro aberto pelo agente',
                fullOpened: 'Companheiro aberto pelo agente',
            },
        },
    },
    ca: {
        title: 'Tauler',
        views: {
            label: 'Vistes del tauler',
            overview: 'Resum',
            createTitle: 'Nova vista del tauler',
            renameTitle: 'Canvia el nom de la vista del tauler',
            reconciled: ({ title }) => `Aquesta vista del tauler s’ha eliminat. Es mostra ${title}.`,
            empty: {
                title: 'Res en aquesta vista',
                reason: 'Afegeix-hi un widget o canvia a una altra vista del tauler.',
            },
            actions: {
                create: 'Nova vista',
                rename: 'Canvia el nom de la vista',
                moveBefore: 'Mou la vista abans',
                moveAfter: 'Mou la vista després',
                remove: 'Elimina la vista',
            },
            remove: {
                title: ({ title }) => `Vols eliminar «${title}»?`,
                moveMessage: ({ title }) => `Els seus widgets passen a ${title}. No s’elimina res de la sessió.`,
                unpinMessage: 'Els seus widgets continuen a la sessió, però ja no estan fixats a cap vista.',
            },
        },
        add: { note: 'Nota', interactiveView: 'Vista interactiva', fromPlugins: 'Des dels plugins…' },
        picker: {
            title: 'Afegeix des dels plugins',
            description: 'Els plugins instal·lats poden aportar widgets a aquesta sessió.',
            add: 'Afegeix al tauler',
            empty: { title: 'No hi ha cap widget disponible', reason: 'Instal·la o activa un plugin que aporti un widget de sessió.' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: 'Estret', medium: 'Mitjà', wide: 'Ample', full: 'Amplada completa' },
        height: { auto: 'Ajusta al contingut', compact: 'Baixa', regular: 'Mitjana', tall: 'Alta' },
        board: {
            loading: { title: 'Obrint el tauler', reason: 'Carregant el que hi ha fixat en aquesta sessió.' },
            locked: {
                title: 'El tauler encara està xifrat',
                reason: 'Aquest dispositiu encara no pot obrir la sessió. No s’ha perdut res.',
            },
            unopenable: {
                title: 'No es pot llegir l’organització del tauler',
                reason: 'L’organització desada no s’ha pogut obrir. Els ginys no en queden afectats.',
            },
            unsupported: {
                title: 'Aquest tauler necessita un Happier més recent',
                reason: 'Tot es conserva. Obre’l en un dispositiu compatible o actualitza el Happier.',
            },
            unavailable: {
                title: 'El tauler encara no està disponible aquí',
                reason: 'No s’ha perdut res. Apareixerà quan aquest Home activi els taulers.',
            },
            offline: 'Sense connexió: veus l’última versió que has carregat.',
            stale: 'Veus l’última versió que has carregat.',
        },
        empty: {
            editor: {
                title: 'Afegeix el teu primer giny',
                description: 'El tauler el veu tothom que pugui llegir aquesta sessió.',
                askAgent: 'Demana-ho a l’agent',
                askAgentPrompt: 'Posa en aquest tauler alguna cosa que mostri ',
            },
            viewer: {
                title: 'Encara no hi ha res al tauler',
                description: 'Aquí apareixerà tot el que les persones o els agents fixin en aquesta sessió.',
            },
        },
        item: {
            untitled: 'Giny sense títol',
            renameA11y: 'Títol del giny',
            reorderA11y: ({ title }) => `Reordena ${title}`,
            a11yLabelWithWidth: ({ title, width }) => `${title}, ${width}`,
            menuGroups: { content: 'Llegeix i edita', movement: 'Moviment', geometry: 'Mida', destructive: 'Elimina' },
            loading: { title: 'Carregant aquest giny', reason: 'Obtenint-ne el contingut d’aquest Home.' },
            locked: {
                title: 'Contingut xifrat no disponible',
                reason: 'Aquest giny continua xifrat fins que el dispositiu pugui obrir la sessió.',
            },
            unopenable: {
                title: 'No es pot mostrar aquest giny',
                reason: 'No s’ha pogut llegir el contingut desat. La resta del tauler continua disponible.',
            },
            unsupported: {
                title: 'Aquest giny necessita un Happier més recent',
                reason: 'El contingut es conserva. Obre’l en un dispositiu compatible o actualitza el Happier.',
            },
            missing: {
                title: 'No es troba aquest giny',
                reason: 'El tauler encara hi apunta, però el contingut no és en aquest Home.',
            },
            removed: {
                title: 'Aquest giny s’ha tret del tauler',
                reason: 'Algú amb permís d’edició l’ha esborrat per a tothom.',
            },
            pluginUnavailable: {
                title: 'Plugin no disponible en aquest dispositiu',
                reason: 'El giny es conserva. Tornarà a mostrar-se quan el plugin hi sigui disponible.',
            },
            rendererUnavailable: {
                title: 'No es pot mostrar aquest giny en aquest dispositiu',
                reason: 'El contingut es conserva. Obre’l on les vistes interactives siguin compatibles.',
            },
            provenance: {
                note: 'Nota',
                interactiveView: 'Vista interactiva',
                pluginMissing: ({ pluginId }) => `De ${pluginId} · no instal·lat`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'Treu del tauler',
                openHere: 'Obre aquí',
                managePlugin: 'Gestiona el plugin',
                prepareEncryption: 'Configura el xifratge',
                readFull: 'Llegeix tota la nota',
                rename: 'Canvia el nom del giny',
                unpin: 'Treu d’aquesta vista',
                moveToView: ({ title }) => `Mou a ${title}`,
            },
            moved: {
                before: ({ title }) => `${title} s’ha mogut abans.`,
                after: ({ title }) => `${title} s’ha mogut després.`,
                reordered: ({ title }) => `${title} s’ha mogut.`,
                toView: ({ title, view }) => `${title} s’ha mogut a ${view}.`,
            },
            movePosition: ({ position, total }) => `Posició ${position} de ${total}`,
            moveTargetView: ({ title }) => `Vista del tauler ${title}`,
            remove: {
                title: 'Vols treure aquest widget?',
                message: 'El perd tothom que pugui llegir aquesta sessió. Els plugins instal·lats continuen instal·lats.',
            },
        },
        note: {
            titlePlaceholder: 'Títol',
            titleA11y: 'Títol de la nota',
            untitled: 'Nota sense títol',
            offline: 'Per desar cal connexió amb aquest Home.',
            unavailable: 'Els canvis al tauler encara no estan disponibles en aquest Home.',
            failed: 'El Happier no ha pogut desar aquesta nota. El teu text continua aquí.',
            outcomeUnknown: 'El Happier no ha pogut confirmar si la nota s’ha desat. Actualitza abans de tornar-hi.',
            saved: 'Nota desada',
            conflict: {
                message: 'Aquesta nota ha canviat en un altre dispositiu.',
                reviewLatest: 'Mira l’última versió',
                applyMine: 'Aplica els meus canvis',
                latestHeading: 'Última versió',
            },
        },
        recovered: {
            title: 'Elements recuperats',
            description: 'Aquests widgets són a la sessió però no apareixen en cap vista del tauler.',
            pin: 'Afegeix a aquesta vista',
        },
        mutation: {
            conflict: 'Aquest tauler ha canviat en un altre dispositiu. Actualitza per veure’n la darrera versió.',
            outcomeUnknown: 'Happier no ha pogut confirmar si el canvi s’ha desat.',
            denied: 'Ja no tens permís per canviar aquest tauler.',
            offline: 'Canviar el tauler necessita connexió amb aquest Home.',
            unavailable: 'Aquest Home encara no pot canviar el tauler.',
            updateRequired: 'Actualitza Happier per fer aquest canvi al tauler.',
            hostedHtmlSourceTooLarge: 'Aquesta vista interactiva és massa gran per desar-la. El teu esborrany continua aquí.',
            noteTooLarge: 'Aquesta nota és massa gran per desar-la. El teu text continua aquí.',
            invalid: 'Aquest canvi al tauler no és vàlid. Revisa’l i torna-ho a provar.',
            notFound: 'Aquest element ja no està disponible. Actualitza el tauler.',
            storageFailed: 'Happier no ha pogut protegir aquest canvi. La teva feina continua aquí.',
            serverFailed: 'Aquest Home no ha pogut completar el canvi. Torna-ho a provar.',
            failed: 'Happier no ha pogut aplicar aquest canvi al tauler.',
        },
        hostedHtmlApproval: {
            title: 'Voleu permetre aquesta vista interactiva?',
            body: 'L’aprovació s’aplica a aquesta vista en aquesta sessió. Per enviar un missatge encara cal fer clic dins de la vista.',
            resources: ({ count }) => (count === 1 ? 'Pot llegir 1 recurs de la sessió' : `Pot llegir ${count} recursos de la sessió`),
            actions: ({ count }) => (count === 1 ? 'Pot executar 1 acció' : `Pot executar ${count} accions`),
            sendMessages: 'Pot demanar a Happier que enviï missatges',
            loadsFrom: ({ origin }) => `Es carrega des de ${origin}`,
            allow: 'Permet',
            notNow: 'Ara no',
            declined: {
                title: 'Vista interactiva encara no permesa',
                reason: 'Revisa què demana quan vulguis.',
                review: 'Revisa',
            },
        },
        sidebar: { openInDetails: 'Obre als detalls' },
        mobile: { searchPlaceholder: 'Cerca en aquest tauler' },
        inline: {
            openBoard: 'Obre el tauler',
            openBoardA11y: ({ title }) => `Obre «${title}» al tauler`,
        },
        companion: {
            title: 'Acompanyant',
            empty: {
                title: 'No hi ha res al teu acompanyant',
                reason: 'Mantén el resum de la sessió o un widget del tauler al costat del xat.',
            },
            actions: {
                addSummary: 'Afegeix el resum de la sessió',
                addItem: ({ title }) => `Afegeix ${title}`,
                moveToLeading: 'Mou a la banda esquerra',
                moveToTrailing: 'Mou a la banda dreta',
                moveToFirst: 'Mou al principi',
                moveToLast: 'Mou al final',
                compact: 'Mida compacta',
                comfortable: 'Mida còmoda',
                openFull: 'Obre l’acompanyant complet',
                openOnBoard: 'Obre al tauler',
                collapse: 'Replega l’acompanyant',
                expand: 'Desplega l’acompanyant',
                hide: 'Amaga l’acompanyant',
                addToCompanion: 'Afegeix a l’acompanyant',
                removeFromCompanion: 'Treu de l’acompanyant',
                undo: 'Desfés',
                menuA11y: 'Opcions de l’acompanyant',
                itemMenuA11y: ({ title }) => `Opcions per a ${title}`,
            },
            a11y: {
                headerAction: ({ count }) => `Acompanyant, ${count} elements`,
                show: ({ count }) => `Mostra l’acompanyant, ${count} elements`,
                expand: ({ count }) => `Desplega l’acompanyant, ${count} elements`,
            },
            summary: {
                title: 'Resum de la sessió',
                untitled: 'Sessió',
                approvals: ({ count }) => `${count} t’esperen`,
                workflows: ({ count }) => `${count} fluxos en curs`,
                changedFiles: ({ count }) => `${count} canviats`,
                tokens: ({ count }) => `${count} tokens`,
                contextPercent: ({ percent }) => `${percent} % de context`,
                contextOnly: 'Context utilitzat',
                moreDetails: 'Més detalls',
                moreDetailsA11y: ({ count }) => `Més detalls, ${count} files més`,
                partial: 'Alguns detalls no es veuen des d’aquí.',
            },
            notices: {
                shown: 'Acompanyant mostrat',
                hidden: 'Acompanyant amagat',
                added: 'Afegit a l’acompanyant',
                removed: 'Tret de l’acompanyant',
                reordered: 'Acompanyant reordenat',
                moved: 'Acompanyant mogut',
                boardOpened: 'L’agent ha obert el tauler',
                returnedToChat: 'L’agent ha tornat al xat',
                boardViewSelected: 'L’agent ha seleccionat una vista del tauler',
                boardItemRevealed: 'L’agent ha obert un element del tauler',
                fullOpened: 'L’agent ha obert l’acompanyant',
            },
        },
    },
    'zh-Hans': {
        title: '面板',
        views: {
            label: '面板视图',
            overview: '总览',
            createTitle: '新建面板视图',
            renameTitle: '重命名面板视图',
            reconciled: ({ title }) => `该面板视图已被删除，正在显示${title}。`,
            empty: {
                title: '此视图中暂无内容',
                reason: '在这里添加一个组件，或切换到其他面板视图。',
            },
            actions: {
                create: '新建视图',
                rename: '重命名视图',
                moveBefore: '将视图前移',
                moveAfter: '将视图后移',
                remove: '删除视图',
            },
            remove: {
                title: ({ title }) => `删除“${title}”？`,
                moveMessage: ({ title }) => `其中的组件会移到${title}。会话中不会删除任何内容。`,
                unpinMessage: '其中的组件仍留在会话中，但不再固定到任何视图。',
            },
        },
        add: { note: '笔记', interactiveView: '交互视图', fromPlugins: '来自插件…' },
        picker: {
            title: '从插件添加',
            description: '已安装的插件可为此会话提供小组件。',
            add: '添加到看板',
            empty: { title: '没有可用的插件小组件', reason: '请安装或启用提供会话小组件的插件。' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: '窄', medium: '中等', wide: '宽', full: '整行宽度' },
        height: { auto: '适应内容', compact: '较矮', regular: '中等', tall: '较高' },
        board: {
            loading: { title: '正在打开面板', reason: '正在加载这个会话固定的内容。' },
            locked: {
                title: '面板仍处于加密状态',
                reason: '这台设备还无法打开该会话。没有任何内容丢失。',
            },
            unopenable: {
                title: '无法读取面板的排列方式',
                reason: '已保存的排列方式无法打开。各个组件本身不受影响。',
            },
            unsupported: {
                title: '此面板需要更新版本的 Happier',
                reason: '内容都已保留。请在受支持的设备上打开，或更新 Happier。',
            },
            unavailable: {
                title: '这里还不能使用面板',
                reason: '没有内容丢失。等这个 Home 启用面板后就会出现。',
            },
            offline: '离线 — 显示的是你上次加载的版本。',
            stale: '显示的是你上次加载的版本。',
        },
        empty: {
            editor: {
                title: '添加第一个组件',
                description: '所有能阅读这个会话的人都会看到这个面板。',
                askAgent: '让智能体来做',
                askAgentPrompt: '在这个面板上放一个可以显示以下内容的组件：',
            },
            viewer: {
                title: '面板上还没有内容',
                description: '人或智能体固定到这个会话的内容会出现在这里。',
            },
        },
        item: {
            untitled: '未命名组件',
            renameA11y: '组件标题',
            reorderA11y: ({ title }) => `重新排序 ${title}`,
            a11yLabelWithWidth: ({ title, width }) => `${title}，${width}`,
            menuGroups: { content: '阅读和编辑', movement: '移动', geometry: '大小', destructive: '移除' },
            loading: { title: '正在加载此组件', reason: '正在从这个 Home 获取内容。' },
            locked: {
                title: '加密内容暂不可用',
                reason: '在这台设备能打开该会话之前，此组件将保持加密。',
            },
            unopenable: {
                title: '无法显示此组件',
                reason: '已保存的内容无法读取。面板的其余部分不受影响。',
            },
            unsupported: {
                title: '此组件需要更新版本的 Happier',
                reason: '内容已保留。请在受支持的设备上打开，或更新 Happier。',
            },
            missing: {
                title: '找不到此组件',
                reason: '面板仍然指向它，但内容不在这个 Home 上。',
            },
            removed: {
                title: '此组件已从面板移除',
                reason: '拥有编辑权限的人为所有人删除了它。',
            },
            pluginUnavailable: {
                title: '此设备上没有该插件',
                reason: '组件已保留。插件在这里可用后会再次显示。',
            },
            rendererUnavailable: {
                title: '此设备无法显示该组件',
                reason: '内容已保留。请在支持交互视图的设备上打开。',
            },
            provenance: {
                note: '笔记',
                interactiveView: '交互视图',
                pluginMissing: ({ pluginId }) => `来自 ${pluginId} · 未安装`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: '从面板移除',
                openHere: '在这里打开',
                managePlugin: '管理插件',
                prepareEncryption: '设置加密',
                readFull: '阅读完整笔记',
                rename: '重命名组件',
                unpin: '从此视图取消固定',
                moveToView: ({ title }) => `移动到${title}`,
            },
            moved: {
                before: ({ title }) => `${title}已前移。`,
                after: ({ title }) => `${title}已后移。`,
                reordered: ({ title }) => `${title}已移动。`,
                toView: ({ title, view }) => `${title}已移动到${view}。`,
            },
            movePosition: ({ position, total }) => `第 ${position} 项，共 ${total} 项`,
            moveTargetView: ({ title }) => `看板视图${title}`,
            remove: {
                title: '移除此组件？',
                message: '所有能阅读此会话的人都会失去它。已安装的插件仍保持安装。',
            },
        },
        note: {
            titlePlaceholder: '标题',
            titleA11y: '笔记标题',
            untitled: '未命名笔记',
            offline: '保存需要连接到这个 Home。',
            unavailable: '这个 Home 还不支持修改面板。',
            failed: 'Happier 未能保存这条笔记。你的文字还在。',
            outcomeUnknown: 'Happier 无法确认笔记是否已保存。请刷新后再保存。',
            saved: '笔记已保存',
            conflict: {
                message: '这条笔记在另一台设备上发生了改动。',
                reviewLatest: '查看最新版本',
                applyMine: '应用我的修改',
                latestHeading: '最新版本',
            },
        },
        recovered: {
            title: '已恢复的项目',
            description: '这些组件属于该会话，但没有出现在任何面板视图中。',
            pin: '添加到此视图',
        },
        mutation: {
            conflict: '此面板已在其他设备上更改。请刷新以查看最新内容。',
            outcomeUnknown: 'Happier 无法确认该更改是否已保存。',
            denied: '你已不再有权更改此面板。',
            offline: '更改面板需要连接到此 Home。',
            unavailable: '此 Home 尚无法更改面板。',
            updateRequired: '请更新 Happier 以进行此面板更改。',
            hostedHtmlSourceTooLarge: '此交互式视图太大，无法保存。你的草稿仍在这里。',
            noteTooLarge: '此笔记太大，无法保存。你的文本仍在这里。',
            invalid: '此面板更改无效。请检查后重试。',
            notFound: '此面板项目已不可用。请刷新面板。',
            storageFailed: 'Happier 无法安全保存此更改。你的内容仍在这里。',
            serverFailed: '此 Home 无法完成面板更改。请重试。',
            failed: 'Happier 无法应用该面板更改。',
        },
        hostedHtmlApproval: {
            title: '允许此交互式视图？',
            body: '此授权仅适用于此会话中的此视图。发送消息仍需要你在视图内点击。',
            resources: ({ count }) => `可读取 ${count} 个会话资源`,
            actions: ({ count }) => `可运行 ${count} 个操作`,
            sendMessages: '可请求 Happier 发送消息',
            loadsFrom: ({ origin }) => `从 ${origin} 加载`,
            allow: '允许',
            notNow: '暂不',
            declined: {
                title: '交互式视图尚未允许',
                reason: '随时可以查看它请求的权限。',
                review: '查看',
            },
        },
        sidebar: { openInDetails: '在详情中打开' },
        mobile: { searchPlaceholder: '搜索此面板' },
        inline: {
            openBoard: '打开面板',
            openBoardA11y: ({ title }) => `在面板中打开“${title}”`,
        },
        companion: {
            title: '随行面板',
            empty: {
                title: '随行面板中没有内容',
                reason: '把会话摘要或看板小组件留在聊天旁边。',
            },
            actions: {
                addSummary: '添加会话摘要',
                addItem: ({ title }) => `添加${title}`,
                moveToLeading: '移到左侧',
                moveToTrailing: '移到右侧',
                moveToFirst: '移到最前',
                moveToLast: '移到最后',
                compact: '紧凑尺寸',
                comfortable: '宽松尺寸',
                openFull: '打开完整随行面板',
                openOnBoard: '在看板中打开',
                collapse: '收起随行面板',
                expand: '展开随行面板',
                hide: '隐藏随行面板',
                addToCompanion: '添加到随行面板',
                removeFromCompanion: '从随行面板移除',
                undo: '撤销',
                menuA11y: '随行面板选项',
                itemMenuA11y: ({ title }) => `${title}的选项`,
            },
            a11y: {
                headerAction: ({ count }) => `随行面板，${count} 个项目`,
                show: ({ count }) => `显示随行面板，${count} 个项目`,
                expand: ({ count }) => `展开随行面板，${count} 个项目`,
            },
            summary: {
                title: '会话摘要',
                untitled: '会话',
                approvals: ({ count }) => `${count} 项等待你处理`,
                workflows: ({ count }) => `${count} 个工作流正在运行`,
                changedFiles: ({ count }) => `已更改 ${count} 个`,
                tokens: ({ count }) => `${count} 个令牌`,
                contextPercent: ({ percent }) => `上下文 ${percent}%`,
                contextOnly: '已用上下文',
                moreDetails: '更多详情',
                moreDetailsA11y: ({ count }) => `更多详情，另有 ${count} 行`,
                partial: '部分详情在此处无法查看。',
            },
            notices: {
                shown: '已显示随行面板',
                hidden: '已隐藏随行面板',
                added: '已添加到随行面板',
                removed: '已从随行面板移除',
                reordered: '已重新排序随行面板',
                moved: '已移动随行面板',
                boardOpened: '智能体已打开看板',
                returnedToChat: '智能体已返回聊天',
                boardViewSelected: '智能体已选择看板视图',
                boardItemRevealed: '智能体已打开看板项目',
                fullOpened: '智能体已打开随行面板',
            },
        },
    },
    'zh-Hant': {
        title: '面板',
        views: {
            label: '面板檢視',
            overview: '總覽',
            createTitle: '新增面板檢視',
            renameTitle: '重新命名面板檢視',
            reconciled: ({ title }) => `該面板檢視已被移除，正在顯示${title}。`,
            empty: {
                title: '此檢視中沒有內容',
                reason: '在這裡新增一個小工具，或切換到其他面板檢視。',
            },
            actions: {
                create: '新增檢視',
                rename: '重新命名檢視',
                moveBefore: '將檢視前移',
                moveAfter: '將檢視後移',
                remove: '刪除檢視',
            },
            remove: {
                title: ({ title }) => `刪除「${title}」？`,
                moveMessage: ({ title }) => `其中的小工具會移到${title}。工作階段中不會刪除任何內容。`,
                unpinMessage: '其中的小工具仍留在工作階段中，但不再釘選到任何檢視。',
            },
        },
        add: { note: '筆記', interactiveView: '互動檢視', fromPlugins: '來自外掛…' },
        picker: {
            title: '從外掛新增',
            description: '已安裝的外掛可為此對話提供小元件。',
            add: '新增至看板',
            empty: { title: '沒有可用的外掛小元件', reason: '請安裝或啟用提供對話小元件的外掛。' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: '窄', medium: '中等', wide: '寬', full: '整行寬度' },
        height: { auto: '符合內容', compact: '較矮', regular: '中等', tall: '較高' },
        board: {
            loading: { title: '正在開啟面板', reason: '正在載入這個工作階段釘選的內容。' },
            locked: {
                title: '面板仍處於加密狀態',
                reason: '這台裝置還無法開啟這個工作階段。沒有任何內容遺失。',
            },
            unopenable: {
                title: '無法讀取面板的排列方式',
                reason: '已儲存的排列方式無法開啟。各個小工具本身不受影響。',
            },
            unsupported: {
                title: '此面板需要較新版本的 Happier',
                reason: '內容都已保留。請在支援的裝置上開啟，或更新 Happier。',
            },
            unavailable: {
                title: '這裡還無法使用面板',
                reason: '沒有內容遺失。等這個 Home 啟用面板後就會出現。',
            },
            offline: '離線 — 顯示的是你上次載入的版本。',
            stale: '顯示的是你上次載入的版本。',
        },
        empty: {
            editor: {
                title: '加入第一個小工具',
                description: '所有能閱讀這個工作階段的人都會看到這個面板。',
                askAgent: '請代理人處理',
                askAgentPrompt: '在這個看板上放一個可以顯示以下內容的元件：',
            },
            viewer: {
                title: '面板上還沒有內容',
                description: '人或代理人釘選到這個工作階段的內容會出現在這裡。',
            },
        },
        item: {
            untitled: '未命名小工具',
            renameA11y: '小工具標題',
            reorderA11y: ({ title }) => `重新排序 ${title}`,
            a11yLabelWithWidth: ({ title, width }) => `${title}，${width}`,
            menuGroups: { content: '閱讀和編輯', movement: '移動', geometry: '大小', destructive: '移除' },
            loading: { title: '正在載入這個小工具', reason: '正在從這個 Home 取得內容。' },
            locked: {
                title: '加密內容暫時無法使用',
                reason: '在這台裝置能開啟工作階段之前，這個小工具會維持加密。',
            },
            unopenable: {
                title: '無法顯示這個小工具',
                reason: '已儲存的內容無法讀取。面板的其他部分不受影響。',
            },
            unsupported: {
                title: '這個小工具需要較新版本的 Happier',
                reason: '內容已保留。請在支援的裝置上開啟，或更新 Happier。',
            },
            missing: {
                title: '找不到這個小工具',
                reason: '面板仍指向它，但內容不在這個 Home 上。',
            },
            removed: {
                title: '這個小工具已從面板移除',
                reason: '有編輯權限的人為所有人刪除了它。',
            },
            pluginUnavailable: {
                title: '這台裝置上沒有該外掛',
                reason: '小工具已保留。外掛在這裡可用後會再次顯示。',
            },
            rendererUnavailable: {
                title: '這台裝置無法顯示這個小工具',
                reason: '內容已保留。請在支援互動檢視的裝置上開啟。',
            },
            provenance: {
                note: '筆記',
                interactiveView: '互動檢視',
                pluginMissing: ({ pluginId }) => `來自 ${pluginId} · 未安裝`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: '從面板移除',
                openHere: '在這裡開啟',
                managePlugin: '管理外掛',
                prepareEncryption: '設定加密',
                readFull: '閱讀完整筆記',
                rename: '重新命名小工具',
                unpin: '從此檢視取消釘選',
                moveToView: ({ title }) => `移動到${title}`,
            },
            moved: {
                before: ({ title }) => `${title}已往前移動。`,
                after: ({ title }) => `${title}已往後移動。`,
                reordered: ({ title }) => `${title}已移動。`,
                toView: ({ title, view }) => `${title}已移動到${view}。`,
            },
            movePosition: ({ position, total }) => `第 ${position} 項，共 ${total} 項`,
            moveTargetView: ({ title }) => `看板檢視${title}`,
            remove: {
                title: '移除此小工具？',
                message: '所有能閱讀此工作階段的人都會失去它。已安裝的外掛仍保持安裝。',
            },
        },
        note: {
            titlePlaceholder: '標題',
            titleA11y: '筆記標題',
            untitled: '未命名筆記',
            offline: '儲存需要連線到這個 Home。',
            unavailable: '這個 Home 還不支援修改面板。',
            failed: 'Happier 無法儲存這則筆記。你的文字還在。',
            outcomeUnknown: 'Happier 無法確認筆記是否已儲存。請重新整理後再儲存。',
            saved: '筆記已儲存',
            conflict: {
                message: '這則筆記在另一台裝置上有變動。',
                reviewLatest: '查看最新版本',
                applyMine: '套用我的變更',
                latestHeading: '最新版本',
            },
        },
        recovered: {
            title: '已復原的項目',
            description: '這些小工具屬於此工作階段，但沒有出現在任何面板檢視中。',
            pin: '加入此檢視',
        },
        mutation: {
            conflict: '此面板已在其他裝置上變更。請重新整理以查看最新內容。',
            outcomeUnknown: 'Happier 無法確認該變更是否已儲存。',
            denied: '你已不再有權變更此面板。',
            offline: '變更面板需要連線到此 Home。',
            unavailable: '此 Home 尚無法變更面板。',
            updateRequired: '請更新 Happier 以進行此面板變更。',
            hostedHtmlSourceTooLarge: '此互動式檢視太大，無法儲存。你的草稿仍在這裡。',
            noteTooLarge: '此筆記太大，無法儲存。你的文字仍在這裡。',
            invalid: '此面板變更無效。請檢查後再試一次。',
            notFound: '此面板項目已無法使用。請重新整理面板。',
            storageFailed: 'Happier 無法安全儲存此變更。你的內容仍在這裡。',
            serverFailed: '此 Home 無法完成面板變更。請再試一次。',
            failed: 'Happier 無法套用該面板變更。',
        },
        hostedHtmlApproval: {
            title: '允許此互動式檢視？',
            body: '此授權僅適用於此工作階段中的此檢視。傳送訊息仍需要你在檢視內點選。',
            resources: ({ count }) => `可讀取 ${count} 個工作階段資源`,
            actions: ({ count }) => `可執行 ${count} 個動作`,
            sendMessages: '可請求 Happier 傳送訊息',
            loadsFrom: ({ origin }) => `從 ${origin} 載入`,
            allow: '允許',
            notNow: '暫不',
            declined: {
                title: '互動式檢視尚未允許',
                reason: '隨時可以查看它要求的權限。',
                review: '查看',
            },
        },
        sidebar: { openInDetails: '在詳細資料中開啟' },
        mobile: { searchPlaceholder: '搜尋此面板' },
        inline: {
            openBoard: '開啟面板',
            openBoardA11y: ({ title }) => `在面板中開啟「${title}」`,
        },
        companion: {
            title: '隨行面板',
            empty: {
                title: '隨行面板中沒有內容',
                reason: '把工作階段摘要或看板小工具留在聊天旁邊。',
            },
            actions: {
                addSummary: '新增工作階段摘要',
                addItem: ({ title }) => `新增${title}`,
                moveToLeading: '移到左側',
                moveToTrailing: '移到右側',
                moveToFirst: '移到最前',
                moveToLast: '移到最後',
                compact: '精簡尺寸',
                comfortable: '寬鬆尺寸',
                openFull: '開啟完整隨行面板',
                openOnBoard: '在看板中開啟',
                collapse: '收合隨行面板',
                expand: '展開隨行面板',
                hide: '隱藏隨行面板',
                addToCompanion: '加入隨行面板',
                removeFromCompanion: '從隨行面板移除',
                undo: '復原',
                menuA11y: '隨行面板選項',
                itemMenuA11y: ({ title }) => `${title}的選項`,
            },
            a11y: {
                headerAction: ({ count }) => `隨行面板，${count} 個項目`,
                show: ({ count }) => `顯示隨行面板，${count} 個項目`,
                expand: ({ count }) => `展開隨行面板，${count} 個項目`,
            },
            summary: {
                title: '工作階段摘要',
                untitled: '工作階段',
                approvals: ({ count }) => `${count} 項等待你處理`,
                workflows: ({ count }) => `${count} 個工作流程執行中`,
                changedFiles: ({ count }) => `已變更 ${count} 個`,
                tokens: ({ count }) => `${count} 個權杖`,
                contextPercent: ({ percent }) => `脈絡 ${percent}%`,
                contextOnly: '已用脈絡',
                moreDetails: '更多詳細資料',
                moreDetailsA11y: ({ count }) => `更多詳細資料，另有 ${count} 列`,
                partial: '部分詳細資料在此處無法檢視。',
            },
            notices: {
                shown: '已顯示隨行面板',
                hidden: '已隱藏隨行面板',
                added: '已加入隨行面板',
                removed: '已從隨行面板移除',
                reordered: '已重新排序隨行面板',
                moved: '已移動隨行面板',
                boardOpened: '代理已開啟看板',
                returnedToChat: '代理已返回聊天',
                boardViewSelected: '代理已選擇看板檢視',
                boardItemRevealed: '代理已開啟看板項目',
                fullOpened: '代理已開啟隨行面板',
            },
        },
    },
    ja: {
        title: 'ボード',
        views: {
            label: 'ボードのビュー',
            overview: '概要',
            createTitle: '新しいボードのビュー',
            renameTitle: 'ボードのビュー名を変更',
            reconciled: ({ title }) => `そのボードのビューは削除されました。${title}を表示しています。`,
            empty: {
                title: 'このビューには何もありません',
                reason: 'ここにウィジェットを追加するか、別のボードのビューに切り替えてください。',
            },
            actions: {
                create: '新しいビュー',
                rename: 'ビュー名を変更',
                moveBefore: 'ビューを前へ',
                moveAfter: 'ビューを後ろへ',
                remove: 'ビューを削除',
            },
            remove: {
                title: ({ title }) => `「${title}」を削除しますか？`,
                moveMessage: ({ title }) => `ウィジェットは${title}へ移動します。セッションからは何も削除されません。`,
                unpinMessage: 'ウィジェットはセッションに残りますが、どのビューにも固定されなくなります。',
            },
        },
        add: { note: 'メモ', interactiveView: 'インタラクティブビュー', fromPlugins: 'プラグインから…' },
        picker: {
            title: 'プラグインから追加',
            description: 'インストール済みのプラグインはこのセッションにウィジェットを提供できます。',
            add: 'ボードに追加',
            empty: { title: '利用できるウィジェットがありません', reason: 'セッションウィジェットを提供するプラグインをインストールまたは有効化してください。' },
            qualified: ({ plugin, pluginId }) => `${plugin} (${pluginId})`,
        },
        width: { compact: '狭い', medium: '中くらい', wide: '広い', full: '全幅' },
        height: { auto: '内容に合わせる', compact: '低め', regular: '標準', tall: '高め' },
        board: {
            loading: { title: 'ボードを開いています', reason: 'このセッションにピン留めされたものを読み込んでいます。' },
            locked: {
                title: 'ボードはまだ暗号化されています',
                reason: 'この端末ではまだセッションを開けません。失われたものはありません。',
            },
            unopenable: {
                title: 'ボードの並びを読み取れません',
                reason: '保存された並びを開けませんでした。ウィジェット自体には影響しません。',
            },
            unsupported: {
                title: 'このボードには新しい Happier が必要です',
                reason: '内容はそのまま残ります。対応した端末で開くか、Happier を更新してください。',
            },
            unavailable: {
                title: 'ここではまだボードを使えません',
                reason: '失われたものはありません。この Home がボードを有効にすると表示されます。',
            },
            offline: 'オフライン — 最後に読み込んだ状態を表示しています。',
            stale: '最後に読み込んだ状態を表示しています。',
        },
        empty: {
            editor: {
                title: '最初のウィジェットを追加しましょう',
                description: 'ボードは、このセッションを読める人全員に共有されます。',
                askAgent: 'エージェントに頼む',
                askAgentPrompt: 'このボードに次の内容を表示するものを置いて：',
            },
            viewer: {
                title: 'ボードにはまだ何もありません',
                description: '人やエージェントがこのセッションにピン留めしたものがここに並びます。',
            },
        },
        item: {
            untitled: '無題のウィジェット',
            renameA11y: 'ウィジェットのタイトル',
            reorderA11y: ({ title }) => `${title} を並べ替え`,
            a11yLabelWithWidth: ({ title, width }) => `${title}、${width}`,
            menuGroups: { content: '閲覧と編集', movement: '移動', geometry: 'サイズ', destructive: '削除' },
            loading: { title: 'ウィジェットを読み込み中', reason: 'この Home から内容を取得しています。' },
            locked: {
                title: '暗号化された内容は表示できません',
                reason: 'この端末がセッションを開けるようになるまで、このウィジェットは暗号化されたままです。',
            },
            unopenable: {
                title: 'このウィジェットは表示できません',
                reason: '保存された内容を読み取れませんでした。ボードの他の部分はそのまま使えます。',
            },
            unsupported: {
                title: 'このウィジェットには新しい Happier が必要です',
                reason: '内容は残っています。対応した端末で開くか、Happier を更新してください。',
            },
            missing: {
                title: 'このウィジェットが見つかりません',
                reason: 'ボードはまだ参照していますが、内容はこの Home にありません。',
            },
            removed: {
                title: 'このウィジェットはボードから削除されました',
                reason: '編集権限のある人が全員のために削除しました。',
            },
            pluginUnavailable: {
                title: 'この端末ではプラグインを利用できません',
                reason: 'ウィジェットは残っています。プラグインが使えるようになれば再び表示されます。',
            },
            rendererUnavailable: {
                title: 'この端末ではこのウィジェットを表示できません',
                reason: '内容は残っています。インタラクティブビューに対応した端末で開いてください。',
            },
            provenance: {
                note: 'メモ',
                interactiveView: 'インタラクティブビュー',
                pluginMissing: ({ pluginId }) => `${pluginId} · 未インストール`,
                pluginSurface: ({ plugin, surface }) => `${surface} · ${plugin}`,
                pluginQualified: ({ label, pluginId }) => `${label} (${pluginId})`,
            },
            actions: {
                remove: 'ボードから削除',
                openHere: 'ここで開く',
                managePlugin: 'プラグインを管理',
                prepareEncryption: '暗号化を設定',
                readFull: 'メモ全文を読む',
                rename: 'ウィジェットの名前を変更',
                unpin: 'このビューから外す',
                moveToView: ({ title }) => `${title}に移動`,
            },
            moved: {
                before: ({ title }) => `${title}を前に移動しました。`,
                after: ({ title }) => `${title}を後ろに移動しました。`,
                reordered: ({ title }) => `${title}を移動しました。`,
                toView: ({ title, view }) => `${title}を${view}に移動しました。`,
            },
            movePosition: ({ position, total }) => `${total} 件中 ${position} 件目`,
            moveTargetView: ({ title }) => `ボードビュー${title}`,
            remove: {
                title: 'このウィジェットを削除しますか？',
                message: 'このセッションを読めるすべての人がこれを失います。インストール済みのプラグインはそのまま残ります。',
            },
        },
        note: {
            titlePlaceholder: 'タイトル',
            titleA11y: 'メモのタイトル',
            untitled: '無題のメモ',
            offline: '保存にはこの Home への接続が必要です。',
            unavailable: 'この Home ではまだボードを変更できません。',
            failed: 'Happier はこのメモを保存できませんでした。入力した内容は残っています。',
            outcomeUnknown: '保存できたかどうかを確認できませんでした。再保存の前に読み込み直してください。',
            saved: 'メモを保存しました',
            conflict: {
                message: 'このメモは別の端末で変更されました。',
                reviewLatest: '最新版を確認',
                applyMine: '自分の変更を適用',
                latestHeading: '最新版',
            },
        },
        recovered: {
            title: '復元された項目',
            description: 'これらのウィジェットはこのセッションにありますが、どのボードのビューにも配置されていません。',
            pin: 'このビューに追加',
        },
        mutation: {
            conflict: 'このボードは別の端末で変更されました。最新の内容は読み込み直してください。',
            outcomeUnknown: 'その変更が保存されたかどうかを確認できませんでした。',
            denied: 'このボードを変更する権限がなくなりました。',
            offline: 'ボードの変更にはこの Home への接続が必要です。',
            unavailable: 'この Home ではまだボードを変更できません。',
            updateRequired: 'このボードの変更を行うには Happier を更新してください。',
            hostedHtmlSourceTooLarge: 'このインタラクティブビューは大きすぎて保存できません。下書きはそのまま残っています。',
            noteTooLarge: 'このノートは大きすぎて保存できません。テキストはそのまま残っています。',
            invalid: 'このボードの変更は無効です。確認してからもう一度お試しください。',
            notFound: 'このボード項目は利用できなくなりました。ボードを再読み込みしてください。',
            storageFailed: 'この変更を安全に保存できませんでした。作業内容はそのまま残っています。',
            serverFailed: 'この Home ではボードの変更を完了できませんでした。もう一度お試しください。',
            failed: 'Happier はそのボードの変更を適用できませんでした。',
        },
        hostedHtmlApproval: {
            title: 'このインタラクティブビューを許可しますか？',
            body: 'この許可はこのセッションのこのビューにのみ適用されます。メッセージを送るには、引き続きビュー内をクリックする必要があります。',
            resources: ({ count }) => `セッションのリソースを${count}件読み取れます`,
            actions: ({ count }) => `アクションを${count}件実行できます`,
            sendMessages: 'Happier にメッセージの送信を依頼できます',
            loadsFrom: ({ origin }) => `${origin} から読み込みます`,
            allow: '許可',
            notNow: '今はしない',
            declined: {
                title: 'インタラクティブビューはまだ許可されていません',
                reason: '要求内容はいつでも確認できます。',
                review: '確認',
            },
        },
        sidebar: { openInDetails: '詳細で開く' },
        mobile: { searchPlaceholder: 'このボードを検索' },
        inline: {
            openBoard: 'ボードを開く',
            openBoardA11y: ({ title }) => `ボードで「${title}」を開く`,
        },
        companion: {
            title: 'コンパニオン',
            empty: {
                title: 'コンパニオンには何もありません',
                reason: 'セッション概要やボードのウィジェットをチャットの横に置いておけます。',
            },
            actions: {
                addSummary: 'セッション概要を追加',
                addItem: ({ title }) => `${title}を追加`,
                moveToLeading: '左側に移動',
                moveToTrailing: '右側に移動',
                moveToFirst: '先頭に移動',
                moveToLast: '末尾に移動',
                compact: 'コンパクト表示',
                comfortable: 'ゆったり表示',
                openFull: 'コンパニオン全体を開く',
                openOnBoard: 'ボードで開く',
                collapse: 'コンパニオンを折りたたむ',
                expand: 'コンパニオンを展開',
                hide: 'コンパニオンを隠す',
                addToCompanion: 'コンパニオンに追加',
                removeFromCompanion: 'コンパニオンから削除',
                undo: '元に戻す',
                menuA11y: 'コンパニオンのオプション',
                itemMenuA11y: ({ title }) => `${title}のオプション`,
            },
            a11y: {
                headerAction: ({ count }) => `コンパニオン、${count} 件`,
                show: ({ count }) => `コンパニオンを表示、${count} 件`,
                expand: ({ count }) => `コンパニオンを展開、${count} 件`,
            },
            summary: {
                title: 'セッション概要',
                untitled: 'セッション',
                approvals: ({ count }) => `${count} 件があなたを待っています`,
                workflows: ({ count }) => `${count} 件のワークフローが実行中`,
                changedFiles: ({ count }) => `${count} 件変更`,
                tokens: ({ count }) => `${count} トークン`,
                contextPercent: ({ percent }) => `コンテキスト ${percent}%`,
                contextOnly: '使用中のコンテキスト',
                moreDetails: '詳細を表示',
                moreDetailsA11y: ({ count }) => `詳細を表示、他 ${count} 行`,
                partial: 'ここからは見えない情報があります。',
            },
            notices: {
                shown: 'コンパニオンを表示しました',
                hidden: 'コンパニオンを非表示にしました',
                added: 'コンパニオンに追加しました',
                removed: 'コンパニオンから削除しました',
                reordered: 'コンパニオンを並べ替えました',
                moved: 'コンパニオンを移動しました',
                boardOpened: 'エージェントがボードを開きました',
                returnedToChat: 'エージェントがチャットに戻りました',
                boardViewSelected: 'エージェントがボードビューを選択しました',
                boardItemRevealed: 'エージェントがボード項目を開きました',
                fullOpened: 'エージェントがコンパニオンを開きました',
            },
        },
    },
} as const satisfies Readonly<Record<string, SessionBoardTranslation>>;
