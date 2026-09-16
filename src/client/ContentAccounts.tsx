import { useEffect, useRef, useState } from "react";
import {
  CONTENT_PLATFORMS, type ContentAccount, type ContentAccountFace, type ContentAccountRequest,
  type ContentAccountSnapshot, type ContentPublication,
} from "../contentAccountSchemas.ts";
import { IslandButton, IslandTag } from "./ui/IslandControls.tsx";
import { bumpLibrary } from "./contentSelection.ts";
import "./ContentManagement.css";

export function useContentAccounts(api: ContentAccountFace) {
  const [data, setData] = useState<ContentAccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    void api.manage({ action: "get" }).then(value => { if (!stopped) setData(value); }, cause => { if (!stopped) setError(String(cause instanceof Error ? cause.message : cause)); });
    return () => { stopped = true; mounted.current = false; };
  }, [api]);
  const run = async (request: ContentAccountRequest): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const next = await api.manage(request);
      if (mounted.current) setData(next);
      if (request.action !== "get") bumpLibrary();
      return true;
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return { data, error, busy, run };
}
const blank = () => ({ name: "", platform: "xiaohongshu" as ContentAccount["platform"], homepage: "", notes: "", enabled: true });

export function ContentAccountManager({ api }: { api: ContentAccountFace }) {
  const { data, error, busy, run } = useContentAccounts(api);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [message, setMessage] = useState("");
  const reset = () => { setEditing(null); setForm(blank()); };
  return <section className="contentManager" aria-label="本地账号管理">
    <header className="contentManagerHeader"><div><h2>账号管理</h2><p>登记内容投放账号，管理各账号的发布记录。平台登录与自动发布尚未接入。</p></div><IslandButton disabled={busy} onClick={() => { void run({ action: "get" }); }}>重新读取</IslandButton></header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data === null && !error && <p role="status">正在读取账号…</p>}
    <div className="contentAccountLayout">
      <section aria-label="已登记账号"><h3>已登记账号 · {data?.accounts.length ?? 0}</h3>
        {data?.accounts.length === 0 && <p className="contentMuted">还没有账号，从右侧登记第一个账号。</p>}
        {data?.accounts.map(account => <article className="contentAccountRow" key={account.id}>
          <div><strong>{account.name}</strong><p>{CONTENT_PLATFORMS[account.platform]} · {account.enabled ? "已启用" : "已停用"}</p>
            <IslandTag size="small" color="brown" variant="soft">已登记 · 未连接平台</IslandTag>
            {account.homepage && <p><a href={account.homepage} target="_blank" rel="noreferrer">查看主页</a></p>}
            {account.notes && <p className="contentMuted">{account.notes}</p>}
          </div>
          <IslandButton size="small" disabled={busy} onClick={() => { setEditing(account.id); setForm({ name: account.name, platform: account.platform, homepage: account.homepage, notes: account.notes, enabled: account.enabled }); setMessage(""); }}>编辑账号</IslandButton>
        </article>)}
      </section>
      <form className="contentForm" aria-label={editing ? "编辑账号" : "新增账号"} onSubmit={event => {
        event.preventDefault(); if (!data) return;
        void run({ action: "saveAccount", expectedRevision: data.revision, ...(editing ? { id: editing } : {}), ...form }).then(ok => { if (ok) { setMessage(editing ? "账号已保存" : "账号已登记，可在内容中选择为目标账号。"); reset(); } });
      }}>
        <h3>{editing ? "编辑账号" : "新增账号"}</h3>
        <label>所属平台<select disabled={busy || !!editing} value={form.platform} onChange={event => setForm({ ...form, platform: event.target.value as ContentAccount["platform"] })}>{Object.entries(CONTENT_PLATFORMS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>账号名称<input required maxLength={80} disabled={busy} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：品牌主账号" /></label>
        <label>主页链接（选填）<input type="url" maxLength={2048} disabled={busy} value={form.homepage} onChange={event => setForm({ ...form, homepage: event.target.value })} placeholder="https://…" /></label>
        <label>备注（选填）<textarea maxLength={2000} rows={3} disabled={busy} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
        <label className="contentCheck"><input type="checkbox" disabled={busy} checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} />启用账号</label>
        <p className="contentMuted">停用后不能再选为新的投放目标，历史记录会保留。</p>
        <div className="contentActions"><IslandButton type="primary" htmlType="submit" disabled={busy || !data || !form.name.trim()}>{busy ? "保存中…" : "保存账号"}</IslandButton>{editing && <IslandButton disabled={busy} onClick={reset}>取消编辑</IslandButton>}</div>
      </form>
    </div>
  </section>;
}

