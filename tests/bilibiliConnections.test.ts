import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BilibiliConnectionsService } from '../src/bilibiliConnections.ts';
import { BilibiliLoginExpired, readBilibiliIdentity, type BilibiliRuntime } from '../src/bilibiliRuntime.ts';
import type { ContentAccount } from '../src/contentAccountSchemas.ts';
import type { BilibiliIdentity } from '../src/bilibiliConnectionSchemas.ts';

const roots: string[]=[];const services: BilibiliConnectionsService[]=[];
const signal=()=>new AbortController().signal;
const account=(id='a'):ContentAccount=>({id,name:id,platform:'bilibili',homepage:'',notes:'',enabled:true,updatedAt:'2026-01-01T00:00:00Z'});
class FakeRuntime implements BilibiliRuntime {
  pending: {dir:string;resolve:()=>void;reject:(error:Error)=>void}[]=[];
  user: BilibiliIdentity={mid:'100',name:'真实昵称'};
  identityError: Error|null=null;
  calls=0;
  async inspect(){return {available:true,version:'1.2.4' as const,message:'ready'};}
  async identity(){if(this.identityError)throw this.identityError;return this.user;}
  async login(dir:string,stop:AbortSignal,qr:()=>void){
    this.calls++;
    await writeFile(join(dir,'qrcode.png'),Buffer.from('89504e470d0a1a0a','hex'));
    qr();
    return new Promise<void>((resolve,reject)=>{
      this.pending.push({dir,resolve,reject});
      const abort=()=>reject(new Error('cancelled'));
      stop.addEventListener('abort',abort,{once:true});if(stop.aborted)abort();
    });
  }
  async complete(index=0){const job=this.pending[index]!;await writeFile(join(job.dir,'credentials.json'),JSON.stringify({cookie_info:{cookies:[{name:'SESSDATA',value:'SECRET'}]},token_info:{access_token:'TOKEN'}}));job.resolve();}
}
async function setup(accounts=[account()]){
 const root=await mkdtemp(join(tmpdir(),'azu-bili-connect-'));roots.push(root);const runtime=new FakeRuntime();
 const service=new BilibiliConnectionsService(root,async()=>accounts,runtime);services.push(service);return {root,runtime,service,accounts};
}
async function settled(service:BilibiliConnectionsService,id='a'){
 for(let i=0;i<40;i++) {const value=await service.manage({action:'status',accountId:id},signal());if(!['starting','waiting_scan','verifying'].includes(value.connection.state))return value;await new Promise(r=>setTimeout(r,5));}
 throw new Error('not settled');
}
afterEach(async()=>{await Promise.all(services.splice(0).map(s=>s.dispose()));await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));});

