import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { bilibiliIdentitySchema, type BilibiliIdentity } from './bilibiliConnectionSchemas.ts';

export class BilibiliLoginExpired extends Error {}
export interface BilibiliRuntime {
  inspect(): Promise<{ available: boolean; version: '1.2.4'; message: string }>;
  login(directory: string, signal: AbortSignal, qrReady: () => void): Promise<void>;
  identity(credentials: string, signal: AbortSignal): Promise<BilibiliIdentity>;
}
const credentialSchema = z.object({ cookie_info: z.object({ cookies: z.array(z.object({ name: z.string(), value: z.string() })).min(1) }) });

/** Read only our own pinned runtime's credentials and send them to the fixed Bilibili endpoint. */
export async function readBilibiliIdentity(file: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<BilibiliIdentity> {
  const credentials = credentialSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  const cookies = credentials.cookie_info.cookies;
  if (!cookies.some(row => row.name === 'SESSDATA' && row.value)) throw new BilibiliLoginExpired('登录凭据已失效，请重新连接。');
  if (cookies.some(row => !/^[A-Za-z0-9_]+$/.test(row.name) || /[\r\n;]/.test(row.value))) throw new Error('凭据格式异常，请重新连接。');
  const response = await request('https://api.bilibili.com/x/space/myinfo', {
    headers: { Cookie: cookies.map(row => `${row.name}=${row.value}`).join('; '), 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' },
    redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error('暂时无法核验 B 站身份，请稍后检查登录。');
  const body = z.object({ code: z.number(), data: z.unknown().optional() }).parse(await response.json());
  if (body.code === -101 || body.code === -111) throw new BilibiliLoginExpired('B 站登录已失效，请重新连接。');
  if (body.code !== 0) throw new Error('B 站未返回有效身份，请稍后检查登录。');
  const user = z.object({ mid: z.number().int().positive().safe(), name: z.string().min(1).max(200) }).parse(body.data);
  const localMid = cookies.find(row => row.name === 'DedeUserID')?.value;
  if (localMid && localMid !== String(user.mid)) throw new Error('B 站身份与凭据不一致，请重新连接。');
  return bilibiliIdentitySchema.parse({ mid: String(user.mid), name: user.name });
}

export class NativeBilibiliRuntime implements BilibiliRuntime {
  readonly binary: string;
  constructor(dataDir: string) { this.binary = join(dataDir, 'platform-runtime', 'biliup', '1.2.4', 'biliup'); }
  async inspect() {
    try {
      if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('platform');
      const hash = createHash('sha256').update(await readFile(this.binary)).digest('hex');
      if (hash !== '1a0d178ae7be6be76f060e12d7910b30798334d1f1921f226a8311ad003a588a') throw new Error('checksum');
      await promisify(execFile)('python3', ['-c','import pty, select, signal'], {timeout:5000});
      return { available: true, version: '1.2.4' as const, message: 'B站连接运行时已就绪' };
    } catch { return { available: false, version: '1.2.4' as const, message: 'B站连接运行时缺失或校验失败，请运行项目的 install-biliup 安装脚本。' }; }
  }
  async login(directory: string, signal: AbortSignal, qrReady: () => void): Promise<void> {
    signal.throwIfAborted();
    if (!(await this.inspect()).available) throw new Error('B站连接运行时不可用。');
    return new Promise((resolve, reject) => {
      const child = spawn('python3', [fileURLToPath(new URL('../scripts/bilibili-login.py', import.meta.url)), this.binary, directory], { stdio: ['ignore','pipe','ignore'] });
      let buffer = '';
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => { child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 3000); };
      signal.addEventListener('abort', abort, {once:true});
      child.stdout.on('data', bytes => {
        buffer += bytes.toString();
        if (buffer.length > 32768) { child.kill('SIGTERM'); return; }
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) {
          try { if (JSON.parse(line).event === 'qr_ready') qrReady(); } catch { /* Ignore non-protocol output. */ }
        }
      });
      const cleanup = () => { signal.removeEventListener('abort', abort); if (killTimer) clearTimeout(killTimer); };
      child.once('error', () => { cleanup(); reject(new Error('无法启动B站连接运行时。')); });
      child.once('close', code => {
        cleanup();
        if (signal.aborted) reject(new Error('连接已取消。'));
        else if (code === 2) reject(new BilibiliLoginExpired('二维码已过期，请重新连接。'));
        else if (code !== 0) reject(new Error('B站扫码未完成或网络异常，请重新连接。'));
        else resolve();
      });
      if (signal.aborted) abort();
    });
  }
  async identity(file: string, signal: AbortSignal) { await chmod(file, 0o600); return readBilibiliIdentity(file, signal); }
}
