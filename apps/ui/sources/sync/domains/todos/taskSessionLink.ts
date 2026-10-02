import { storage } from '@/sync/domains/state/storage';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { applyTodoSessionLinkIntent, TodoSessionLinkError, type TodoSessionLinkIntent } from './todoOps';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { TodoItem } from './todoStoredContent';

export interface TaskSessionLink extends ServerAccountScope {
    sessionId: string;
    title: string;
    linkedAt: number;
}

/** The acceptance adapter; todoOps owns persistence, CAS and Account fencing. */
export async function linkTaskToSession(intent: TodoSessionLinkIntent): Promise<void> {
    const credentials = getSyncSingleton().getCredentials();
    if (!credentials) throw new TodoSessionLinkError('task_scope_mismatch');
    await applyTodoSessionLinkIntent(credentials, intent);
}

/** Predecessor bare ids belong to the task's Account/Home, never an ambient target. */
export function projectTaskSessionLinks(todo: Pick<TodoItem, 'linkedSessions'> | null | undefined, scope: ServerAccountScope | null): TaskSessionLink[] {
    if (!todo?.linkedSessions || !scope) return [];
    return Object.entries(todo.linkedSessions)
        .reverse()
        .map(([key, data]) => ({
            ...(data.session ?? { ...scope, sessionId: key }),
            title: data.title,
            linkedAt: data.linkedAt
        }))
        .sort((a, b) => b.linkedAt - a.linkedAt);
}

export function getSessionsForTask(taskId: string): TaskSessionLink[] {
    const state = storage.getState();
    return projectTaskSessionLinks(state.todoState?.todos[taskId], state.profileScope);
}
