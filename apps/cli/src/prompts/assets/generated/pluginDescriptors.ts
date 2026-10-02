/**
 * GENERATED FILE CONTRACT (A.16y.4-agent-runtime-codegen-and-prompt-assets-cleanup)
 *
 * This file is emitted by:
 * - `apps/cli/scripts/build-owned/generateBundledPluginEntries.ts`
 */

import type { PluginPromptAssetAdapterDescriptor } from '../pluginPromptAssetAdapterDescriptor';

export const BUNDLED_FIRST_PARTY_PLUGIN_PROMPT_ASSET_DESCRIPTORS: readonly PluginPromptAssetAdapterDescriptor[] = Object.freeze(
[
  {
    "adapterKind": "markdownDoc",
    "assetTypeId": "claude.command",
    "capabilities": {
      "supportsNestedNamespaces": true
    },
    "description": "Markdown slash commands discovered from Claude command folders.",
    "projectRootDisplayPath": ".claude/commands",
    "projectRootPath": [
      ".claude",
      "commands"
    ],
    "providerId": "claude",
    "title": "Claude commands (.claude)",
    "userRootDisplayPath": "~/.claude/commands",
    "userRootPath": [
      ".claude",
      "commands"
    ]
  },
  {
    "adapterKind": "skillMd",
    "assetTypeId": "claude.skill",
    "capabilities": {
      "supportsCatalogInstall": true,
      "supportsSymlinkInstall": true
    },
    "description": "SKILL.md bundles discovered from Claude Code skill folders.",
    "projectRootDisplayPath": ".claude/skills",
    "projectRootPath": [
      ".claude",
      "skills"
    ],
    "providerId": "claude",
    "title": "Claude skills (.claude)",
    "userRootDisplayPath": "~/.claude/skills",
    "userRootPath": [
      ".claude",
      "skills"
    ]
  },
  {
    "adapterKind": "skillMd",
    "assetTypeId": "copilot.skill",
    "capabilities": {
      "supportsCatalogInstall": true,
      "supportsSymlinkInstall": true
    },
    "description": "SKILL.md bundles discovered from GitHub Copilot skill folders.",
    "projectRootDisplayPath": ".github/skills",
    "projectRootPath": [
      ".github",
      "skills"
    ],
    "providerId": "copilot",
    "title": "Copilot skills (.github/.copilot)",
    "userRootDisplayPath": "~/.copilot/skills",
    "userRootPath": [
      ".copilot",
      "skills"
    ]
  },
  {
    "adapterKind": "skillMd",
    "assetTypeId": "gemini.skill",
    "capabilities": {
      "supportsCatalogInstall": true,
      "supportsSymlinkInstall": true
    },
    "description": "SKILL.md bundles discovered from Gemini CLI skill folders.",
    "projectRootDisplayPath": ".gemini/skills",
    "projectRootPath": [
      ".gemini",
      "skills"
    ],
    "providerId": "gemini",
    "title": "Gemini skills (.gemini)",
    "userRootDisplayPath": "~/.gemini/skills",
    "userRootPath": [
      ".gemini",
      "skills"
    ]
  }
]);
