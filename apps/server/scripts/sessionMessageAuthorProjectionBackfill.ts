import { backfillSessionMessageAuthorProjection } from "../sources/app/session/messages/backfillSessionMessageAuthorProjection";
import {
    createDbMaintenanceClient,
    requireDbProviderFromEnv,
} from "../sources/storage/db";

async function main(): Promise<void> {
    // Deployment supplies the exact database; do not silently select a user's
    // default light database when the operator omitted its connection target.
    if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
    const provider = requireDbProviderFromEnv(process.env, "postgres");
    const client = await createDbMaintenanceClient(provider, process.env.DATABASE_URL);
    try {
        await client.$connect();
        const result = await backfillSessionMessageAuthorProjection({ client });
        process.stdout.write(`${JSON.stringify({ provider, ...result })}\n`);
        if (!result.ok) process.exitCode = 1;
    } finally {
        await client.$disconnect();
    }
}

void main().catch(() => {
    // Database errors may include connection strings or row data. The operator
    // gets a failing status without disclosing those values in ordinary logs.
    process.stderr.write("Session message author backfill failed; verify the target database and rerun before enabling author-based Session scopes.\n");
    process.exitCode = 1;
});
