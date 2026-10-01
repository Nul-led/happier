ALTER TABLE "review_comments"
    ALTER COLUMN "project_id" DROP NOT NULL,
    ADD COLUMN "workspace_json" TEXT,
    ADD COLUMN "finding_identity" TEXT,
    ADD COLUMN "finding_severity" TEXT,
    ADD COLUMN "reviewed_fingerprint" TEXT,
    ADD COLUMN "review_triage_status" TEXT,
    ADD COLUMN "finding_scope_key" TEXT;

ALTER TABLE "review_comment_events"
    ALTER COLUMN "project_id" DROP NOT NULL,
    ADD COLUMN "workspace_json" TEXT;

CREATE UNIQUE INDEX "review_comments_account_finding_scope_key"
    ON "review_comments"("account_id", "finding_scope_key");
