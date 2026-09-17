/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BilibiliConnection } from "../src/client/BilibiliConnection.tsx";
import type { BilibiliConnectionResult } from "../src/bilibiliConnectionSchemas.ts";
import type { ContentAccount, ContentAccountFace } from "../src/contentAccountSchemas.ts";
const account: ContentAccount = { id: "a", name: "我的B站", platform: "bilibili", homepage: "", notes: "", enabled: true, updatedAt: "2026-01-01T00:00:00Z" };
const base: BilibiliConnectionResult = { runtime: { available: true, version: "1.2.4", message: "ready" }, connection: { accountId: "a", state: "disconnected", identity: null, checkedAt: null, message: "未连接", qrDataUrl: null, expiresAt: null } };
type Connect = NonNullable<ContentAccountFace["connectBilibili"]>;
const waiting = (): BilibiliConnectionResult => ({ ...base, connection: { ...base.connection, state: "waiting_scan", qrDataUrl: "data:image/png;base64,AA==", expiresAt: new Date(Date.now() + 120000).toISOString(), message: "请扫码" } });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shows QR and cancellation without claiming login success or offering an unbound check", async () => {
  const connect = vi.fn<Connect>(async request => request.action === "start" ? waiting() : request.action === "cancel" ? { ...base, connection: { ...base.connection, state: "cancelled", message: "已取消" } } : base);
  render(<BilibiliConnection account={account} connect={connect} />);
  fireEvent.click(await screen.findByRole("button", { name: "连接B站" }));
  await screen.findByAltText("B站登录二维码");
  expect(screen.queryByText("已连接")).toBeNull();
  expect(screen.queryByRole("button", { name: "检查登录" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "取消连接" }));
  await screen.findByText("已取消");
  expect(screen.queryByAltText("B站登录二维码")).toBeNull();
  expect(screen.getByRole("button", { name: "重新扫码" })).toBeTruthy();
});

it("checks the bound identity with progress and prevents duplicate requests", async () => {
  const bound: BilibiliConnectionResult = { ...base, connection: { ...base.connection, state: "unchecked", identity: { mid: "123", name: "真实昵称" }, checkedAt: "2026-09-18T00:00:00Z" } };
  let resolve!: (value: BilibiliConnectionResult) => void;
  const connect = vi.fn<Connect>(async request => request.action === "check" ? new Promise(done => { resolve = done; }) : bound);
  render(<BilibiliConnection account={account} connect={connect} />);
  fireEvent.click(await screen.findByRole("button", { name: "检查登录" }));
  const pending = screen.getByRole("button", { name: "检查中…" });
  fireEvent.click(pending);
  expect(connect.mock.calls.filter(([request]) => request.action === "check")).toHaveLength(1);
  await act(async () => resolve({ ...bound, connection: { ...bound.connection, state: "connected", message: "已核验" } }));
  expect(screen.getByText("真实昵称")).toBeTruthy();
  expect(screen.getByText("UID 123")).toBeTruthy();
  expect(screen.getByRole("button", { name: "重新连接B站" })).toBeTruthy();
  expect(screen.getByText("已连接")).toBeTruthy();
});

it("hides a QR at its deadline and cancels the old session before renewing", async () => {
  vi.useFakeTimers();
  const qr = waiting(); qr.connection.expiresAt = new Date(Date.now() + 1000).toISOString();
  const connect = vi.fn<Connect>(async request => request.action === "start" ? waiting() : request.action === "cancel" ? base : qr);
  render(<BilibiliConnection account={account} connect={connect} />);
  await act(async () => {});
  expect(screen.getByAltText("B站登录二维码")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(screen.queryByAltText("B站登录二维码")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "刷新二维码" })); });
  expect(connect.mock.calls.slice(-2).map(([request]) => request.action)).toEqual(["cancel", "start"]);
  expect(screen.getByAltText("B站登录二维码")).toBeTruthy();
});

it("does not let a delayed initial status overwrite a newer connection result", async () => {
  let resolve!: (value: BilibiliConnectionResult) => void;
  const connect = vi.fn<Connect>().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(waiting());
  render(<BilibiliConnection account={account} connect={connect} />);
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  await screen.findByAltText("B站登录二维码");
  await act(async () => resolve(base));
  expect(screen.getByAltText("B站登录二维码")).toBeTruthy();
});

it("reloads status on list refresh without initiating another login", async () => {
  const connect = vi.fn<Connect>().mockResolvedValue(base);
  const view = render(<BilibiliConnection account={account} connect={connect} />);
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  view.rerender(<BilibiliConnection account={account} connect={connect} refreshKey={1} />);
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
  expect(connect.mock.calls.every(([request]) => request.action === "status")).toBe(true);
});
