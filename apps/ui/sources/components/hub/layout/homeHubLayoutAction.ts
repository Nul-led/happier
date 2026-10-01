import {
    HomeHubLayoutUpdateInputSchema,
    type ActionExecutorDeps,
    type HomeHubLayoutIntent,
} from '@happier-dev/protocol';

import {
    applyHomeHubLayoutIntent,
    homeHubWidgetSectionId,
    listHiddenHomeSetupSteps,
    resolveHomeHubLayout,
    type HomeHubBuiltinDefinition,
    type HomeHubLayoutValue,
    type HomeHubWidgetInput,
} from './homeHubLayout';

type LayoutPort = Readonly<{
    builtins: readonly HomeHubBuiltinDefinition[];
    /** The invocation's Account must be the one whose Home/widget owner is mounted here. */
    isClientTargetCurrent: () => boolean;
    readWidgets: () => readonly HomeHubWidgetInput[];
    read: () => Promise<HomeHubLayoutValue>;
    mutate: (update: (current: HomeHubLayoutValue) => HomeHubLayoutValue) => Promise<void>;
}>;

class HomeHubActionError extends Error {
    constructor(readonly code: string) {
        super(code);
    }
}

function invalidIntentCode(layout: HomeHubLayoutValue, port: LayoutPort, widgets: readonly HomeHubWidgetInput[], intent: HomeHubLayoutIntent): string | null {
    const sections = resolveHomeHubLayout(layout, port.builtins, widgets).sections;
    if (intent.kind === 'move' || intent.kind === 'visibility' || intent.kind === 'frameStyle') {
        const exists = port.builtins.some((section) => section.id === intent.sectionId)
            || widgets.some((widget) => homeHubWidgetSectionId(widget.key) === intent.sectionId);
        return exists ? null : 'home_hub_section_not_found';
    }
    if (intent.kind === 'reorder') {
        const ids = new Set(intent.sectionIds);
        if (ids.size !== sections.length || intent.sectionIds.length !== sections.length
            || sections.some((section) => !ids.has(section.id))) return 'home_hub_order_incomplete';
    }
    return null;
}

/** Adapts Account persistence only; Customize's existing domain owner makes every layout decision. */
export function createHomeHubLayoutAction(port: LayoutPort): NonNullable<ActionExecutorDeps['homeHubLayoutAction']> {
    const execute: NonNullable<ActionExecutorDeps['homeHubLayoutAction']> = async ({ actionId, input, signal }) => {
        const assertCurrent = () => {
            signal?.throwIfAborted();
            if (!port.isClientTargetCurrent()) {
                throw new HomeHubActionError('action_target_client_mismatch');
            }
        };
        assertCurrent();
        const widgets = port.readWidgets();
        let layout = await port.read();
        assertCurrent();
        if (actionId === 'home.hub.layout.update') {
            const { intent } = HomeHubLayoutUpdateInputSchema.parse(input);
            const errorCode = invalidIntentCode(layout, port, widgets, intent);
            if (errorCode) return { ok: false, errorCode, error: errorCode };
            await port.mutate((current) => {
                assertCurrent();
                // CAS replay revalidates against the latest settings, not the earlier read.
                const code = invalidIntentCode(current, port, widgets, intent);
                if (code) throw new HomeHubActionError(code);
                layout = applyHomeHubLayoutIntent(current, port.builtins, widgets, intent);
                return layout;
            });
            assertCurrent();
        }
        const resolved = resolveHomeHubLayout(layout, port.builtins, widgets);
        return {
            layout: { ...layout, order: [...layout.order], hidden: [...layout.hidden] },
            sections: resolved.sections.map(({ id, kind, hidden, hideable, frameStyle }) => ({ id, kind, hidden, hideable, ...(frameStyle ? { frameStyle } : {}) })),
            availableWidgetIds: resolved.available.map((widget) => homeHubWidgetSectionId(widget.key)),
            hiddenSetupStepIds: listHiddenHomeSetupSteps(layout),
        };
    };
    return async (args) => {
        try {
            return await execute(args);
        } catch (error) {
            if (error instanceof HomeHubActionError) return { ok: false, errorCode: error.code, error: error.message };
            throw error;
        }
    };
}
