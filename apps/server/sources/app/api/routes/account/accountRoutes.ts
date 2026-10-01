import { type Fastify } from "../../types";
import { registerAccountProfileRoute } from "./registerAccountProfileRoute";
import { registerAccountIdentityVisibilityRoute } from "./registerAccountIdentityVisibilityRoute";
import { registerAccountUsernameRoute } from "./registerAccountUsernameRoute";
import { registerAccountSettingsRoutes } from "./registerAccountSettingsRoutes";
import { registerAccountSettingsHistoryRoutes } from "./registerAccountSettingsHistoryRoutes";
import { registerAccountUsageRoutes } from "./registerAccountUsageRoutes";
import { registerAccountEncryptionRoutes } from "./registerAccountEncryptionRoutes";
import { registerAccountEncryptionMigrateRoutes } from "./registerAccountEncryptionMigrateRoutes";
import { registerAccountActivityBadgeSnapshotRoute } from "./registerAccountActivityBadgeSnapshotRoute";
import { registerPluginAccountSettingsRoutes } from "./registerPluginAccountSettingsRoutes";
import { registerPluginAccountStorageRoutes } from "./registerPluginAccountStorageRoutes";
import { registerAuthoringMemoryRoutes } from "./registerAuthoringMemoryRoutes";
import { createServerFeatureGatedRouteApp } from "@/app/features/catalog/serverFeatureGate";
import { registerAccountPetLibraryRoutes } from "@/app/pets/accountPetLibraryRoutes";
import { registerSessionDraftRoutes } from "@/app/account/sessionDrafts/registerSessionDraftRoutes";
import { registerAccountDirectoryLinkRoutes, registerAccountDirectoryRoutes } from "@/app/accountDirectory/accountDirectoryRoutes";
import { registerSavedSecretResourceRoutes } from "./registerSavedSecretResourceRoutes";

export function accountRoutes(app: Fastify): void {
    registerAccountProfileRoute(app);
    registerAccountIdentityVisibilityRoute(app);
    registerAccountUsernameRoute(app);
    registerAccountSettingsRoutes(app);
    registerSavedSecretResourceRoutes(app);
    registerAccountSettingsHistoryRoutes(app);
    registerAccountEncryptionRoutes(app);
    registerAccountEncryptionMigrateRoutes(app);
    registerAccountUsageRoutes(app);
    registerAccountActivityBadgeSnapshotRoute(app);
    registerPluginAccountSettingsRoutes(app);
    registerPluginAccountStorageRoutes(app);
    registerAuthoringMemoryRoutes(app);
    registerAccountDirectoryRoutes(app);
    registerAccountDirectoryLinkRoutes(app);
    registerAccountPetLibraryRoutes(createServerFeatureGatedRouteApp(app, "pets.sync"));
    registerSessionDraftRoutes(createServerFeatureGatedRouteApp(app, "sessions.drafts"));
}