function localDate(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function PublicationForm({ row, account, busy, save, readOnly }: {
  row: ContentPublication; account: ContentAccount; busy: boolean; readOnly: boolean;
  save: (status: "pending" | "published", url: string, publishedAt: string | null) => Promise<boolean>;
}) {
  const [status, setStatus] = useState(row.status);
  const [url, setUrl] = useState(row.url);
  const [date, setDate] = useState(localDate(row.publishedAt ?? new Date().toISOString()));
  const [saved, setSaved] = useState(false);
  return <form className="contentPublicationRow" aria-label={`${account.name}发布记录`} onSubmit={event => {
    event.preventDefault(); setSaved(false);
    void save(status, url, status === "published" && date ? new Date(date).toISOString() : null).then(setSaved);
  }}>
    <div><strong>{account.name}</strong><p>{CONTENT_PLATFORMS[account.platform]}{!account.enabled && " · 已停用"}</p><small>手动登记 · 未经平台核验</small></div>
    <label>发布状态<select disabled={busy || readOnly} value={status} onChange={event => { setStatus(event.target.value as typeof status); setSaved(false); }}><option value="pending">待发布</option><option value="published">已发布</option></select></label>
    {status === "published" && <>
      <label>发布链接<input type="url" required maxLength={2048} disabled={busy || readOnly} value={url} onChange={event => { setUrl(event.target.value); setSaved(false); }} placeholder="https://…" /></label>
      <label>发布时间（本地时间）<input type="datetime-local" required disabled={busy || readOnly} value={date} onChange={event => { setDate(event.target.value); setSaved(false); }} /></label>
    </>}
    <div className="contentActions"><IslandButton htmlType="submit" disabled={busy || readOnly}>保存记录</IslandButton>{row.status === "published" && row.url && <a href={row.url} target="_blank" rel="noreferrer">打开已登记链接</a>}{saved && <span role="status">记录已保存</span>}</div>
  </form>;
}

export function ContentPublicationPanel({ api, projectId, readOnly, onManageAccounts }: {
  api: ContentAccountFace; projectId: string; readOnly: boolean; onManageAccounts: () => void;
}) {
  const { data, error, busy, run } = useContentAccounts(api);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const rows = data?.publications.filter(row => row.projectId === projectId) ?? [];
  useEffect(() => { if (data) setSelected(data.publications.filter(row => row.projectId === projectId).map(row => row.accountId)); }, [data, projectId]);
  return <section className="contentManager" aria-label="目标账号与发布记录">
    <header className="contentManagerHeader"><div><h3>目标账号与发布记录</h3><p>已选 {rows.length} 个账号 · 已发布 {rows.filter(row => row.status === "published").length} · 待发布 {rows.filter(row => row.status === "pending").length}</p></div><div className="contentActions"><IslandButton disabled={busy} onClick={onManageAccounts}>管理账号</IslandButton><IslandButton disabled={busy} onClick={() => { void run({ action: "get" }); }}>重新读取记录</IslandButton></div></header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data === null && !error && <p role="status">正在读取发布记录…</p>}
    {data?.accounts.length === 0 && <p>请先登记账号，再为这篇内容选择投放目标。</p>}
    {data && data.accounts.length > 0 && <fieldset disabled={busy || readOnly} className="contentTargets"><legend>选择目标账号（可多选）</legend>
      {data.accounts.map(account => <label className="contentCheck" key={account.id}><input type="checkbox" checked={selected.includes(account.id)} disabled={!account.enabled && !rows.some(row => row.accountId === account.id)} onChange={event => { setMessage(""); setSelected(event.target.checked ? [...selected, account.id] : selected.filter(id => id !== account.id)); }} />{CONTENT_PLATFORMS[account.platform]} · {account.name}{!account.enabled && "（已停用）"}</label>)}
      <IslandButton disabled={busy || readOnly} onClick={() => { void run({ action: "setTargets", expectedRevision: data.revision, projectId, accountIds: selected }).then(ok => { if (ok) setMessage("目标账号已保存"); }); }}>保存目标账号</IslandButton>
    </fieldset>}
    {rows.map(row => { const account = data!.accounts.find(item => item.id === row.accountId); return account && <PublicationForm key={`${row.accountId}:${row.updatedAt}`} row={row} account={account} busy={busy} readOnly={readOnly} save={async (status, url, publishedAt) => { const ok = await run({ action: "savePublication", expectedRevision: data!.revision, projectId, accountId: row.accountId, status, url, publishedAt }); if (ok) setMessage("发布记录已保存"); return ok; }} />; })}
    <p className="contentMuted">这里记录手动发布结果，不会执行平台上传或发布。已发布的账号需先改为待发布，才能移出目标列表。</p>
  </section>;
}
