import { useEffect, useRef, useState } from 'react';
import type { ContentAccount, ContentAccountFace } from '../contentAccountSchemas.ts';
import type { BilibiliConnectionResult, BilibiliConnectionRequest } from '../bilibiliConnectionSchemas.ts';
import { IslandButton, IslandTag } from './ui/IslandControls.tsx';

const labels = {disconnected:'未连接',starting:'正在连接',waiting_scan:'等待扫码确认',verifying:'核验身份中',connected:'已连接',expired:'登录或二维码已过期',cancelled:'连接已取消',failed:'连接失败',identity_mismatch:'账号不匹配',unchecked:'需要检查登录'};
const active = new Set(['starting','waiting_scan','verifying']);
export function BilibiliConnection({ account, connect }: {account: ContentAccount;connect: NonNullable<ContentAccountFace['connectBilibili']>}) {
  const [result,setResult]=useState<BilibiliConnectionResult|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const generation=useRef(0);
  const mounted=useRef(false);
  const inFlight=useRef(false);
  useEffect(()=>{
    mounted.current=true;let stopped=false;
    void connect({action:'status',accountId:account.id}).then(value=>{if(!stopped)setResult(value);},()=>{if(!stopped)setError('无法读取B站连接状态，请重试。');});
    return ()=>{stopped=true;mounted.current=false;generation.current++;};
  },[account.id,connect]);
  const state=result?.connection.state;
  useEffect(()=>{
    if(!state || !active.has(state)) return;
    let stopped=false;let timer: ReturnType<typeof setTimeout>;
    const poll=async()=>{
      const current=generation.current;
      try {const value=await connect({action:'status',accountId:account.id});if(!stopped && current===generation.current){setResult(value);setError(null);}}
      catch {if(!stopped)setError('暂时无法读取连接进度，正在重试。');}
      if(!stopped)timer=setTimeout(()=>{void poll();},2000);
    };
    timer=setTimeout(()=>{void poll();},1000);
    return ()=>{stopped=true;clearTimeout(timer);};
  },[state,account.id,connect]);
  const run=async(action: BilibiliConnectionRequest['action'])=>{
    if(inFlight.current)return;inFlight.current=true;generation.current++;setBusy(true);setError(null);
    try {const value=await connect({action,accountId:account.id});if(mounted.current)setResult(value);}
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'B站连接操作失败，请重试。');}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  };
  return <section className="bilibiliConnection" aria-label={`${account.name}的B站连接`}>
    <IslandTag size="small" color={state==='connected'?'app-green':'brown'} variant="soft">{state?labels[state]:'读取连接状态…'}</IslandTag>
    {result?.connection.identity && <p>平台身份：{result.connection.identity.name} · UID {result.connection.identity.mid}</p>}
    {result?.connection.checkedAt && <small>上次核验：{new Date(result.connection.checkedAt).toLocaleString()}</small>}
    {result && <p role="status">{result.connection.message}</p>}
    {result && !result.runtime.available && <p role="alert">{result.runtime.message}</p>}
    {error && <p role="alert">{error}</p>}
    {result?.connection.qrDataUrl && <div className="bilibiliLoginQr"><img width={200} height={200} src={result.connection.qrDataUrl} alt="B站登录二维码" /><p>用哔哩哔哩手机端扫码并确认登录</p><small>到期后点击重新连接。请勿分享二维码。</small></div>}
    <div className="contentActions">
      {state && active.has(state)
        ? <IslandButton size="small" disabled={busy} onClick={()=>{void run('cancel');}}>取消连接</IslandButton>
        : <><IslandButton size="small" disabled={busy || !account.enabled || result?.runtime.available!==true} onClick={()=>{void run('start');}}>{result?.connection.identity?'重新连接B站':'连接B站'}</IslandButton><IslandButton size="small" disabled={busy || !account.enabled} onClick={()=>{void run('check');}}>检查登录</IslandButton></>}
      {(!result || error) && <IslandButton size="small" disabled={busy} onClick={()=>{void run('status');}}>重试读取</IslandButton>}
    </div>
  </section>;
}
