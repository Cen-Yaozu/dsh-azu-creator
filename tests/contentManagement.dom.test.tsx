/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentAccountManager, ContentPublicationPanel } from "../src/client/ContentAccounts.tsx";
import { ContentProjectEditor } from "../src/client/ContentProjectEditor.tsx";
import { confirmContentNavigation } from "../src/client/contentSelection.ts";
import type { ContentAccountFace, ContentAccountSnapshot } from "../src/contentAccountSchemas.ts";
import type { MuziViewFace } from "../src/client/face.ts";
import { contentOverviewProject } from "./helpers/contentOverviewFixture.ts";

const account = { id: "account-1", name: "品牌号", platform: "xiaohongshu" as const, homepage: "", notes: "", enabled: true, updatedAt: "2026-01-01T00:00:00Z" };
const snapshot = (): ContentAccountSnapshot => ({ version: 1, revision: 0, accounts: [], publications: [] });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("content management loop", () => {
  it("registers and edits an account without invoking a platform connection", async () => {
    const state = snapshot();
    const manage = vi.fn<ContentAccountFace["manage"]>(async request => {
      if (request.action === "saveAccount") {
        const saved = { ...account, ...request, id: request.id ?? account.id }; state.accounts = [saved]; state.revision++;
      }
      return structuredClone(state);
    });
    render(<ContentAccountManager api={{ manage }} />);
    await screen.findByText(/还没有账号/);
    fireEvent.click(screen.getByRole("button", { name: "新增账号" }));
    fireEvent.change(screen.getByLabelText("所属平台"), { target: { value: "xiaohongshu" } });
    fireEvent.change(screen.getByLabelText("账号名称"), { target: { value: "品牌号" } });
    fireEvent.change(screen.getByLabelText("主页链接（选填）"), { target: { value: "https://example.com/brand" } });
    fireEvent.submit(screen.getByRole("form", { name: "新增账号" }));
    await screen.findByText("已登记 · 未连接平台");
    expect(manage).toHaveBeenLastCalledWith(expect.objectContaining({ action: "saveAccount", name: "品牌号", enabled: true, expectedRevision: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "编辑账号" }));
    fireEvent.click(screen.getByLabelText("启用账号"));
    fireEvent.submit(screen.getByRole("form", { name: "编辑账号" }));
    await screen.findByText(/小红书 · 已停用/);
    expect(manage.mock.calls.every(([request]) => ["get", "saveAccount"].includes(request.action))).toBe(true);
  });

  it("protects unsaved form input and restores focus after explicit discard", async () => {
    render(<ContentAccountManager api={{ manage: async () => snapshot() }} />);
    await screen.findByText("还没有账号");
    const add = screen.getByRole("button", { name: "新增账号" });
    add.focus(); fireEvent.click(add);
    fireEvent.change(screen.getByLabelText("所属平台"), { target: { value: "xiaohongshu" } });
    fireEvent.change(screen.getByLabelText("账号名称"), { target: { value: "未保存的账号" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("alert").textContent).toContain("未保存");
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect((screen.getByLabelText("账号名称") as HTMLInputElement).value).toBe("未保存的账号");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it("filters accounts without unmounting their connection sessions", async () => {
    const state = snapshot(); state.accounts = [account];
    render(<ContentAccountManager api={{ manage: async () => state }} />);
    await screen.findByRole("article", { name: "品牌号" });
    fireEvent.change(screen.getByLabelText("筛选平台"), { target: { value: "bilibili" } });
    expect(screen.queryByRole("article", { name: "品牌号" })).toBeNull();
    expect(screen.getByText("品牌号").closest("article")?.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("article", { name: "品牌号" })).toBeTruthy();
  });

  it("adds Bilibili directly by QR without requesting account fields or saving a placeholder", async () => {
    const state = snapshot();
    const manage = vi.fn<ContentAccountFace["manage"]>(async () => structuredClone(state));
    const connected = { runtime: { available: true, version: "1.2.4" as const, message: "ready" }, connection: {
      accountId: "new-bili", state: "connected" as const, identity: { mid: "123", name: "平台昵称" }, checkedAt: new Date().toISOString(), message: "已核验", qrDataUrl: null, expiresAt: null,
    } };
    const connectBilibili = vi.fn<NonNullable<ContentAccountFace["connectBilibili"]>>(async request => {
      if (request.action === "status") state.accounts = [{ ...account, id: "new-bili", platform: "bilibili", name: "平台昵称" }];
      return connected;
    });
    render(<ContentAccountManager api={{ manage, connectBilibili }} />);
    await screen.findByText("还没有账号");
    fireEvent.click(screen.getByRole("button", { name: "新增账号" }));
    expect(screen.queryByLabelText("账号名称")).toBeNull();
    expect(screen.queryByLabelText(/密码/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "扫码登录" }));
    await screen.findByText("已添加B站账号：平台昵称");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(connectBilibili).toHaveBeenCalledWith(expect.objectContaining({ action: "begin" }));
    expect(manage.mock.calls.every(([request]) => request.action === "get")).toBe(true);
  });

  it("selects a target and records a manual result with URL and time", async () => {
    const state = snapshot(); state.accounts = [account];
    const manage = vi.fn<ContentAccountFace["manage"]>(async request => {
      if (request.action === "setTargets") { state.publications = [{ projectId: "project", accountId: account.id, status: "pending", url: "", publishedAt: null, updatedAt: "2026-01-01T00:00:00Z" }]; state.revision++; }
      if (request.action === "savePublication") { Object.assign(state.publications[0]!, { status: request.status, url: request.url, publishedAt: request.publishedAt, updatedAt: "2026-01-02T00:00:00Z" }); state.revision++; }
      return structuredClone(state);
    });
    render(<ContentPublicationPanel api={{ manage }} projectId="project" readOnly={false} onManageAccounts={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText("小红书 · 品牌号"));
    fireEvent.click(screen.getByRole("button", { name: "保存目标账号" }));
    const form = await screen.findByRole("form", { name: "品牌号发布记录" });
    fireEvent.change(within(form).getByLabelText("发布状态"), { target: { value: "published" } });
    fireEvent.change(within(form).getByLabelText("发布链接"), { target: { value: "https://example.com/post" } });
    fireEvent.change(within(form).getByLabelText("发布时间（本地时间）"), { target: { value: "2026-01-01T12:00" } });
    fireEvent.submit(form);
    await screen.findByText("发布记录已保存");
    expect(screen.getByRole("link", { name: "打开已登记链接" }).getAttribute("href")).toBe("https://example.com/post");
    expect(screen.getByText("已选 1 个账号 · 已发布 1 · 待发布 0")).toBeTruthy();
  });

  it("keeps account form input on a failed save and offers a fresh read", async () => {
    const manage = vi.fn<ContentAccountFace["manage"]>(async request => { if (request.action !== "get") throw new Error("记录已更新，请重新读取"); return snapshot(); });
    render(<ContentAccountManager api={{ manage }} />);
    await screen.findByText(/还没有账号/);
    fireEvent.click(screen.getByRole("button", { name: "新增账号" }));
    fireEvent.change(screen.getByLabelText("所属平台"), { target: { value: "xiaohongshu" } });
    fireEvent.change(screen.getByLabelText("账号名称"), { target: { value: "保留我的输入" } });
    fireEvent.submit(screen.getByRole("form", { name: "新增账号" }));
    expect((await screen.findByRole("alert")).textContent).toContain("重新读取");
    expect((screen.getByLabelText("账号名称") as HTMLInputElement).value).toBe("保留我的输入");
  });

  it("edits and saves an existing project, protects unsaved navigation, and reloads saved text", async () => {
    let project = contentOverviewProject();
    const saveDocument = vi.fn(async request => {
      project = { ...project, revision: project.revision + 1, content: { ...project.content, [request.document]: request.text } };
      return project;
    });
    const face = { getProject: vi.fn(async () => project), saveDocument } as unknown as MuziViewFace;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(<ContentProjectEditor id={project.id} face={face} onManageAccounts={vi.fn()} />);
    const text = await screen.findByLabelText("正文");
    fireEvent.change(text, { target: { value: "# 我的第一篇内容\n\n正文" } });
    await waitFor(() => expect(screen.getByText("有未保存修改")).toBeTruthy());
    expect(confirmContentNavigation()).toBe(false); expect(confirm).toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "编辑稿件" }));
    await screen.findByText("稿件已保存");
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: "# 我的第一篇内容\n\n正文", expectedRevision: 3 }));
    view.unmount();
    render(<ContentProjectEditor id={project.id} face={face} onManageAccounts={vi.fn()} />);
    expect((await screen.findByLabelText("正文") as HTMLTextAreaElement).value).toContain("我的第一篇内容");
  });
});
