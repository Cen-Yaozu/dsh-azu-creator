import { describe, expect, it } from "vitest";
import type { WorkspaceId } from "@deepseek-ai/dsh-client-connection/client";

import { ordinarySessionCreateOptions } from "../src/client/sessionCreation.ts";

describe("ordinary session creation", () => {
  it("creates an ungrouped session when no workspace was selected", () => {
    expect(ordinarySessionCreateOptions()).toEqual({});
  });

  it("keeps an explicitly selected workspace", () => {
    expect(ordinarySessionCreateOptions("workspace-demo" as WorkspaceId)).toEqual({ workspaceId: "workspace-demo" });
  });
});
