ALTER TABLE "Machine" ADD COLUMN "runnerContentKeyBinding" JSONB;
ALTER TABLE "EphemeralRunnerActivation"
    ADD COLUMN "credentialSelection" JSONB,
    ADD COLUMN "review" JSONB,
    ADD COLUMN "consent" JSONB,
    ADD COLUMN "readiness" JSONB,
    ADD COLUMN "sealedBootstrap" JSONB;
