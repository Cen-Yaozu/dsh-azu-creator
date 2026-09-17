import type { BilibiliConnectionResult } from "../bilibiliConnectionSchemas.ts";
import { BilibiliConnection } from "./BilibiliConnection.tsx";
import { useEffect, useRef, useState } from "react";
import {
  CONTENT_PLATFORMS, type ContentAccount, type ContentAccountFace, type ContentAccountRequest,
  type ContentAccountSnapshot, type ContentPublication,
} from "../contentAccountSchemas.ts";
import { IslandButton, IslandModal, IslandTag } from "./ui/IslandControls.tsx";
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
const blank = () => ({ name: "", platform: "bilibili" as ContentAccount["platform"], homepage: "", notes: "", enabled: true });

export function ContentAccountManager({ api }: { api: ContentAccountFace }) {
  const { data, error, busy, run } = useContentAccounts(api);
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [newConnection, setNewConnection] = useState<BilibiliConnectionResult | null>(null);
  const [connectingNew, setConnectingNew] = useState(false);
  const newOperation = useRef(false);
  const newRequestId = useRef<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const original = useRef(blank());
  const [discarding, setDiscarding] = useState(false);
  const discardPrompt = useRef<HTMLDivElement>(null);
  useEffect(() => { if (discarding) discardPrompt.current?.focus(); }, [discarding]);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const openForm = (account?: ContentAccount) => {
    const next = account ? { name: account.name, platform: account.platform, homepage: account.homepage, notes: account.notes, enabled: account.enabled } : blank();
    original.current = next;
    newRequestId.current = null;
    setNewConnection(null); setConnectionError(null);
    setEditing(account?.id ?? null); setForm(next); setDiscarding(false); setMessage(""); setFormOpen(true);
  };
  const closeForm = () => {
    if (busy || newOperation.current) return;
    if (newConnection && api.connectBilibili) {
      newOperation.current = true; setConnectingNew(true);
      void api.connectBilibili({ action: "cancel", accountId: newConnection.connection.accountId }).then(() => {
        setNewConnection(null); setFormOpen(false); void run({ action: "get" });
      }, cause => setConnectionError(cause instanceof Error ? cause.message : "暂时无法取消连接，请重试。")).finally(() => { newOperation.current = false; setConnectingNew(false); });
      return;
    }
    if (!editing && form.platform === "bilibili" && !form.name && !form.notes && !form.homepage) { setFormOpen(false); return; }
    if (JSON.stringify(form) !== JSON.stringify(original.current)) setDiscarding(true);
    else setFormOpen(false);
  };
  const beginConnection = async () => {
    if (!api.connectBilibili || newOperation.current) return;
    newOperation.current = true; setConnectingNew(true); setConnectionError(null);
    try { setNewConnection(await api.connectBilibili({ action: "begin", requestId: newRequestId.current ??= crypto.randomUUID() })); }
    catch (cause) { setConnectionError(cause instanceof Error ? cause.message : "暂时无法获取二维码，请重试。"); }
    finally { newOperation.current = false; setConnectingNew(false); }
  };
  const scanFirst = !editing && form.platform === "bilibili";
  const accounts = data?.accounts ?? [];
  const matching = accounts.filter(account => (platform === "all" || account.platform === platform)
    && `${account.name} ${CONTENT_PLATFORMS[account.platform]} ${account.notes}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="contentManager contentAccountManager" aria-label="本地账号管理">
    <header className="contentManagerHeader">
      <div><h2>账号管理</h2><p className="contentMuted">管理投放账号与平台连接，发布记录保留在对应内容中。</p></div>
      <div className="contentActions">
        <IslandButton size="small" disabled={busy} onClick={() => { void run({ action: "get" }).then(ok => { if (ok) { setRefreshKey(key => key + 1); setMessage("账号列表已刷新"); } }); }}>{busy && !formOpen ? "刷新中…" : "刷新状态"}</IslandButton>
        <IslandButton type="primary" size="small" disabled={busy || !data} onClick={() => openForm()}>新增账号</IslandButton>
      </div>
    </header>
    <p className="contentAccountNotice">B站支持扫码登录与身份检查。视频号等平台暂支持账号登记，自动发布尚未接入。</p>
    {error && !formOpen && <p role="alert">{error}</p>}{message && <p role="status" className="contentAccountFeedback">{message}</p>}
    {data === null && !error && <p role="status">正在读取账号…</p>}
    {accounts.length > 0 && <div className="contentAccountToolbar">
      <label>搜索账号<input type="search" placeholder="搜索名称、平台或备注" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>筛选平台<select value={platform} onChange={event => setPlatform(event.target.value)}><option value="all">全部平台</option>{Object.entries(CONTENT_PLATFORMS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <span className="contentMuted">共 {accounts.length} 个 · 已启用 {accounts.filter(account => account.enabled).length} 个</span>
    </div>}
    <section className="contentAccountList" aria-label="已登记账号">
      {data && accounts.length === 0 && <div className="contentAccountEmpty"><h3>还没有账号</h3><p>选择平台后扫码登录，B站昵称与主页将自动读取。</p><IslandButton type="primary" onClick={() => openForm()}>登记第一个账号</IslandButton></div>}
      {accounts.length > 0 && matching.length === 0 && <div className="contentAccountEmpty"><p>没有符合筛选条件的账号</p><IslandButton onClick={() => { setQuery(""); setPlatform("all"); }}>清除筛选</IslandButton></div>}
      {accounts.map(account => <article className="contentAccountRow" key={account.id} hidden={!matching.includes(account)} aria-label={account.name}>
        <header className="contentAccountHeading">
          <div><h3>{account.name}</h3><p className="contentMuted">{CONTENT_PLATFORMS[account.platform]} · {account.enabled ? "已启用" : "已停用"}</p></div>
          <IslandButton size="small" disabled={busy} onClick={() => openForm(account)}>编辑账号</IslandButton>
        </header>
        {account.platform === "bilibili" && api.connectBilibili
          ? <BilibiliConnection account={account} connect={api.connectBilibili} refreshKey={refreshKey} />
          : <div className="contentAccountUnconnected"><IslandTag size="small" color="brown" variant="soft">已登记 · 未连接平台</IslandTag><p className="contentMuted">可选择为投放目标，发布结果需手动登记。</p></div>}
        {(account.homepage || account.notes) && <footer className="contentAccountMeta">{account.notes && <p>{account.notes}</p>}{account.homepage && <a href={account.homepage} target="_blank" rel="noreferrer">查看主页</a>}</footer>}
      </article>)}
    </section>
    <IslandModal open={formOpen} title={editing ? "编辑账号" : newConnection ? "连接B站" : "新增账号"} width={newConnection ? 680 : 520} footer={null} maskClosable={false} onClose={closeForm}>
      <div data-plugin="dsh-azu-creator">{newConnection ? <div className="contentManager">
        <p className="contentMuted">扫码确认后自动添加账号，无需填写账号名称或密码。</p>
        {connectionError && <p role="alert">{connectionError}</p>}
        <BilibiliConnection account={{ id: newConnection.connection.accountId, name: "新账号", platform: "bilibili", enabled: true, homepage: "", notes: "", updatedAt: "" }} connect={api.connectBilibili!} onConnected={result => {
          setNewConnection(null); setFormOpen(false); setQuery(""); setPlatform("all");
          setMessage(`已添加B站账号：${result.connection.identity?.name ?? "已核验账号"}`); void run({ action: "get" });
        }} />
        <div className="contentActions contentFormFooter"><IslandButton disabled={connectingNew} onClick={closeForm}>{connectingNew ? "关闭中…" : "关闭"}</IslandButton></div>
      </div> : <form className="contentManager contentForm contentAccountForm" aria-label={editing ? "编辑账号" : "新增账号"} aria-busy={busy} onSubmit={event => {
        event.preventDefault(); if (!data || busy || connectingNew) return;
        if (scanFirst) { void beginConnection(); return; }
        void run({ action: "saveAccount", expectedRevision: data.revision, ...(editing ? { id: editing } : {}), ...form }).then(ok => {
          if (ok) { setMessage(editing ? "账号已保存" : form.platform === "bilibili" ? "账号已登记，点击“连接B站”完成扫码登录。" : "账号已登记，可在内容中选择为目标账号。"); setFormOpen(false); setQuery(""); setPlatform("all"); }
        });
      }}>
        {error && <div role="alert"><p>{error}</p><IslandButton size="small" disabled={busy} onClick={() => { void run({ action: "get" }); }}>重新读取账号列表</IslandButton></div>}
        <label>所属平台<select disabled={busy || connectingNew || !!editing} value={form.platform} onChange={event => setForm({ ...form, platform: event.target.value as ContentAccount["platform"] })}>{Object.entries(CONTENT_PLATFORMS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <p className="contentMuted">{editing ? "平台不可修改。如需其他平台，请新增账号。" : form.platform === "bilibili" ? "扫码登录后自动读取昵称与主页，不需要填写账号名称或密码。" : "此平台暂支持本地登记，尚未接入真实登录。"}</p>
        {connectionError && <p role="alert">{connectionError}</p>}
        {!scanFirst && <><label>账号名称<input required maxLength={80} disabled={busy} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：我的B站账号" /></label>
        <label>主页链接（选填）<input type="url" maxLength={2048} disabled={busy} value={form.homepage} onChange={event => setForm({ ...form, homepage: event.target.value })} placeholder="https://…" /></label>
        <label>备注（选填）<textarea maxLength={2000} rows={3} disabled={busy} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
        <label className="contentCheck"><input type="checkbox" disabled={busy} checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} />启用账号</label>
        <p className="contentMuted">停用后无法新增投放或发起连接，已有绑定和发布记录会保留。</p></>}
        {discarding && <div className="contentDiscardPrompt" role="alert" tabIndex={-1} ref={discardPrompt}><p>有未保存的修改，确定放弃吗？</p><div className="contentActions"><IslandButton size="small" disabled={busy} onClick={() => setDiscarding(false)}>继续编辑</IslandButton><IslandButton size="small" disabled={busy} onClick={() => { setFormOpen(false); setDiscarding(false); }}>放弃修改</IslandButton></div></div>}
        <div className="contentActions contentFormFooter"><IslandButton disabled={busy || connectingNew} onClick={closeForm}>取消</IslandButton><IslandButton type="primary" htmlType="submit" disabled={busy || connectingNew || !data || (scanFirst ? !api.connectBilibili : !form.name.trim())}>{connectingNew ? "正在获取二维码…" : scanFirst ? "扫码登录" : busy ? "保存中…" : "保存账号"}</IslandButton></div>
      </form>}</div>
    </IslandModal>
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
