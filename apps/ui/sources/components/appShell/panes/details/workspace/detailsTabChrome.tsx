import * as React from 'react';

/**
 * What a tab's content tells the strip about itself: today only that it holds unsaved edits (a
 * file being edited). The content is the only owner of that fact; the strip draws it.
 */
export type DetailsTabChromeApi = Readonly<{
    setUnsaved: (unsaved: boolean) => void;
}>;

const NOOP_CHROME: DetailsTabChromeApi = { setUnsaved: () => {} };

const DetailsTabChromeContext = React.createContext<DetailsTabChromeApi>(NOOP_CHROME);

export function DetailsTabChromeProvider(props: Readonly<{ value: DetailsTabChromeApi; children: React.ReactNode }>) {
    return <DetailsTabChromeContext.Provider value={props.value}>{props.children}</DetailsTabChromeContext.Provider>;
}

/** Outside a Details tab (a full-screen file route) the report goes nowhere. */
export function useDetailsTabChrome(): DetailsTabChromeApi {
    return React.useContext(DetailsTabChromeContext);
}

/**
 * The group's record of unsaved tabs. It changes only when a tab's fact flips, so the strip
 * re-renders on an edit's first keystroke and on save, never per keystroke.
 */
export function useDetailsTabUnsavedKeys(): Readonly<{
    unsavedKeys: ReadonlySet<string>;
    chromeFor: (tabKey: string) => DetailsTabChromeApi;
}> {
    const [unsavedKeys, setUnsavedKeys] = React.useState<ReadonlySet<string>>(() => new Set());
    const chromeByKeyRef = React.useRef(new Map<string, DetailsTabChromeApi>());
    const chromeFor = React.useCallback((tabKey: string): DetailsTabChromeApi => {
        const existing = chromeByKeyRef.current.get(tabKey);
        if (existing) return existing;
        const chrome: DetailsTabChromeApi = {
            setUnsaved: (unsaved) => {
                setUnsavedKeys((current) => {
                    if (current.has(tabKey) === unsaved) return current;
                    const next = new Set(current);
                    if (unsaved) next.add(tabKey);
                    else next.delete(tabKey);
                    return next;
                });
            },
        };
        chromeByKeyRef.current.set(tabKey, chrome);
        return chrome;
    }, []);
    return { unsavedKeys, chromeFor };
}
