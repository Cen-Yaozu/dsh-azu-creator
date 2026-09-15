import { describe, expect, it } from "vitest";
import { registerCreatorTools } from "../src/tools.ts";
import { AZU_CREATOR_SERVICE, MZ_CREATOR_SERVICE } from "../src/service.ts";
import { REMOTE_NAMESPACE } from "../src/remote-contract.ts";
import { externalActionKind } from "../src/externalActions.ts";
it("registers primary Azu tool names, legacy MZ alias tool names and remote namespace", () => {
  const names: string[] = [];
  registerCreatorTools({tools:{register(tool){names.push(tool.name);}}}, {} as never);
  expect(names).toEqual([
    "azu_creator_guide", "mz_creator_guide",
    "azu_script_rules", "mz_script_rules",
    "azu_creator_setup", "mz_creator_setup",
    "azu_create_content", "mz_create_content",
    "azu_update_content", "mz_update_content",
    "azu_creator_profile", "mz_creator_profile",
    "azu_organize_library", "mz_organize_library",
    "azu_sync_publish", "mz_sync_publish",
    "azu_open_production_project_folder", "mz_open_production_project_folder",
    "azu_open_studio", "mz_open_studio",
    "azu_wait_export", "mz_wait_export",
    "azu_open_subtitle_preview", "mz_open_subtitle_preview",
    "azu_burn_subtitles", "mz_burn_subtitles",
    "azu_generate_subtitles", "mz_generate_subtitles",
    "azu_generate_cover", "mz_generate_cover",
  ]);
  expect(names).not.toContain("oil_wait_export");
  expect(REMOTE_NAMESPACE).toBe("azuCreator");
  expect(AZU_CREATOR_SERVICE).toBe(REMOTE_NAMESPACE);
  expect(MZ_CREATOR_SERVICE).toBe(REMOTE_NAMESPACE);
  expect(externalActionKind("azu_sync_publish")).toBe("metrics");
  expect(externalActionKind("mz_sync_publish")).toBe("metrics");
  expect(externalActionKind("oil_sync_publish")).toBeNull();
});
