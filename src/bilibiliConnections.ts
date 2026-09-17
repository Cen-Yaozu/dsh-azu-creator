import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { bilibiliConnectionRequestSchema, bilibiliConnectionSchema, type BilibiliConnection, type BilibiliConnectionRequest, type BilibiliConnectionResult, type BilibiliIdentity } from './bilibiliConnectionSchemas.ts';
import { BilibiliLoginExpired, NativeBilibiliRuntime, type BilibiliRuntime } from './bilibiliRuntime.ts';
import type { ContentAccount } from './contentAccountSchemas.ts';

const recordSchema = z.object({ connection: bilibiliConnectionSchema.omit({ qrDataUrl: true, expiresAt: true }), credentials: z.unknown().nullable(), registration: z.boolean().default(false) });
type RecordData = z.infer<typeof recordSchema>;
type Session = { controller: AbortController; directory: string; run: Promise<void>; expiresAt: string; qrReady: boolean; release: () => Promise<void> };
const activeStates = new Set(['starting','waiting_scan','verifying']);
const initial = (accountId: string): BilibiliConnection => ({ accountId, state:'disconnected', identity:null, checkedAt:null, message:'尚未连接B站', qrDataUrl:null, expiresAt:null });

/** Owns private per-account credentials. Public responses never contain credentials or private paths. */
export class BilibiliConnectionsService {
  readonly root: string;
  private readonly sessions = new Map<string, Session>();
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly lifetime = new AbortController();
  constructor(dataDir: string, private readonly accounts: () => Promise<ContentAccount[]>, private readonly runtime: BilibiliRuntime = new NativeBilibiliRuntime(dataDir), private readonly register?: (id: string, identity: BilibiliIdentity, signal: AbortSignal) => Promise<void>) {
    this.root = join(dataDir, 'platform-connections', 'bilibili');
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation); this.tail = next.catch(() => undefined); return next;
  }
  private directory(accountId: string) { return join(this.root, createHash('sha256').update(accountId).digest('hex')); }
  private async account(id: string) {
    const account = (await this.accounts()).find(row => row.id === id);
    if (!account && (await this.read(id)).registration) return { id, platform: 'bilibili' as const, enabled: true };
    if (!account || account.platform !== 'bilibili') throw new Error('请选择已登记的B站账号。');
    return account;
  }
  private async prepare(directory: string) {
    // Reject symlinks for the owned credential directories.
    for (const path of [join(this.root, '..'), this.root, directory]) {
      await mkdir(path, { recursive:true, mode:0o700 });
      if ((await lstat(path)).isSymbolicLink()) throw new Error('连接目录不能使用符号链接。');
      await chmod(path, 0o700);
    }
  }
  private async read(id: string): Promise<RecordData> {
    const file = join(this.directory(id), 'binding.json');
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error('invalid path');
      const record = recordSchema.parse(JSON.parse(await readFile(file,'utf8')));
      if (record.connection.accountId !== id) throw new Error('identity mismatch');
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { const {qrDataUrl,expiresAt,...connection} = initial(id); return { connection, credentials:null, registration:false }; }
      throw new Error('B站连接记录不可读，原凭据未被覆盖。');
    }
  }
  private async write(id: string, record: RecordData) {
    const dir = this.directory(id); await this.prepare(dir);
    const temporary = join(dir, `${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(recordSchema.parse(record)), {mode:0o600}); await rename(temporary,join(dir,'binding.json')); }
    finally { await rm(temporary,{force:true}); }
  }
  private async acquire(id: string): Promise<() => Promise<void>> {
    const directory = this.directory(id); await this.prepare(directory);
    const file = join(directory,'operation.lock');
    for (let attempt=0;attempt<2;attempt++) {
      try {
        const handle = await open(file, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({pid:process.pid,owner:randomUUID()})); } finally { await handle.close(); }
        return async () => { await rm(file,{force:true}); };
      } catch(error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let stale = false;
        try { const owner = JSON.parse(await readFile(file,'utf8')); if (Number.isSafeInteger(owner.pid) && owner.pid > 0) { try { process.kill(owner.pid,0); } catch(e) { stale=(e as NodeJS.ErrnoException).code==='ESRCH'; } } } catch { /* An incomplete lock remains protected. */ }
        if (!stale) throw new Error('此账号正在连接或检查登录，请稍候再试。');
        await rm(file,{force:true});
      }
    }
    throw new Error('无法锁定此账号，请稍后重试。');
  }
  private async completeRegistration(id: string, record: RecordData) {
    if (!record.registration || !record.credentials || !record.connection.identity) return;
    if (!this.register) throw new Error('账号自动保存尚未就绪。');
    await this.register(id, record.connection.identity, this.lifetime.signal);
    record.registration = false;
    record.connection.state = 'connected';
    record.connection.message = '已连接B站，账号信息已自动保存。';
    await this.write(id, record);
  }
  private async response(id: string): Promise<BilibiliConnectionResult> {
    const record = await this.read(id);
    // Finish an interrupted registry write without requesting another scan.
    await this.completeRegistration(id, record);
    const session = this.sessions.get(id);
    const connection: BilibiliConnection = { ...record.connection,qrDataUrl:null,expiresAt:null };
    if (session) {
      connection.expiresAt=session.expiresAt;
      if (session.qrReady && !session.controller.signal.aborted) {
        const bytes = await readFile(join(session.directory,'qrcode.png')).catch(()=>null);
        if (bytes && bytes.length <= 512000 && bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a') {
          connection.state='waiting_scan'; connection.message='请用哔哩哔哩手机端扫码，并在手机上确认。'; connection.qrDataUrl=`data:image/png;base64,${bytes.toString('base64')}`;
        }
      }
    } else if (activeStates.has(connection.state)) {
      connection.state='cancelled'; connection.message='上次连接已中断，请重新连接。';
    } else if (connection.state==='connected' && connection.checkedAt && Date.now()-Date.parse(connection.checkedAt)>15*60*1000) {
      connection.state='unchecked'; connection.message='保留了上次绑定身份，请检查当前登录是否有效。';
    }
    return { runtime: await this.runtime.inspect(), connection };
  }
  async manage(input: BilibiliConnectionRequest, signal: AbortSignal) {
    return this.serial(async () => {
      let request = bilibiliConnectionRequestSchema.parse(input);
      signal.throwIfAborted(); if(this.disposed) throw new Error('服务正在退出，请稍后重试。');
      if (request.action === 'begin') {
        if (!this.register) throw new Error('账号自动保存尚未就绪，请更新后台。');
        const id = `bili-${request.requestId}`;
        const record = await this.read(id);
        if (record.credentials || (await this.accounts()).some(account => account.id === id)) return this.response(id);
        if (!record.registration) { record.registration = true; await this.write(id, record); }
        request = { action: 'start', accountId: id };
      }
      const account = await this.account(request.accountId);
      const id=account.id;
      if(request.action==='status') return this.response(id);
      if(request.action==='cancel') {
        const session=this.sessions.get(id);
        if(session) {
          session.controller.abort(); await session.run.catch(()=>undefined);
          this.sessions.delete(id);
          try { const record=await this.read(id);record.connection.state='cancelled';record.connection.message='连接已取消，原账号绑定保持不变。';await this.write(id,record); }
          finally { await rm(session.directory,{recursive:true,force:true});await session.release(); }
        }
        return this.response(id);
      }
      if(!account.enabled) throw new Error('账号已停用，请先启用。');
      if(this.sessions.has(id)) { if(request.action==='start') return this.response(id); throw new Error('请先完成或取消当前连接。'); }
      if(request.action==='check') {
        const release=await this.acquire(id);
        const temporary=join(this.directory(id),`check-${randomUUID()}.json`);
        try {
          const record=await this.read(id);
          if(!record.credentials) { record.connection.state='disconnected';record.connection.message='没有已验证的登录凭据，请连接平台。'; }
          else {
            await writeFile(temporary,JSON.stringify(record.credentials),{mode:0o600});
            try {
              const identity=await this.runtime.identity(temporary,AbortSignal.any([signal,this.lifetime.signal]));
              if(record.connection.identity && identity.mid!==record.connection.identity.mid) {
                record.connection.state='identity_mismatch';record.connection.message='凭据身份与原绑定不一致，请用原账号重新连接。';
              } else {record.connection.identity=identity;record.connection.state='connected';record.connection.checkedAt=new Date().toISOString();record.connection.message='已从B站核验当前登录身份。';}
            } catch(error) { record.connection.state=error instanceof BilibiliLoginExpired?'expired':'unchecked';record.connection.message=error instanceof BilibiliLoginExpired?'登录已失效，请重新连接。':'本次身份核验失败，请检查网络后重试；保留上次身份。'; }
          }
          await this.write(id,record);
        } finally { await rm(temporary,{force:true});await release(); }
        return this.response(id);
      }
      if(!(await this.runtime.inspect()).available) throw new Error('B站运行时未就绪，请先完成安装。');
      const release=await this.acquire(id);
      const directory=join(this.directory(id),`login-${randomUUID()}`);
      try {
        // Only stale candidates remain when this account has no live operation lock.
        for(const entry of await readdir(this.directory(id))) if(entry.startsWith('login-')) await rm(join(this.directory(id),entry),{recursive:true,force:true});
        await mkdir(directory,{mode:0o700});
        const record=await this.read(id);record.connection.state='starting';record.connection.message='正在获取B站登录二维码…';await this.write(id,record);
        const controller=new AbortController();
        const session: Session={controller,directory,expiresAt:new Date(Date.now()+180000).toISOString(),qrReady:false,release,run:Promise.resolve()};
        this.sessions.set(id,session);
        session.run=this.runtime.login(directory,controller.signal,()=>{session.qrReady=true;});
        void session.run.then(()=>this.serial(()=>this.finish(id,session,null)),error=>this.serial(()=>this.finish(id,session,error))).catch(()=>undefined);
      } catch(error) {this.sessions.delete(id);await rm(directory,{recursive:true,force:true});await release();throw error;}
      return this.response(id);
    });
  }
  private async finish(id: string, session: Session, failure: unknown) {
    if(this.sessions.get(id)!==session) return;
    try {
      const record=await this.read(id);
      if(failure || session.controller.signal.aborted) {
        record.connection.state=session.controller.signal.aborted?'cancelled':failure instanceof BilibiliLoginExpired?'expired':'failed';
        record.connection.message=session.controller.signal.aborted?'连接已取消。':failure instanceof BilibiliLoginExpired?'二维码已过期，请重新连接。':'连接未完成，请检查网络后重试。';
      } else {
        record.connection.state='verifying';record.connection.message='正在核验真实账号身份…';await this.write(id,record);
        const account=await this.account(id);
        if(!account.enabled) throw new Error('disabled');
        const identity=await this.runtime.identity(join(session.directory,'credentials.json'),AbortSignal.any([session.controller.signal,this.lifetime.signal]));
        if(record.connection.identity && record.connection.identity.mid!==identity.mid) {
          record.connection.state='identity_mismatch';record.connection.message='扫码账号与原绑定不同，已拒绝替换。请使用原账号，或另行登记新账号。';
        } else {
          for(const other of await this.accounts()) {
            if(other.id===id || other.platform!=='bilibili') continue;
            if((await this.read(other.id)).connection.identity?.mid===identity.mid) throw new Error('duplicate');
          }
          record.credentials=JSON.parse(await readFile(join(session.directory,'credentials.json'),'utf8'));
          record.connection.identity=identity;record.connection.checkedAt=new Date().toISOString();record.connection.state='connected';record.connection.message='已从B站核验真实身份，登录态仅保存在本机。';
        }
      }
      await this.write(id,record);
      await this.completeRegistration(id, record);
    } catch(error) {
      const record=await this.read(id);
      record.connection.state='failed';record.connection.message=error instanceof Error && error.message==='duplicate'?'该B站身份已绑定其他本地账号，请使用已有账号。':'未能核验账号身份，未替换原凭据，请重新连接。';
      await this.write(id,record);
    } finally {this.sessions.delete(id);await rm(session.directory,{recursive:true,force:true});await session.release();}
  }
  async dispose() {
    this.disposed=true;this.lifetime.abort();
    for(const session of this.sessions.values()) session.controller.abort();
    await Promise.all([...this.sessions.values()].map(session=>session.run.catch(()=>undefined)));
    await this.tail;
  }
}
