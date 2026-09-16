import { useEffect, useState, type ReactNode } from "react";
import type { MuziDocumentKey, MuziDocumentStatus, MuziProjectDetail } from "../azuTypes.ts";
import type { MuziViewFace } from "./face.ts";
import { IslandButton } from "./ui/IslandControls.tsx";
import { ContentPublicationPanel } from "./ContentAccounts.tsx";
import { bumpLibrary, guardContentNavigation } from "./contentSelection.ts";

const documents: Record<MuziDocumentKey, string> = { mother: "母内容", video: "视频稿", wechat: "公众号稿", xiaohongshu: "小红书稿", blog: "博客稿" };
const statuses: Record<MuziDocumentStatus, string> = { not_started: "未开始", draft: "草稿", review: "待审阅", ready: "已就绪" };
export function ContentProjectEditor({ id, face, onManageAccounts, advanced }: {
  id: string; face: MuziViewFace; onManageAccounts: () => void; advanced?: ReactNode;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [project, setProject] = useState<MuziProjectDetail | null>(null);
  const [document, setDocument] = useState<MuziDocumentKey>("mother");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<MuziDocumentStatus>("draft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const dirty = project !== null && (text !== project.content[document] || status !== project.documents[document].status);
  const selectDocument = (value: MuziProjectDetail, key: MuziDocumentKey) => {
    setProject(value); setDocument(key); setText(value.content[key]); setStatus(value.documents[key].status); setMessage("");
  };
  useEffect(() => {
    let stopped = false;
    void face.getProject(id).then(value => { if (!stopped) selectDocument(value, value.primaryDocument); }, cause => { if (!stopped) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { stopped = true; };
  }, [id, face]);
  useEffect(() => {
    if (!dirty && !busy) return;
    return guardContentNavigation(() => !busy && window.confirm("稿件尚未保存，离开会放弃修改。是否继续？"));
  }, [dirty, busy]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  return <div className="contentManager">
    {error && <p role="alert">{error}</p>}
    {!project && !error && <p role="status">正在读取稿件…</p>}
    {project && <>
      <header className="contentManagerHeader"><div><h2 id="muzi-workbench-detail-title" tabIndex={-1}>{project.title}</h2><p>{project.stage === "archived" ? "已归档 · 只读" : "编辑稿件后保存，再选择账号并登记发布结果。"}</p></div><span role="status">{dirty ? "有未保存修改" : message || "已保存"}</span></header>
      <form className="contentForm" aria-label="编辑稿件" onSubmit={event => {
        event.preventDefault(); if (busy) return; setBusy(true); setError(null); setMessage("");
        void face.saveDocument({ id, document, text, status, expectedRevision: project.revision }).then(value => {
          selectDocument(value, document); setMessage("稿件已保存"); bumpLibrary();
        }, cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
      }}>
        <div className="contentEditorBar">
          <label>稿件类型<select value={document} disabled={busy} onChange={event => {
            if (dirty && !window.confirm("当前稿件尚未保存，切换会放弃修改。是否继续？")) return;
            selectDocument(project, event.target.value as MuziDocumentKey);
          }}>{Object.entries(documents).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>稿件状态<select value={status} disabled={busy || project.stage === "archived"} onChange={event => setStatus(event.target.value as MuziDocumentStatus)}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <IslandButton htmlType="submit" type="primary" disabled={busy || !dirty || project.stage === "archived"}>{busy ? "保存中…" : "保存稿件"}</IslandButton>
          <IslandButton disabled={busy} onClick={() => {
            if (dirty && !window.confirm("重新读取将放弃未保存修改，是否继续？")) return;
            setBusy(true); setError(null); void face.getProject(id).then(value => selectDocument(value, document), cause => setError(String(cause instanceof Error ? cause.message : cause))).finally(() => setBusy(false));
          }}>重新读取稿件</IslandButton>
        </div>
        <label>正文<textarea className="contentDraft" value={text} readOnly={project.stage === "archived"} disabled={busy} onChange={event => { setText(event.target.value); if (status === "not_started" && event.target.value.trim()) setStatus("draft"); }} placeholder="在这里开始写作，支持 Markdown…" /></label>
      </form>
      {advanced && <div><IslandButton disabled={dirty || busy} onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? "收起高级制作" : "高级制作与自动发布"}</IslandButton>{showAdvanced && advanced}</div>}
      {face.localAccounts && <ContentPublicationPanel api={face.localAccounts} projectId={id} readOnly={project.stage === "archived"} onManageAccounts={onManageAccounts} />}
    </>}
  </div>;
}
