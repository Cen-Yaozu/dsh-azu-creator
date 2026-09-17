/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BilibiliConnection } from '../src/client/BilibiliConnection.tsx';
import type { BilibiliConnectionResult } from '../src/bilibiliConnectionSchemas.ts';
import type { ContentAccount } from '../src/contentAccountSchemas.ts';
const account: ContentAccount={id:'a',name:'我的B站',platform:'bilibili',homepage:'',notes:'',enabled:true,updatedAt:'2026-01-01T00:00:00Z'};
const base: BilibiliConnectionResult={runtime:{available:true,version:'1.2.4',message:'ready'},connection:{accountId:'a',state:'disconnected',identity:null,checkedAt:null,message:'未连接',qrDataUrl:null,expiresAt:null}};
afterEach(cleanup);
it('shows real connection controls, QR and cancellation without claiming login success',async()=>{
 const connect=vi.fn(async(request)=>request.action==='start'?{...base,connection:{...base.connection,state:'waiting_scan' as const,qrDataUrl:'data:image/png;base64,AA==',message:'请扫码'}}:request.action==='cancel'?{...base,connection:{...base.connection,state:'cancelled' as const,message:'已取消'}}:base);
 render(<BilibiliConnection account={account} connect={connect} />);
 fireEvent.click(await screen.findByRole('button',{name:'连接B站'}));await screen.findByAltText('B站登录二维码');expect(screen.queryByText('已连接')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'取消连接'}));await screen.findByText('已取消');expect(screen.queryByAltText('B站登录二维码')).toBeNull();
});
it('checks the bound identity and displays the last verification time',async()=>{
 const connect=vi.fn(async(request)=>request.action==='check'?{...base,connection:{...base.connection,state:'connected' as const,identity:{mid:'123',name:'真实昵称'},checkedAt:'2026-09-18T00:00:00Z',message:'已核验'}}:base);
 render(<BilibiliConnection account={account} connect={connect} />);
 await waitFor(()=>expect(connect).toHaveBeenCalled());fireEvent.click(await screen.findByRole('button',{name:'检查登录'}));
 await screen.findByText('平台身份：真实昵称 · UID 123');expect(screen.getByRole('button',{name:'重新连接B站'})).toBeTruthy();
});
