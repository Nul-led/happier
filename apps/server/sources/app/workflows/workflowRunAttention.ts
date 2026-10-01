import type { Prisma } from "@prisma/client";
import { WORKFLOW_ATTENTION_INVOCATION_LIFECYCLES_V1 } from "@happier-dev/protocol";
import { AUTOMATION_RUN_TERMINAL_STATES } from "@/app/automations/automationTypes";
import { getDbProviderFromEnv, prismaRuntime } from "@/storage/prisma";

/** Plaintext attention facts. Delivery and a settled exhausted result are not attention. */
const attention = {
    interrupted: "interrupted",
    terminal: AUTOMATION_RUN_TERMINAL_STATES,
    custody: "pending",
    invocations: WORKFLOW_ATTENTION_INVOCATION_LIFECYCLES_V1,
} as const;

export function workflowRunAttentionWhere(): Prisma.AutomationRunWhereInput {
    return { OR: [
        { state: attention.interrupted },
        { state: { in: [...attention.terminal] }, workflowCustodyState: attention.custody },
        { workflowInvocations: { some: { lifecycle: { in: [...attention.invocations] } } } },
    ] };
}

/** Identifiers are owner-authored, never caller input; values stay bound parameters. */
export function workflowRunSqlIdentifier(name: string): Prisma.Sql {
    const quote = getDbProviderFromEnv(process.env, "postgres") === "mysql" ? "`" : '"';
    return prismaRuntime.raw(`${quote}${name}${quote}`);
}

/** SQL projection of the same facts for the single batched summary query. */
export function workflowRunAttentionSql(): Prisma.Sql {
    const id = workflowRunSqlIdentifier;
    const textType = prismaRuntime.raw(getDbProviderFromEnv(process.env, "postgres") === "mysql" ? "CHAR" : "TEXT");
    return prismaRuntime.sql`(CAST(r.${id("state")} AS ${textType}) = ${attention.interrupted}
        OR (CAST(r.${id("state")} AS ${textType}) IN (${prismaRuntime.join([...attention.terminal])}) AND CAST(r.${id("workflowCustodyState")} AS ${textType}) = ${attention.custody})
        OR EXISTS (SELECT 1 FROM ${id("WorkflowRunInvocation")} i WHERE i.${id("runId")} = r.${id("id")} AND CAST(i.${id("lifecycle")} AS ${textType}) IN (${prismaRuntime.join([...attention.invocations])})))`;
}
