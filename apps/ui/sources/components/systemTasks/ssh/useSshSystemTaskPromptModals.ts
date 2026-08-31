import * as React from 'react';

import { buildSshHostKeyPromptBody } from '@/components/ssh/buildSshHostKeyPromptBody';
import { Modal } from '@/modal';
import { t, tLoose } from '@/text';

import type { SystemTaskRunState, SystemTaskRunner } from '../types';
import type { SystemTaskPromptEnvelope } from '../prompts/readLatestSystemTaskPrompt';

function personalHomeCopy(key: string, fallback: string): string {
    const translationKey = `personalHome.settings.${key}`;
    const value = tLoose(translationKey);
    return value === translationKey ? fallback : value;
}

export function useSshSystemTaskPromptModals(params: Readonly<{
    runner: SystemTaskRunner;
    taskId: string | null;
    snapshot: SystemTaskRunState | null;
    prompt: SystemTaskPromptEnvelope | null;
}>): void {
    const handledPromptRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        const taskId = params.taskId;
        const prompt = params.prompt;
        if (!taskId || !prompt || params.snapshot?.result) return;
        const promptId = prompt.data && typeof prompt.data === 'object' && !Array.isArray(prompt.data)
            && typeof (prompt.data as { promptId?: unknown }).promptId === 'string'
            ? (prompt.data as { promptId: string }).promptId
            : '';
        const promptKey = promptId
            ? `${taskId}:${prompt.kind}:${promptId}`
            : `${taskId}:${prompt.kind}:${JSON.stringify(prompt.data)}`;
        if (handledPromptRef.current === promptKey) return;
        handledPromptRef.current = promptKey;

        if (prompt.kind === 'personal_home.confirm_remote_erase.v1') {
            void (async () => {
                const rawPaths = Array.isArray(prompt.data.paths) ? prompt.data.paths : [];
                const paths = rawPaths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
                const canonicalServerUrl = typeof prompt.data.canonicalServerUrl === 'string'
                    ? prompt.data.canonicalServerUrl.trim()
                    : '';
                const homeServerIdentityId = prompt.data.homeServerIdentityId === null
                    || (typeof prompt.data.homeServerIdentityId === 'string'
                        && prompt.data.homeServerIdentityId.trim().length > 0)
                    ? prompt.data.homeServerIdentityId
                    : undefined;
                const estimatedBytes = prompt.data.estimatedBytes;
                const factsAreExact = canonicalServerUrl.length > 0
                    && homeServerIdentityId !== undefined
                    && paths.length > 0
                    && paths.length === rawPaths.length
                    && (estimatedBytes === null
                        || (typeof estimatedBytes === 'number' && Number.isFinite(estimatedBytes) && estimatedBytes >= 0));
                if (!factsAreExact) {
                    await params.runner.respond(taskId, { confirmed: false }).catch(() => {});
                    return;
                }
                const accepted = await Modal.confirm(
                    prompt.message || personalHomeCopy('eraseDataTitle', 'Delete Personal Home data?'),
                    [
                        `${personalHomeCopy('canonicalServerUrl', 'Home URL')}: ${canonicalServerUrl}`,
                        `${personalHomeCopy('identityTitle', 'Home identity')}: ${homeServerIdentityId || personalHomeCopy('notAvailable', 'Not available')}`,
                        `${personalHomeCopy('estimatedSize', 'Estimated size')}: ${estimatedBytes === null ? personalHomeCopy('unknownSize', 'Unknown size') : String(estimatedBytes)}`,
                        '',
                        personalHomeCopy('eraseDataBody', 'This permanently deletes only the owner-validated Home paths below:'),
                        ...paths.map((path) => `• ${path}`),
                    ].join('\n'),
                    {
                        destructive: true,
                        confirmText: personalHomeCopy('eraseDataAction', 'Delete Personal Home data'),
                        cancelText: t('common.cancel'),
                    },
                );
                await params.runner.respond(taskId, { confirmed: accepted });
            })();
            return;
        }

        if (prompt.kind === 'ssh.trustHost' || prompt.kind === 'ssh.replaceHostKey') {
            void (async () => {
                const fingerprint = typeof prompt.data.fingerprint === 'string' ? prompt.data.fingerprint.trim() : '';
                const existingFingerprint = typeof prompt.data.existingFingerprint === 'string'
                    ? prompt.data.existingFingerprint.trim()
                    : '';
                const host = typeof prompt.data.host === 'string' ? prompt.data.host.trim() : '';
                const isReplacement = prompt.kind === 'ssh.replaceHostKey';
                const accepted = await Modal.confirm(
                    isReplacement
                        ? t('settings.remoteHostsReplaceHostKeyTitle')
                        : t('settings.remoteHostsHostTrustTitle'),
                    buildSshHostKeyPromptBody({
                        host,
                        fingerprint,
                        existingFingerprint: isReplacement ? existingFingerprint : null,
                    }),
                    {
                        confirmText: isReplacement
                            ? t('settings.remoteHostsReplaceHostKeyAction')
                            : t('setupOnboarding.remoteSshChecklist.trustHostTitle'),
                        cancelText: t('common.cancel'),
                    },
                );
                if (!accepted) {
                    await params.runner.cancel(taskId).catch(() => {});
                    return;
                }
                const remember = isReplacement
                    ? true
                    : await Modal.confirm(
                        t('settings.remoteHostsRememberHostKeyTitle'),
                        host || undefined,
                        {
                            confirmText: t('settings.remoteHostsRememberHostKeyAction'),
                            cancelText: t('settings.remoteHostsTrustOnceAction'),
                        },
                    );
                await params.runner.respond(taskId, {
                    trusted: true,
                    ...(remember ? { remember: true } : {}),
                });
            })();
            return;
        }

        if (prompt.kind === 'ssh.privateKeyPassphrase') {
            void (async () => {
                const host = typeof prompt.data.host === 'string' ? prompt.data.host.trim() : '';
                const passphrase = await Modal.prompt(
                    t('settings.remoteHostsPrivateKeyPassphraseTitle'),
                    host || undefined,
                    { inputType: 'secure-text', confirmText: t('common.continue'), cancelText: t('common.cancel') },
                );
                if (passphrase == null) {
                    await params.runner.cancel(taskId).catch(() => {});
                    return;
                }
                await params.runner.respond(taskId, { passphrase });
            })();
            return;
        }

        if (prompt.kind === 'ssh.keyboardInteractive') {
            void (async () => {
                const rawPrompts = Array.isArray(prompt.data.prompts) ? prompt.data.prompts : [];
                const answers: Array<{ id: string; value: string }> = [];
                for (const rawPrompt of rawPrompts) {
                    if (!rawPrompt || typeof rawPrompt !== 'object' || Array.isArray(rawPrompt)) {
                        continue;
                    }
                    const entry = rawPrompt as Record<string, unknown>;
                    const id = typeof entry.id === 'string' ? entry.id : String(answers.length);
                    const label = typeof entry.label === 'string' && entry.label.trim()
                        ? entry.label.trim()
                        : t('settings.remoteHostsKeyboardInteractivePromptLabel');
                    const echo = entry.echo === true;
                    const value = await Modal.prompt(
                        label,
                        t('settings.remoteHostsKeyboardInteractiveTitle'),
                        {
                            inputType: echo ? 'default' : 'secure-text',
                            confirmText: t('common.continue'),
                            cancelText: t('common.cancel'),
                        },
                    );
                    if (value == null) {
                        await params.runner.cancel(taskId).catch(() => {});
                        return;
                    }
                    answers.push({ id, value });
                }
                await params.runner.respond(taskId, { keyboardInteractiveAnswers: answers });
            })();
            return;
        }

        if (prompt.kind === 'ssh.password') {
            void (async () => {
                const password = await Modal.prompt(
                    prompt.message || t('settings.remoteHostsPasswordRequiredTitle'),
                    undefined,
                    { inputType: 'secure-text', confirmText: t('common.continue'), cancelText: t('common.cancel') },
                );
                if (password == null) {
                    await params.runner.cancel(taskId).catch(() => {});
                    return;
                }
                await params.runner.respond(taskId, { password });
            })();
            return;
        }

        if (prompt.kind === 'auth.approveRemoteProvisioning') {
            void (async () => {
                const accepted = await Modal.confirm(
                    prompt.message || t('common.info'),
                    undefined,
                    { confirmText: t('common.continue'), cancelText: t('common.cancel') },
                );
                if (!accepted) {
                    await params.runner.cancel(taskId).catch(() => {});
                    return;
                }
                await params.runner.respond(taskId, { approved: true });
            })();
            return;
        }

        if (prompt.kind === 'daemon.replaceRemoteBackgroundServices') {
            void (async () => {
                const accepted = await Modal.confirm(
                    prompt.message || t('common.info'),
                    undefined,
                    { confirmText: t('common.continue'), cancelText: t('common.cancel') },
                );
                if (!accepted) {
                    await params.runner.respond(taskId, { replaceExistingServices: false }).catch(() => {});
                    return;
                }
                await params.runner.respond(taskId, { replaceExistingServices: true });
            })();
        }
    }, [params.runner, params.prompt, params.snapshot?.result, params.taskId]);
}
