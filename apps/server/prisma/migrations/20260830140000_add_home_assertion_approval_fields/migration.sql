ALTER TABLE "AuthPairingSession"
    ADD COLUMN "flow" TEXT NOT NULL DEFAULT 'direct_qr',
    ADD COLUMN "requesterIssuerServerIdentityId" TEXT,
    ADD COLUMN "requesterIssuerSubjectId" TEXT,
    ADD COLUMN "approvalStatus" TEXT,
    ADD COLUMN "decidedAt" TIMESTAMP(3);
