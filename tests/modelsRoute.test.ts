import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import {
  collectModels,
  createModelsHandler,
  extractModelId,
  registerModelsRoutes,
} from "../src/modelsRoute.ts";

function createMockResponse() {
  const headers = new Map<string, unknown>();
  let statusCode = 200;
  let body = "";
  let ended = false;

  const res = {
    setHeader: vi.fn((key: string, value: unknown) => {
      headers.set(key.toLowerCase(), value);
    }),
    getHeader: vi.fn((key: string) => headers.get(key.toLowerCase())),
    writeHead: vi.fn((code: number, newHeaders?: Record<string, unknown>) => {
      statusCode = code;
      if (newHeaders) {
        for (const [k, v] of Object.entries(newHeaders)) {
          headers.set(k.toLowerCase(), v);
        }
      }
    }),
    end: vi.fn((chunk?: unknown) => {
      if (chunk) body += String(chunk);
      ended = true;
    }),
    get statusCode() {
      return statusCode;
    },
    get headers() {
      return headers;
    },
    get body() {
      return body;
    },
    get ended() {
      return ended;
    },
  } as unknown as ServerResponse & {
    headers: Map<string, unknown>;
    body: string;
    ended: boolean;
  };

  return res;
}

function createMockRequest(options: { method?: string; url?: string }) {
  return {
    method: options.method ?? "GET",
    url: options.url ?? "/models",
  } as unknown as IncomingMessage;
}

