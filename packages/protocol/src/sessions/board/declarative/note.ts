import { SessionSurfaceDeclarativeDocumentV1Schema, type SessionSurfaceDeclarativeDocumentV1 } from './authoring.js';

/** An empty stack is the renderer's existing empty document, with no Note-only persisted arm. */
function sessionSurfaceNoteDocumentInputV1(text: string): unknown {
  return {
    version: 1,
    root: text.length === 0 ? { kind: 'stack', children: [] } : { kind: 'markdown', text },
  };
}

/** An empty stack is the renderer's existing empty document, with no Note-only persisted arm. */
export function createSessionSurfaceNoteDocumentV1(text: string): SessionSurfaceDeclarativeDocumentV1 {
  return SessionSurfaceDeclarativeDocumentV1Schema.parse(sessionSurfaceNoteDocumentInputV1(text));
}

export type SessionSurfaceNoteDocumentBuildV1 =
  | Readonly<{ ok: true; document: SessionSurfaceDeclarativeDocumentV1 }>
  | Readonly<{ ok: false }>;

/**
 * Non-throwing sibling for the editor save path. A person's draft is the one
 * Note input that can legitimately exceed the canonical declarative document
 * bound, and a save must answer that with a typed refusal that keeps the draft
 * rather than an exception the caller cannot name. The document shape stays
 * owned here, so both entry points build the same thing.
 */
export function buildSessionSurfaceNoteDocumentV1(text: string): SessionSurfaceNoteDocumentBuildV1 {
  const parsed = SessionSurfaceDeclarativeDocumentV1Schema.safeParse(
    sessionSurfaceNoteDocumentInputV1(text),
  );
  // The constructed root has the grammar's fixed kind and a string body, so its
  // only reachable refusal is the canonical document resource bound.
  return parsed.success ? { ok: true, document: parsed.data } : { ok: false };
}

/** Recognize only the editable Note subset; arbitrary declarative items remain intact. */
export function readSessionSurfaceNoteTextV1(document: SessionSurfaceDeclarativeDocumentV1): string | null {
  const root = document.root;
  if (root.kind === 'markdown' && typeof root.text === 'string') return root.text;
  if (root.kind === 'stack' && root.children.length === 0 && root.direction === undefined && root.gap === undefined) return '';
  return null;
}
