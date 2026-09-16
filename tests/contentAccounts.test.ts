import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MuziCreatorService } from "../src/azuService.ts";
import type { Config } from "../src/config.ts";
import { ContentAccountsService } from "../src/contentAccounts.ts";
import type { ContentAccountRequest } from "../src/contentAccountSchemas.ts";

const roots: string[] = [];
const signal = () => new AbortController().signal;
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "azu-accounts-")); roots.push(root);
  const project = async (id: string) => { if (id === "missing") throw new Error("missing project"); return { stage: id === "archived" ? "archived" : "idea" }; };
  return { root, project, service: new ContentAccountsService(root, project) };
}
const account = (revision: number, name = "测试账号"): Extract<ContentAccountRequest, { action: "saveAccount" }> => ({ action: "saveAccount", expectedRevision: revision, name, platform: "xiaohongshu", homepage: "https://example.com/user", notes: "个人账号", enabled: true });
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("local content accounts", () => {
  it("completes create, edit, account selection, publication and disk readback with the real creator service", async () => {
    const { root } = await setup();
    const cfg = { creatorRoot: join(root, "creator"), atlasRoot: join(root, "atlas"), libraryRoot: join(root, "creator", "10-active"), dataDir: join(root, "data"), subtitleSkillDir: "", coverSkillDir: "", previewMaxBytes: 262144, searchResultLimit: 30, graphNodeLimit: 500, graphEdgeLimit: 5000, enabledDocuments: ["mother", "video", "wechat", "xiaohongshu", "blog"], enabledPublishTargets: [], externalActionsEnabled: false } as Config;
    const creator = new MuziCreatorService(cfg);
    const content = await creator.createProject({ title: "闭环验证", primaryDocument: "mother", confirmed: true });
    await creator.saveDocument({ id: content.id, document: "mother", text: "# 本地创作\n\n已保存正文", status: "ready", expectedRevision: content.revision, confirmed: true });
    const store = new ContentAccountsService(cfg.dataDir!, id => creator.getProject({ id }));
    const registered = await store.manage(account(0), signal());
    const accountId = registered.accounts[0]!.id;
    await store.manage({ action: "setTargets", expectedRevision: 1, projectId: content.id, accountIds: [accountId] }, signal());
    await store.manage({ action: "savePublication", expectedRevision: 2, projectId: content.id, accountId, status: "published", url: "https://example.com/closed-loop", publishedAt: "2026-01-01T00:00:00Z" }, signal());
    expect((await new MuziCreatorService(cfg).getProject({ id: content.id })).content.mother).toContain("已保存正文");
    const persisted = await new ContentAccountsService(cfg.dataDir!, id => creator.getProject({ id })).manage({ action: "get" }, signal());
    expect(persisted.publications[0]).toMatchObject({ projectId: content.id, accountId, status: "published" });
  });
  it("persists two accounts on the same platform and their separate manual publication results across restart", async () => {
    const { service, root, project } = await setup();
    const first = await service.manage(account(0), signal());
    const second = await service.manage(account(1, "另一个账号"), signal());
    const ids = second.accounts.map(row => row.id);
    await service.manage({ action: "setTargets", expectedRevision: 2, projectId: "content-1", accountIds: ids }, signal());
    const publishedAt = "2026-01-01T08:00:00.000Z";
    await service.manage({ action: "savePublication", expectedRevision: 3, projectId: "content-1", accountId: ids[0]!, status: "published", url: "https://example.com/post", publishedAt }, signal());
    const restarted = await new ContentAccountsService(root, project).manage({ action: "get" }, signal());
    expect(restarted.accounts).toHaveLength(2);
    expect(restarted.publications.map(row => row.status)).toEqual(["published", "pending"]);
    expect(restarted.publications[0]).toMatchObject({ url: "https://example.com/post", publishedAt });
    expect(restarted.accounts[0]?.id).toBe(first.accounts[0]?.id);
    expect(JSON.parse(await readFile(service.file, "utf8")).revision).toBe(4);
  });

  it("serializes independent service instances and rejects stale writes without losing data", async () => {
    const { service, root, project } = await setup();
    const other = new ContentAccountsService(root, project);
    const results = await Promise.allSettled([service.manage(account(0, "一"), signal()), other.manage(account(0, "二"), signal())]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
    expect((await service.manage({ action: "get" }, signal())).accounts).toHaveLength(1);
  });

  it("retains disabled accounts and historical rows while rejecting new targets", async () => {
    const { service } = await setup();
    const state = await service.manage(account(0), signal()); const row = state.accounts[0]!;
    await service.manage({ action: "setTargets", expectedRevision: 1, projectId: "content", accountIds: [row.id] }, signal());
    await service.manage({ ...account(2), action: "saveAccount", id: row.id, platform: row.platform, name: row.name, homepage: row.homepage, notes: "已停用", enabled: false }, signal());
    await expect(service.manage({ action: "setTargets", expectedRevision: 3, projectId: "new-content", accountIds: [row.id] }, signal())).rejects.toThrow("停用");
    const retained = await service.manage({ action: "setTargets", expectedRevision: 3, projectId: "content", accountIds: [row.id] }, signal());
    expect(retained.publications).toHaveLength(1);
  });

  it("requires safe links, a real timestamp, and an existing target before recording a publication", async () => {
    const { service } = await setup();
    await expect(service.manage({ ...account(0), homepage: "javascript:alert(1)" } as ContentAccountRequest, signal())).rejects.toThrow();
    const state = await service.manage(account(0), signal()); const accountId = state.accounts[0]!.id;
    await expect(service.manage({ action: "savePublication", expectedRevision: 1, projectId: "content", accountId, status: "published", url: "https://example.com/post", publishedAt: null }, signal())).rejects.toThrow("先将");
    await service.manage({ action: "setTargets", expectedRevision: 1, projectId: "content", accountIds: [accountId] }, signal());
    await expect(service.manage({ action: "savePublication", expectedRevision: 2, projectId: "content", accountId, status: "published", url: "", publishedAt: null }, signal())).rejects.toThrow("链接和时间");
    await expect(service.manage({ action: "savePublication", expectedRevision: 2, projectId: "content", accountId, status: "published", url: "https://example.com", publishedAt: "2099-01-01T00:00:00Z" }, signal())).rejects.toThrow("晚于");
  });

  it("protects published records from silent removal and rejects archived or missing projects", async () => {
    const { service } = await setup();
    const state = await service.manage(account(0), signal()); const accountId = state.accounts[0]!.id;
    for (const projectId of ["missing", "archived"]) await expect(service.manage({ action: "setTargets", expectedRevision: 1, projectId, accountIds: [accountId] }, signal())).rejects.toThrow();
    await service.manage({ action: "setTargets", expectedRevision: 1, projectId: "content", accountIds: [accountId, accountId] }, signal());
    await service.manage({ action: "savePublication", expectedRevision: 2, projectId: "content", accountId, status: "published", url: "https://example.com", publishedAt: "2026-01-01T00:00:00Z" }, signal());
    await expect(service.manage({ action: "setTargets", expectedRevision: 3, projectId: "content", accountIds: [] }, signal())).rejects.toThrow("保留");
    await service.manage({ action: "savePublication", expectedRevision: 3, projectId: "content", accountId, status: "pending", url: "", publishedAt: null }, signal());
    const cleared = await service.manage({ action: "setTargets", expectedRevision: 4, projectId: "content", accountIds: [] }, signal());
    expect(cleared.publications).toEqual([]);
  });

  it("never resets a corrupt store to an empty registry", async () => {
    const { service } = await setup();
    await writeFile(service.file, "broken");
    await expect(service.manage(account(0), signal())).rejects.toThrow("未被覆盖");
    expect(await readFile(service.file, "utf8")).toBe("broken");
  });
});
