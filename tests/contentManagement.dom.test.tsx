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
