import { useEffect, useRef, useState } from "react";
import type { ContentAccount, ContentAccountFace } from "../contentAccountSchemas.ts";
import type { BilibiliConnectionResult, BilibiliConnectionRequest } from "../bilibiliConnectionSchemas.ts";
import { IslandButton, IslandTag } from "./ui/IslandControls.tsx";

const labels = {
  disconnected: "未连接", starting: "正在获取二维码", waiting_scan: "等待扫码确认", verifying: "正在核验身份",
  connected: "已连接", expired: "连接已过期", cancelled: "连接已取消", failed: "连接失败",
  identity_mismatch: "账号不匹配", unchecked: "需要检查登录",
};
const active = new Set(["starting", "waiting_scan", "verifying"]);
type Action = Exclude<BilibiliConnectionRequest["action"], "begin">;

export function BilibiliConnection({ account, connect, refreshKey = 0, onConnected }: {
  account: ContentAccount;
  connect: NonNullable<ContentAccountFace["connectBilibili"]>;
  refreshKey?: number;
  onConnected?: (result: BilibiliConnectionResult) => void;
}) {
  const [result, setResult] = useState<BilibiliConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [now, setNow] = useState(Date.now);
  const generation = useRef(0);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const loginPanel = useRef<HTMLDivElement>(null);
  const notifiedAccount = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, [account.id, connect]);

  useEffect(() => {
    let stopped = false;
    const read = async () => {
      if (inFlight.current) return;
      const current = generation.current;
      try {
        const value = await connect({ action: "status", accountId: account.id });
        if (!stopped && current === generation.current) { setResult(value); setError(null); }
      } catch {
        if (!stopped && current === generation.current) setError("无法读取B站连接状态，请重试。");
      }
    };
    void read();
    const onVisible = () => { if (document.visibilityState === "visible") void read(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; document.removeEventListener("visibilitychange", onVisible); };
  }, [account.id, account.enabled, connect, refreshKey]);

  const connection = result?.connection;
  const state = connection?.state;
  useEffect(() => {
    if (result?.connection.state === "connected" && onConnected && notifiedAccount.current !== account.id) {
      notifiedAccount.current = account.id;
      onConnected(result);
    }
  }, [result, onConnected, account.id]);
  const connecting = !!state && active.has(state);
  useEffect(() => {
    if (connecting) loginPanel.current?.scrollIntoView?.({ block: "nearest" });
  }, [connecting]);
  const deadline = connection?.expiresAt ? Date.parse(connection.expiresAt) : null;
  const remaining = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
  const qrExpired = (state === "waiting_scan" || state === "starting") && remaining === 0;

  useEffect(() => {
    if (!connecting) return;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = generation.current;
      if (!inFlight.current) {
        try {
          const value = await connect({ action: "status", accountId: account.id });
          if (!stopped && current === generation.current) { setResult(value); setError(null); }
        } catch {
          if (!stopped && current === generation.current) setError("连接进度暂时不可用，正在自动重试。请勿重复扫码。");
        }
      }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 2000);
    };
    timer = setTimeout(() => { void poll(); }, 1000);
    return () => { stopped = true; clearTimeout(timer); clearInterval(clock); };
  }, [connecting, account.id, connect]);

  const run = async (action: Action, renew = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++generation.current;
    setPending(action); setError(null);
    try {
      // Expired QR may precede the server's timeout. End that session before asking for a new one.
      const cancelled = renew ? await connect({ action: "cancel", accountId: account.id }) : null;
      const value = cancelled?.connection.state === "connected" ? cancelled : await connect({ action, accountId: account.id });
      if (mounted.current && current === generation.current) { setResult(value); setNow(Date.now()); }
    } catch (cause) {
      if (mounted.current && current === generation.current) setError(cause instanceof Error ? cause.message : "连接操作失败，请重试。");
    } finally {
      inFlight.current = false;
      if (mounted.current && current === generation.current) setPending(null);
    }
  };
  const busy = pending !== null;
  const needsReconnect = !!state && ["expired", "failed", "identity_mismatch"].includes(state);
  const tone = state === "connected" ? "app-green" : qrExpired || needsReconnect ? "app-orange" : "brown";
  const startLabel = pending === "start" ? "正在连接…" : qrExpired ? "刷新二维码" : connection?.identity ? "重新连接B站" : needsReconnect || state === "cancelled" ? "重新扫码" : "连接B站";

  return <section className="bilibiliConnection" aria-label={`${account.name}的B站连接`} aria-busy={busy}>
    <div className="bilibiliConnectionSummary">
      <div className="bilibiliConnectionInfo">
        <IslandTag size="small" color={tone} variant="soft">{qrExpired ? "二维码已过期" : state ? labels[state] : "读取连接状态…"}</IslandTag>
        {connection?.identity && <div className="bilibiliIdentity"><strong>{connection.identity.name}</strong><span>UID {connection.identity.mid}</span>{state !== "connected" && <small>上次核验身份</small>}</div>}
        <p role="status">{qrExpired ? "此二维码已失效，请刷新后重新扫码。" : connection?.message}</p>
        {connection?.checkedAt && <small>上次核验：{new Date(connection.checkedAt).toLocaleString()}</small>}
      </div>
      <div className="contentActions bilibiliConnectionActions">
        {connecting && !qrExpired ? <IslandButton size="small" disabled={busy} onClick={() => { void run("cancel"); }}>{pending === "cancel" ? "取消中…" : "取消连接"}</IslandButton> : <>
          {state === "connected" && <IslandButton type="primary" size="small" disabled={busy || !account.enabled} onClick={() => { void run("check"); }}>{pending === "check" ? "检查中…" : "检查登录"}</IslandButton>}
          <IslandButton type={state === "connected" ? "default" : "primary"} size="small" disabled={busy || !account.enabled || result?.runtime.available !== true} onClick={() => { void run("start", qrExpired); }}>{startLabel}</IslandButton>
          {connection?.identity && state !== "connected" && <IslandButton size="small" disabled={busy || !account.enabled} onClick={() => { void run("check"); }}>{pending === "check" ? "检查中…" : "检查登录"}</IslandButton>}
          {qrExpired && <IslandButton size="small" disabled={busy} onClick={() => { void run("cancel"); }}>取消连接</IslandButton>}
        </>}
        {(!result || error) && <IslandButton size="small" disabled={busy} onClick={() => { void run("status"); }}>{pending === "status" ? "读取中…" : "重试读取"}</IslandButton>}
      </div>
    </div>
    {!account.enabled && <p className="contentMuted">账号已停用。请在“编辑账号”中启用后连接或检查登录。</p>}
    {result && !result.runtime.available && <p role="alert">连接服务尚未就绪，请完成本机连接组件安装后重试。</p>}
    {error && <p role="alert">{error}</p>}
    {connecting && <div className="bilibiliLoginPanel" ref={loginPanel}>
      <div className="bilibiliQrFrame">
        {connection?.qrDataUrl && !qrExpired && state !== "verifying"
          ? <img width={200} height={200} src={connection.qrDataUrl} alt="B站登录二维码" />
          : <p>{qrExpired ? "二维码已过期" : state === "verifying" ? "正在核验身份…" : "正在获取二维码…"}</p>}
      </div>
      <div className="bilibiliLoginHelp"><h4>{qrExpired ? "刷新二维码后继续" : state === "verifying" ? "扫码完成，正在核验" : "用哔哩哔哩手机端扫码"}</h4>
        <ol><li>打开哔哩哔哩，扫描二维码</li><li>在手机上确认登录</li><li>身份核验通过后，这里自动显示连接结果</li></ol>
        {remaining !== null && state !== "verifying" && <p className="bilibiliCountdown" aria-live="off">{qrExpired ? "已停止展示过期二维码" : `二维码剩余 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}</p>}
        <small>登录凭据仅保存在本机。请勿分享二维码。</small>
      </div>
    </div>}
  </section>;
}