describe('Bilibili connection service',()=>{
 it('waits for actual identity, persists it privately and never returns credentials',async()=>{
  const {service,runtime,root,accounts}=await setup();
  await service.manage({action:'start',accountId:'a'},signal());
  await vi.waitFor(()=>expect(runtime.pending).toHaveLength(1));
  const waiting=await service.manage({action:'status',accountId:'a'},signal());
  expect(waiting.connection.state).toBe('waiting_scan');expect(waiting.connection.identity).toBeNull();
  await runtime.complete();const connected=await settled(service);
  expect(connected.connection).toMatchObject({state:'connected',identity:{mid:'100',name:'真实昵称'}});
  expect(JSON.stringify(connected)).not.toMatch(/SECRET|TOKEN|cookie_info|credentials.json/);
  const directory=join(service.root,(await readdir(service.root))[0]!);
  expect((await stat(join(directory,'binding.json'))).mode & 0o777).toBe(0o600);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  expect((await readdir(directory)).filter(name=>name.startsWith('login-'))).toEqual([]);
  const restarted=new BilibiliConnectionsService(root,async()=>accounts,runtime);services.push(restarted);
  expect((await restarted.manage({action:'check',accountId:'a'},signal())).connection.state).toBe('connected');
 });
 it('coalesces duplicate starts and cancels with QR cleanup',async()=>{
  const {service,runtime}=await setup();
  await Promise.all([service.manage({action:'start',accountId:'a'},signal()),service.manage({action:'start',accountId:'a'},signal())]);
  expect(runtime.calls).toBe(1);await vi.waitFor(()=>expect(runtime.pending).toHaveLength(1));
  const cancelled=await service.manage({action:'cancel',accountId:'a'},signal());
  expect(cancelled.connection.state).toBe('cancelled');expect(cancelled.connection.qrDataUrl).toBeNull();
  expect(await stat(runtime.pending[0]!.dir).catch(()=>null)).toBeNull();
 });
 it('keeps original identity and credentials on a mismatched reconnect',async()=>{
  const {service,runtime}=await setup();await service.manage({action:'start',accountId:'a'},signal());await vi.waitFor(()=>expect(runtime.pending.length).toBe(1));await runtime.complete();await settled(service);
  const dir=join(service.root,(await readdir(service.root))[0]!);const before=JSON.parse(await readFile(join(dir,'binding.json'),'utf8')).credentials;
  runtime.user={mid:'200',name:'另一个人'};
  await service.manage({action:'start',accountId:'a'},signal());await vi.waitFor(()=>expect(runtime.pending.length).toBe(2));await runtime.complete(1);
  const result=await settled(service);expect(result.connection.state).toBe('identity_mismatch');expect(result.connection.identity?.mid).toBe('100');
  expect(JSON.parse(await readFile(join(dir,'binding.json'),'utf8')).credentials).toEqual(before);
 });
 it('isolates two accounts and rejects reusing a bound platform identity',async()=>{
  const {service,runtime}=await setup([account('a'),account('b')]);
  await service.manage({action:'start',accountId:'a'},signal());await vi.waitFor(()=>expect(runtime.pending.length).toBe(1));await runtime.complete();await settled(service);
  await service.manage({action:'start',accountId:'b'},signal());await vi.waitFor(()=>expect(runtime.pending.length).toBe(2));expect(runtime.pending[0]!.dir).not.toBe(runtime.pending[1]!.dir);
  await runtime.complete(1);const duplicate=await settled(service,'b');expect(duplicate.connection.state).toBe('failed');expect(duplicate.connection.message).toContain('已绑定');
  runtime.user={mid:'300',name:'第二账号'};await service.manage({action:'start',accountId:'b'},signal());await vi.waitFor(()=>expect(runtime.pending.length).toBe(3));await runtime.complete(2);
  expect((await settled(service,'b')).connection.identity?.mid).toBe('300');expect((await service.manage({action:'status',accountId:'a'},signal())).connection.identity?.mid).toBe('100');
 });
 it('distinguishes expired login from a network failure, preserving last verified identity',async()=>{
  const {service,runtime}=await setup();await service.manage({action:'start',accountId:'a'},signal());await vi.waitFor(()=>expect(runtime.pending.length).toBe(1));await runtime.complete();await settled(service);
  runtime.identityError=new Error('SECRET raw upstream error');expect((await service.manage({action:'check',accountId:'a'},signal())).connection.state).toBe('unchecked');
  runtime.identityError=new BilibiliLoginExpired();const expired=await service.manage({action:'check',accountId:'a'},signal());expect(expired.connection.state).toBe('expired');expect(expired.connection.identity?.mid).toBe('100');expect(JSON.stringify(expired)).not.toContain('SECRET');
 });
 it('rejects unsupported and disabled accounts, and locks the same account across service instances',async()=>{
  const {service,runtime,accounts,root}=await setup([account(),{...account('disabled'),enabled:false},{...account('xhs'),platform:'xiaohongshu'}]);
  await expect(service.manage({action:'start',accountId:'disabled'},signal())).rejects.toThrow('停用');
  await expect(service.manage({action:'start',accountId:'xhs'},signal())).rejects.toThrow('B站');
  await service.manage({action:'start',accountId:'a'},signal());
  const other=new BilibiliConnectionsService(root,async()=>accounts,runtime);services.push(other);
  await expect(other.manage({action:'start',accountId:'a'},signal())).rejects.toThrow('正在连接');
 });
 it('marks interrupted login after restart and does not forge a connected state',async()=>{
  const {service,runtime,root,accounts}=await setup();await service.manage({action:'start',accountId:'a'},signal());await vi.waitFor(()=>expect(runtime.pending.length).toBe(1));await service.dispose();
  const other=new BilibiliConnectionsService(root,async()=>accounts,runtime);services.push(other);
  const state=await other.manage({action:'status',accountId:'a'},signal());expect(state.connection.state).toBe('cancelled');expect(state.connection.identity).toBeNull();expect(state.connection.qrDataUrl).toBeNull();
 });
});
describe('Bilibili identity reader',()=>{
 it('uses only the fixed platform endpoint and validates cookie identity against the response',async()=>{
  const {root}=await setup();const file=join(root,'login.json');await writeFile(file,JSON.stringify({cookie_info:{cookies:[{name:'SESSDATA',value:'secret'},{name:'DedeUserID',value:'100'}]}}));
  const request=vi.fn(async()=>new Response(JSON.stringify({code:0,data:{mid:100,name:'昵称'}}))) as unknown as typeof fetch;
  expect(await readBilibiliIdentity(file,signal(),request)).toEqual({mid:'100',name:'昵称'});
  expect(request).toHaveBeenCalledWith('https://api.bilibili.com/x/space/myinfo',expect.objectContaining({redirect:'error'}));
  await expect(readBilibiliIdentity(file,signal(),async()=>new Response(JSON.stringify({code:0,data:{mid:200,name:'其他'}})))).rejects.toThrow('不一致');
  await expect(readBilibiliIdentity(file,signal(),async()=>new Response(JSON.stringify({code:-101})))).rejects.toBeInstanceOf(BilibiliLoginExpired);
 });
});
