import { describe, expect, it } from 'vitest';

import { sessionCollaborationTranslations } from '@/text/translations/sessionCollaborationTranslations';
import { buildSessionDiscussionRowAccessibilityLabel, buildSessionDiscussionRowMeta } from './SessionDiscussionRow';

describe('buildSessionDiscussionRowMeta', () => {
    it('keeps unread and total counts distinct while preserving producer provenance', () => {
        expect(buildSessionDiscussionRowMeta({
            unreadCount: 2,
            unreadMentionCount: 1,
            messageCount: 7,
            producedByAgent: true,
            relativeTime: '4m',
            labels: {
                unread: (count) => `${count} unread`,
                mentions: (count) => `${count} mention`,
                messages: (count) => `${count} messages`,
                viaAgent: 'Via Agent',
                collaborator: 'Collaborator',
            },
        })).toEqual(['1 mention', '2 unread', '7 messages', 'Via Agent', '4m']);
    });

    it('omits empty attention and time facts without inventing a replacement', () => {
        expect(buildSessionDiscussionRowMeta({
            unreadCount: 0,
            unreadMentionCount: 0,
            messageCount: 1,
            producedByAgent: false,
            relativeTime: '',
            labels: {
                unread: (count) => `${count} unread`,
                mentions: (count) => `${count} mentions`,
                messages: (count) => `${count} message`,
                viaAgent: 'Via Agent',
                collaborator: 'Collaborator',
            },
        })).toEqual(['1 message', 'Collaborator']);
    });

    it('uses the localized semantic unread-mention label in visual and spoken metadata', () => {
        const visualMeta = buildSessionDiscussionRowMeta({
            unreadCount: 0,
            unreadMentionCount: 1,
            messageCount: 3,
            producedByAgent: false,
            relativeTime: '2m',
            labels: {
                unread: (count) => `${count} unread`,
                mentions: (count) => count === 1 ? '1 unread mention' : `${count} unread mentions`,
                messages: (count) => `${count} messages`,
                viaAgent: 'Via Agent',
                collaborator: 'Collaborator',
            },
        });

        expect(visualMeta).toContain('1 unread mention');
        expect(buildSessionDiscussionRowAccessibilityLabel({
            title: 'Authentication review',
            visualMeta,
            unreadMentionCount: 1,
            mentionLabel: (count) => count === 1 ? '1 unread mention' : `${count} unread mentions`,
        })).toBe('Authentication review. 1 unread mention, 3 messages, Collaborator, 2m');
    });

    it('provides a semantic unread-mention label for every supported locale', () => {
        for (const translations of Object.values(sessionCollaborationTranslations)) {
            const label = translations.discussion.unreadMentionCount({ count: 2 });
            expect(label).toContain('2');
            expect(label).not.toBe('@2');
        }
    });
});