describe("modelsRoute", () => {
  describe("extractModelId", () => {
    it("returns null for list paths", () => {
      expect(extractModelId("/models")).toBeNull();
      expect(extractModelId("/models/")).toBeNull();
      expect(extractModelId("/v1/models")).toBeNull();
      expect(extractModelId("/v1/models/")).toBeNull();
    });

    it("extracts model id from /models/:id and /v1/models/:id", () => {
      expect(extractModelId("/models/deepseek-chat")).toBe("deepseek-chat");
      expect(extractModelId("/models/deepseek-reasoner/")).toBe("deepseek-reasoner");
      expect(extractModelId("/v1/models/custom-model")).toBe("custom-model");
      expect(extractModelId("/v1/models/gpt-4o%2Fmini")).toBe("gpt-4o/mini");
    });

    it("returns null for unrelated paths", () => {
      expect(extractModelId("/api/other")).toBeNull();
      expect(extractModelId("/")).toBeNull();
    });
  });

  describe("collectModels", () => {
    it("returns built-in default models when ctx has no llm or settings", async () => {
      const emptyCtx = {} as never;
      const models = await collectModels(emptyCtx);

      expect(models.length).toBeGreaterThanOrEqual(4);
      const ids = models.map((m) => m.id);
      expect(ids).toContain("deepseek-flash");
      expect(ids).toContain("deepseek-v4-pro");
      expect(ids).toContain("deepseek-chat");
      expect(ids).toContain("deepseek-reasoner");

      for (const m of models) {
        expect(m.object).toBe("model");
        expect(m.owned_by).toBe("deepseek");
        expect(m.created).toBeTypeOf("number");
      }
    });

    it("includes custom models and deduplicates", async () => {
      const emptyCtx = {} as never;
      const models = await collectModels(emptyCtx, ["my-special-model", "deepseek-chat"]);

      const ids = models.map((m) => m.id);
      expect(ids).toContain("my-special-model");
      expect(ids).toContain("deepseek-chat");
      // Check deduplication
      expect(ids.filter((id) => id === "deepseek-chat").length).toBe(1);
      const custom = models.find((m) => m.id === "my-special-model");
      expect(custom?.owned_by).toBe("custom");
    });

    it("discovers models from ctx.llm providers and settings", async () => {
      const mockCtx = {
        llm: {
          listProviders: () => [{ id: "mock-provider" }],
          listModels: async (provider: string) => [
            { id: "mock-model-1", provider },
            "mock-model-2",
          ],
        },
        settings: {
          get: (ns: string) => {
            if (ns === "llm-deepseek") {
              return { models: ["settings-deepseek-model"] };
            }
            if (ns === "llm-pi-ai") {
              return {
                providers: {
                  openrouter: { models: ["anthropic/claude-3.5-sonnet"] },
                  ollama: { models: [{ id: "llama3:latest" }] },
                },
              };
            }
            if (ns === "agent-default-model") {
              return { provider: "deepseek", model: "custom-default-agent-model" };
            }
            return undefined;
          },
        },
      } as never;

      const models = await collectModels(mockCtx);
      const ids = models.map((m) => m.id);
      expect(ids).toContain("mock-model-1");
      expect(ids).toContain("mock-model-2");
      expect(ids).toContain("settings-deepseek-model");
      expect(ids).toContain("anthropic/claude-3.5-sonnet");
      expect(ids).toContain("llama3:latest");
      expect(ids).toContain("custom-default-agent-model");
      expect(ids).toContain("deepseek-chat"); // Defaults also present
    });

    it("filters models by provider query option", async () => {
      const mockCtx = {
        settings: {
          get: (ns: string) => {
            if (ns === "llm-pi-ai") {
              return {
                providers: {
                  "opencode-go": {
                    models: [
                      { id: "minimax-m3", name: "MiniMax-M3" },
                      { id: "qwen3.8-max", name: "Qwen3.8 Max" },
                    ],
                  },
                  ollama: {
                    models: [{ id: "llama3:latest" }],
                  },
                },
              };
            }
            return undefined;
          },
        },
      } as never;

      const opencodeModels = await collectModels(mockCtx, [], { provider: "opencode-go" });
      expect(opencodeModels.length).toBe(2);
      expect(opencodeModels.every((m) => m.owned_by === "opencode-go")).toBe(true);
      expect(opencodeModels.map((m) => m.id)).toEqual(["minimax-m3", "qwen3.8-max"]);

      const deepseekModels = await collectModels(mockCtx, [], { provider: "deepseek" });
      expect(deepseekModels.every((m) => m.owned_by === "deepseek")).toBe(true);
      expect(deepseekModels.map((m) => m.id)).not.toContain("minimax-m3");
    });
  });

  describe("createModelsHandler", () => {
    it("handles OPTIONS request with 204 and CORS headers", async () => {
      const handler = createModelsHandler({} as never);
      const req = createMockRequest({ method: "OPTIONS", url: "/models" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
      expect(res.ended).toBe(true);
    });

    it("rejects non-GET/HEAD methods with 405", async () => {
      const handler = createModelsHandler({} as never);
      const req = createMockRequest({ method: "POST", url: "/models" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, OPTIONS");
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("method_not_allowed");
    });

    it("serves list of models on GET /models with OpenAI format", async () => {
      const handler = createModelsHandler({} as never);
      const req = createMockRequest({ method: "GET", url: "/models" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");

      const body = JSON.parse(res.body);
      expect(body.object).toBe("list");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(4);
      expect(body.data.some((m: { id: string }) => m.id === "deepseek-flash")).toBe(true);
      expect(body.data.some((m: { id: string }) => m.id === "deepseek-chat")).toBe(true);
    });

    it("serves list of models on GET /v1/models", async () => {
      const handler = createModelsHandler({} as never);
      const req = createMockRequest({ method: "GET", url: "/v1/models" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.object).toBe("list");
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("serves single model detail on GET /models/:id", async () => {
      const handler = createModelsHandler({} as never);
      const req = createMockRequest({ method: "GET", url: "/models/deepseek-chat" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe("deepseek-chat");
      expect(body.object).toBe("model");
      expect(body.owned_by).toBe("deepseek");
    });

    it("returns 404 for non-existent model on GET /models/:id", async () => {
      const handler = createModelsHandler({} as never);
      const req = createMockRequest({ method: "GET", url: "/models/unknown-model-xyz" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("model_not_found");
      expect(body.error.message).toContain("unknown-model-xyz");
    });

    it("handles HEAD /models without body", async () => {
      const handler = createModelsHandler({} as never);
      const req = createMockRequest({ method: "HEAD", url: "/models" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("");
    });
  });

  describe("registerModelsRoutes", () => {
    it("registers /models and /v1/models with prefix kind and unregisters cleanly", () => {
      const registeredRoutes: Array<{ kind: string; path: string }> = [];
      const unregisterCalls: string[] = [];

      const mockWebServer = {
        register: vi.fn((route: { kind: string; path: string }) => {
          registeredRoutes.push(route);
          return () => {
            unregisterCalls.push(route.path);
          };
        }),
      };

      const mockCtx = {
        webServer: mockWebServer,
      } as never;

      const dispose = registerModelsRoutes(mockCtx);

      expect(mockWebServer.register).toHaveBeenCalledTimes(2);
      expect(registeredRoutes).toEqual([
        expect.objectContaining({ kind: "prefix", path: "/models" }),
        expect.objectContaining({ kind: "prefix", path: "/v1/models" }),
      ]);

      dispose();
      expect(unregisterCalls).toEqual(["/models", "/v1/models"]);
    });

    it("safely handles context without webServer", () => {
      const dispose = registerModelsRoutes({} as never);
      expect(() => dispose()).not.toThrow();
    });
  });
});
