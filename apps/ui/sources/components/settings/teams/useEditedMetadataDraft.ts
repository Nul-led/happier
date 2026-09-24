import * as React from 'react';

/**
 * One editable name/description draft over a projection that keeps moving.
 *
 * The Home's answer is authoritative, but a refresh — a point read, an
 * Account-change wake, somebody else's rename — must never erase what the person
 * is typing. A pristine editor follows the published values; an edited one keeps
 * its draft and reports a conflict, which is resolved by one deliberate
 * acknowledgement rather than by silently choosing a winner.
 *
 * This is the Team identity section's own behaviour, extracted so the Group
 * metadata section consumes the same decision instead of re-implementing form
 * state. Validation stays with each caller: a Team and a Group are validated by
 * their own canonical owners, and this holds no opinion about either.
 */
export type EditedMetadataDraft = Readonly<{
    name: string;
    description: string;
    setName: (next: string) => void;
    setDescription: (next: string) => void;
    /** The published values moved while this draft was edited. */
    conflict: boolean;
    /** Keep the draft, but accept what is published now as its basis. */
    acceptPublished: () => void;
    /** Abandon the draft and return to the published values. */
    reset: () => void;
    /** Re-base on the values the Home answered a successful write with. */
    commit: (published: Readonly<{ name: string; description: string }>) => void;
}>;

export function useEditedMetadataDraft(published: Readonly<{
    name: string;
    description: string;
}>): EditedMetadataDraft {
    const publishedName = published.name;
    const publishedDescription = published.description;
    const [name, setName] = React.useState(publishedName);
    const [description, setDescription] = React.useState(publishedDescription);
    const [baseline, setBaseline] = React.useState(() => Object.freeze({
        name: publishedName,
        description: publishedDescription,
    }));
    const [conflict, setConflict] = React.useState(false);

    React.useEffect(() => {
        if (publishedName === baseline.name && publishedDescription === baseline.description) return;
        const pristine = name === baseline.name && description === baseline.description;
        const draftIsPublished = name === publishedName && description === publishedDescription;
        if (pristine || draftIsPublished) {
            setName(publishedName);
            setDescription(publishedDescription);
            setBaseline(Object.freeze({ name: publishedName, description: publishedDescription }));
            setConflict(false);
            return;
        }
        setConflict(true);
    }, [baseline, description, name, publishedDescription, publishedName]);

    const acceptPublished = React.useCallback(() => {
        setBaseline(Object.freeze({ name: publishedName, description: publishedDescription }));
        setConflict(false);
    }, [publishedDescription, publishedName]);

    const reset = React.useCallback(() => {
        setName(publishedName);
        setDescription(publishedDescription);
        setBaseline(Object.freeze({ name: publishedName, description: publishedDescription }));
        setConflict(false);
    }, [publishedDescription, publishedName]);

    const commit = React.useCallback((next: Readonly<{ name: string; description: string }>) => {
        setBaseline(Object.freeze({ name: next.name, description: next.description }));
        setConflict(false);
    }, []);

    return React.useMemo(() => Object.freeze({
        name,
        description,
        setName,
        setDescription,
        conflict,
        acceptPublished,
        reset,
        commit,
    }), [acceptPublished, commit, conflict, description, name, reset]);
}
