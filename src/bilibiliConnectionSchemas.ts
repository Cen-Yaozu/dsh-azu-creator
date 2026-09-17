import { z } from 'zod';
export const bilibiliIdentitySchema = z.object({ mid: z.string().regex(/^\d+$/), name: z.string().min(1).max(200) });
export const bilibiliConnectionSchema = z.object({
  accountId: z.string(),
  state: z.enum(['disconnected','starting','waiting_scan','verifying','connected','expired','cancelled','failed','identity_mismatch','unchecked']),
  identity: bilibiliIdentitySchema.nullable(),
  checkedAt: z.iso.datetime().nullable(),
  message: z.string(),
  qrDataUrl: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export const bilibiliConnectionRequestSchema = z.union([
  z.object({ action: z.literal('begin'), requestId: z.uuid() }),
  z.object({ action: z.enum(['status','start','check','cancel']), accountId: z.string().min(1).max(100) }),
]);
export const bilibiliConnectionResultSchema = z.object({
  runtime: z.object({ available: z.boolean(), version: z.literal('1.2.4'), message: z.string() }),
  connection: bilibiliConnectionSchema,
});
export type BilibiliIdentity = z.infer<typeof bilibiliIdentitySchema>;
export type BilibiliConnection = z.infer<typeof bilibiliConnectionSchema>;
export type BilibiliConnectionRequest = z.infer<typeof bilibiliConnectionRequestSchema>;
export type BilibiliConnectionResult = z.infer<typeof bilibiliConnectionResultSchema>;
