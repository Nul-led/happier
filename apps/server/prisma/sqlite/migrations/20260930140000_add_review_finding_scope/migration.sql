-- Foreign keys must be disabled outside the migration transaction by its owner:
-- rebuilding review_comments must retain its events and publication correlations.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_review_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "project_id" TEXT,
    "workspace_json" TEXT,
    "workspace_id" TEXT,
    "session_id" TEXT,
    "run_id" TEXT,
    "engine_id" TEXT,
    "finding_id" TEXT,
    "finding_identity" TEXT,
    "finding_severity" TEXT,
    "reviewed_fingerprint" TEXT,
    "review_triage_status" TEXT,
    "finding_scope_key" TEXT,
    "thread_id" TEXT NOT NULL,
    "parent_comment_id" TEXT,
    "state" TEXT NOT NULL,
    "flags_json" TEXT NOT NULL,
    "anchor_json" TEXT NOT NULL,
    "anchor_file_path" TEXT,
    "anchor_folder_path" TEXT,
    "snapshot_envelope_json" TEXT NOT NULL,
    "body_envelope_json" TEXT NOT NULL,
    "body_version" INTEGER NOT NULL,
    "author_json" TEXT NOT NULL,
    "edits_json" TEXT NOT NULL,
    "dispositions_json" TEXT NOT NULL,
    "evidence_json" TEXT,
    "transitions_json" TEXT NOT NULL,
    "fingerprint_json" TEXT,
    "linked_refs_json" TEXT,
    "suggested_fix_json" TEXT,
    "metadata_json" TEXT,
    "tombstone_json" TEXT,
    "create_client_mutation_id" TEXT,
    "create_request_fingerprint" TEXT,
    "server_revision" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "review_comments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_review_comments" (
    "id", "account_id", "project_id", "workspace_id", "session_id", "run_id", "engine_id", "finding_id",
    "thread_id", "parent_comment_id", "state", "flags_json", "anchor_json", "anchor_file_path", "anchor_folder_path",
    "snapshot_envelope_json", "body_envelope_json", "body_version", "author_json", "edits_json", "dispositions_json",
    "evidence_json", "transitions_json", "fingerprint_json", "linked_refs_json", "suggested_fix_json", "metadata_json",
    "tombstone_json", "create_client_mutation_id", "create_request_fingerprint", "server_revision", "created_at", "updated_at"
)
SELECT
    "id", "account_id", "project_id", "workspace_id", "session_id", "run_id", "engine_id", "finding_id",
    "thread_id", "parent_comment_id", "state", "flags_json", "anchor_json", "anchor_file_path", "anchor_folder_path",
    "snapshot_envelope_json", "body_envelope_json", "body_version", "author_json", "edits_json", "dispositions_json",
    "evidence_json", "transitions_json", "fingerprint_json", "linked_refs_json", "suggested_fix_json", "metadata_json",
    "tombstone_json", "create_client_mutation_id", "create_request_fingerprint", "server_revision", "created_at", "updated_at"
FROM "review_comments";

DROP TABLE "review_comments";
ALTER TABLE "new_review_comments" RENAME TO "review_comments";

CREATE TABLE "new_review_comment_events" (
    "event_id" TEXT NOT NULL PRIMARY KEY,
    "comment_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "project_id" TEXT,
    "workspace_json" TEXT,
    "event_kind" TEXT NOT NULL,
    "event_envelope_json" TEXT NOT NULL,
    "bulk_action_id" TEXT,
    "client_mutation_id" TEXT,
    "actor_json" TEXT NOT NULL,
    "author_device_id" TEXT,
    "client_lamport" BIGINT,
    "server_revision" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL,
    CONSTRAINT "review_comment_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_comment_events_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "review_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_review_comment_events" (
    "event_id", "comment_id", "account_id", "project_id", "event_kind", "event_envelope_json", "bulk_action_id",
    "client_mutation_id", "actor_json", "author_device_id", "client_lamport", "server_revision", "created_at"
)
SELECT
    "event_id", "comment_id", "account_id", "project_id", "event_kind", "event_envelope_json", "bulk_action_id",
    "client_mutation_id", "actor_json", "author_device_id", "client_lamport", "server_revision", "created_at"
FROM "review_comment_events";

DROP TABLE "review_comment_events";
ALTER TABLE "new_review_comment_events" RENAME TO "review_comment_events";

CREATE INDEX "review_comments_project_state_idx"
ON "review_comments"("project_id", "state", "updated_at");

CREATE INDEX "review_comments_project_run_idx"
ON "review_comments"("project_id", "run_id", "updated_at");

CREATE INDEX "review_comments_project_engine_idx"
ON "review_comments"("project_id", "engine_id", "updated_at");

CREATE INDEX "review_comments_project_file_idx"
ON "review_comments"("project_id", "anchor_file_path", "updated_at");

CREATE INDEX "review_comment_events_comment_idx"
ON "review_comment_events"("comment_id", "server_revision");

CREATE INDEX "review_comment_events_account_project_idx"
ON "review_comment_events"("account_id", "project_id", "created_at");

CREATE UNIQUE INDEX "review_comments_account_create_mutation_key"
ON "review_comments"("account_id", "create_client_mutation_id");

CREATE UNIQUE INDEX "review_comments_account_finding_scope_key"
ON "review_comments"("account_id", "finding_scope_key");

PRAGMA foreign_keys=ON;
