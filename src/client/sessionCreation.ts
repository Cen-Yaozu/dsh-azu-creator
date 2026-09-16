import type { WorkspaceId } from "@deepseek-ai/dsh-client-connection/client";

/** Options used when the sidebar creates an ordinary conversation. */
export interface OrdinarySessionCreateOptions {
  workspaceId?: WorkspaceId;
}

/**
 * Keep ordinary conversations ungrouped unless the user explicitly chooses a
 * workspace from the workspace tree.
 *
 * @param workspaceId - explicitly selected workspace, when any.
 * @returns the host session-create options for the ordinary conversation.
 */
export function ordinarySessionCreateOptions(workspaceId?: WorkspaceId): OrdinarySessionCreateOptions {
  return workspaceId === undefined ? {} : { workspaceId };
}
