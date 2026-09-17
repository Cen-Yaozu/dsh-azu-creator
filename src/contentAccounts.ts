import type { BilibiliIdentity } from "./bilibiliConnectionSchemas.ts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  contentAccountRequestSchema, contentAccountSnapshotSchema,
  type ContentAccountRequest, type ContentAccountSnapshot,
} from "./contentAccountSchemas.ts";

/** Local account registration and manual publication records; never stores platform credentials. */
export class ContentAccountsService {
  readonly file: string;
  constructor(readonly dataDir: string, private readonly project: (id: string) => Promise<{ stage: string }>) {
    this.file = join(dataDir, "content-accounts.json");
  }

  private async read(): Promise<ContentAccountSnapshot> {
    try { return contentAccountSnapshotSchema.parse(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, revision: 0, accounts: [], publications: [] };
      throw new Error("账号记录读取失败，请检查数据文件；原文件未被覆盖。", { cause: error });
    }
  }

  async manage(input: ContentAccountRequest, signal: AbortSignal): Promise<ContentAccountSnapshot> {
    const request = contentAccountRequestSchema.parse(input);
    signal.throwIfAborted();
    if (request.action === "get") return this.read();
    return this.update(async state => {
      if (state.revision !== request.expectedRevision) throw new Error("账号或发布记录已更新，请重新读取后再保存。");
      const now = new Date().toISOString();
      if (request.action === "saveAccount") {
        const previous = state.accounts.find(account => account.id === request.id);
        if (request.id && !previous) throw new Error("账号不存在，请重新读取。");
        if (previous && previous.platform !== request.platform) {
          throw new Error("已登记账号不能修改所属平台，请新增账号。");
        }
        const { name, platform, homepage, notes, enabled } = request;
        const account = { id: previous?.id ?? randomUUID(), name, platform, homepage, notes, enabled, updatedAt: now };
        state.accounts = previous ? state.accounts.map(row => row.id === previous.id ? account : row) : [...state.accounts, account];
      } else {
        const project = await this.project(request.projectId);
        if (project.stage === "archived") throw new Error("内容已归档，发布记录只读。");
        const rows = state.publications.filter(row => row.projectId === request.projectId);
        if (request.action === "setTargets") {
          const ids = [...new Set(request.accountIds)];
          if (rows.some(row => row.status === "published" && !ids.includes(row.accountId))) throw new Error("请保留已有发布结果的账号；如需移除，先将记录改为待发布。");
          for (const id of ids) {
            const account = state.accounts.find(row => row.id === id);
            if (!account || (!account.enabled && !rows.some(row => row.accountId === id))) throw new Error("目标账号不存在或已停用。");
          }
          state.publications = [
            ...state.publications.filter(row => row.projectId !== request.projectId),
            ...ids.map(accountId => rows.find(row => row.accountId === accountId) ?? {
              projectId: request.projectId, accountId, status: "pending" as const, url: "", publishedAt: null, updatedAt: now,
            }),
          ];
        } else {
          const row = rows.find(row => row.accountId === request.accountId);
          if (!row) throw new Error("请先将此账号加入内容的目标账号。");
          if (request.status === "published" && (!request.url || !request.publishedAt)) throw new Error("登记已发布需要填写发布链接和时间。");
          if (request.status === "published" && Date.parse(request.publishedAt!) > Date.now() + 60_000) throw new Error("发布时间不能晚于当前时间。");
          row.status = request.status;
          row.url = request.status === "published" ? request.url : "";
          row.publishedAt = request.status === "published" ? request.publishedAt : null;
          row.updatedAt = now;
        }
      }
    }, signal);
  }

  /** Called only after the platform adapter has verified a real identity. */
  async registerBilibili(id: string, identity: BilibiliIdentity, signal: AbortSignal): Promise<void> {
    await this.update(async state => {
      const previous = state.accounts.find(account => account.id === id);
      if (previous) {
        if (previous.platform !== "bilibili") throw new Error("账号平台不匹配。");
        return;
      }
      state.accounts.push({ id, platform: "bilibili", name: identity.name.slice(0, 80),
        homepage: `https://space.bilibili.com/${identity.mid}`, notes: "", enabled: true, updatedAt: new Date().toISOString() });
    }, signal);
  }

  private async update(change: (state: ContentAccountSnapshot) => Promise<void>, signal: AbortSignal): Promise<ContentAccountSnapshot> {
    await mkdir(this.dataDir, { recursive: true });
    const lock = `${this.file}.lock`;
    let locked = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      signal.throwIfAborted();
      try { await mkdir(lock); locked = true; break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    if (!locked) throw new Error("账号记录正在保存，请稍后重试。");
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const state = await this.read();
      await change(state);
      signal.throwIfAborted();
      state.revision++;
      await writeFile(temporary, JSON.stringify(contentAccountSnapshotSchema.parse(state), null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, this.file);
      return state;
    } finally {
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
}
