ALTER TABLE "AuthPairingSession"
    ADD COLUMN "flow" TEXT NOT NULL DEFAULT 'direct_qr';
ALTER TABLE "AuthPairingSession" ADD COLUMN "requesterIssuerServerIdentityId" TEXT;
ALTER TABLE "AuthPairingSession" ADD COLUMN "requesterIssuerSubjectId" TEXT;
ALTER TABLE "AuthPairingSession" ADD COLUMN "approvalStatus" TEXT;
ALTER TABLE "AuthPairingSession" ADD COLUMN "decidedAt" DATETIME;
