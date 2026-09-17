import type { BilibiliConnectionRequest, BilibiliConnectionResult } from "./bilibiliConnectionSchemas.ts";
import { z } from "zod";

export const CONTENT_PLATFORMS = {
  douyin: "抖音", xiaohongshu: "小红书", bilibili: "哔哩哔哩", wechat_channels: "视频号", wechat: "微信公众号", blog: "博客", other: "其他",
} as const;
const platformSchema = z.enum(["douyin", "xiaohongshu", "bilibili", "wechat_channels", "wechat", "blog", "other"]);
const webUrl = z.string().trim().max(2048).refine(value => {
  if (value === "") return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, "请输入有效的 http 或 https 链接");
const id = z.string().min(1).max(100);
const accountFields = {
  platform: platformSchema, name: z.string().trim().min(1, "请输入账号名称").max(80),
  homepage: webUrl, notes: z.string().trim().max(2000), enabled: z.boolean(),
};
export const contentAccountSchema = z.object({ id, ...accountFields, updatedAt: z.iso.datetime() });
export const contentPublicationSchema = z.object({
  projectId: id, accountId: id, status: z.enum(["pending", "published"]),
  url: webUrl, publishedAt: z.iso.datetime().nullable(), updatedAt: z.iso.datetime(),
});
export const contentAccountSnapshotSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  accounts: z.array(contentAccountSchema), publications: z.array(contentPublicationSchema),
});
const revision = { expectedRevision: z.number().int().nonnegative() };
export const contentAccountRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get") }),
  z.object({ action: z.literal("saveAccount"), ...revision, id: id.optional(), ...accountFields }),
  z.object({ action: z.literal("setTargets"), ...revision, projectId: id, accountIds: z.array(id).max(100) }),
  z.object({ action: z.literal("savePublication"), ...revision, projectId: id, accountId: id,
    status: z.enum(["pending", "published"]), url: webUrl, publishedAt: z.iso.datetime().nullable() }),
]);
export type ContentAccount = z.infer<typeof contentAccountSchema>;
export type ContentPublication = z.infer<typeof contentPublicationSchema>;
export type ContentAccountSnapshot = z.infer<typeof contentAccountSnapshotSchema>;
export type ContentAccountRequest = z.infer<typeof contentAccountRequestSchema>;
export interface ContentAccountFace {
  connectBilibili?: (request: BilibiliConnectionRequest) => Promise<BilibiliConnectionResult>;
  manage: (request: ContentAccountRequest) => Promise<ContentAccountSnapshot>;
}
