import { normalizeCommitRef, runScmCommand } from '../runtime.js';

type TreeEntry = Readonly<{ mode: string; type: string; oid: string; name: string }>;

export type PullRequestTemplateResult =
    | Readonly<{ kind: 'ready'; body?: string }>
    | Readonly<{ kind: 'needs_input'; error: string }>;

/** Reads only conventional template locations in an immutable committed base tree.
 * The managed SCM command owner supplies the output/resource bound; this reader
 * adds no file-size cap and never reads the working tree or follows a symlink.
 */
export async function readPullRequestTemplate(input: Readonly<{
    cwd: string;
    base: string;
    remoteName?: string | null;
    providerKind: string;
}>): Promise<PullRequestTemplateResult> {
    if (input.providerKind !== 'github' && input.providerKind !== 'gitlab') return { kind: 'ready' };
    const normalized = normalizeCommitRef(input.base);
    if (!normalized.ok) return { kind: 'needs_input', error: normalized.error };
    const remote = input.remoteName ? normalizeCommitRef(input.remoteName) : null;
    const refs = [
        ...(remote?.ok ? [`refs/remotes/${remote.commit}/${normalized.commit}`] : []),
        `refs/heads/${normalized.commit}`,
        normalized.commit,
    ];
    let baseOid: string | null = null;
    for (const ref of refs) {
        const result = await runScmCommand({ bin: 'git', cwd: input.cwd, args: ['rev-parse', '--verify', `${ref}^{commit}`] });
        if (result.success && /^[a-f0-9]{40,64}$/i.test(result.stdout.trim())) { baseOid = result.stdout.trim(); break; }
    }
    if (!baseOid) return { kind: 'needs_input', error: 'Fetch the pull request base branch or supply an explicit description.' };

    async function readTree(oid: string): Promise<readonly TreeEntry[] | null> {
        const result = await runScmCommand({ bin: 'git', cwd: input.cwd, args: ['ls-tree', '-z', oid] });
        if (!result.success) return null;
        const entries: TreeEntry[] = [];
        for (const row of result.stdout.split('\0').filter(Boolean)) {
            const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/i.exec(row);
            if (!match) return null;
            entries.push({ mode: match[1], type: match[2], oid: match[3], name: match[4] });
        }
        return entries;
    }
    const root = await readTree(baseOid);
    if (!root) return { kind: 'needs_input', error: 'The committed pull request template tree could not be read.' };
    const candidates: TreeEntry[] = [];
    let unreadable = false;
    async function addGithubLocation(entries: readonly TreeEntry[]) {
        candidates.push(...entries.filter((entry) => /^pull_request_template\.(md|txt)$/i.test(entry.name)));
        for (const directory of entries.filter((entry) => /^pull_request_template$/i.test(entry.name))) {
            if (directory.type !== 'tree') { unreadable = true; continue; }
            const templates = await readTree(directory.oid);
            if (!templates) { unreadable = true; continue; }
            candidates.push(...templates.filter((entry) => /\.(md|txt)$/i.test(entry.name)));
        }
    }
    if (input.providerKind === 'github') {
        await addGithubLocation(root);
        for (const directory of root.filter((entry) => entry.name === '.github' || entry.name === 'docs')) {
            if (directory.type !== 'tree') { unreadable = true; continue; }
            const entries = await readTree(directory.oid);
            if (!entries) { unreadable = true; continue; }
            await addGithubLocation(entries);
        }
    } else {
        const gitlab = root.find((entry) => entry.name === '.gitlab');
        if (gitlab) {
            if (gitlab.type !== 'tree') unreadable = true;
            else {
                const entries = await readTree(gitlab.oid);
                const directory = entries?.find((entry) => entry.name === 'merge_request_templates');
                if (!entries || (directory && directory.type !== 'tree')) unreadable = true;
                else if (directory) {
                    const templates = await readTree(directory.oid);
                    if (!templates) unreadable = true;
                    else {
                        const markdown = templates.filter((entry) => /\.md$/i.test(entry.name));
                        const defaults = markdown.filter((entry) => entry.name === 'Default.md');
                        candidates.push(...(defaults.length > 0 ? defaults : markdown));
                    }
                }
            }
        }
    }
    if (unreadable) return { kind: 'needs_input', error: 'The committed pull request template location is not a readable tree.' };
    if (candidates.length === 0) return { kind: 'ready' };
    if (candidates.length > 1) return { kind: 'needs_input', error: 'Choose a pull request template and supply its description explicitly.' };
    const template = candidates[0];
    if (template.type !== 'blob' || (template.mode !== '100644' && template.mode !== '100755')) {
        return { kind: 'needs_input', error: 'The committed pull request template must be a regular text file.' };
    }
    const blob = await runScmCommand({ bin: 'git', cwd: input.cwd, args: ['cat-file', 'blob', template.oid] });
    if (!blob.success || blob.stdout.includes('\0')) return { kind: 'needs_input', error: 'The committed pull request template could not be read as text.' };
    return { kind: 'ready', body: blob.stdout };
}
