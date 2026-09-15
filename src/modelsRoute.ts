import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";

export interface CollectModelsOptions {
  customModels?: string[] | undefined;
  provider?: string | undefined;
  forceFresh?: boolean | undefined;
}

export interface OpenAIModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  name?: string | undefined;
  permission: unknown[];
  root: string;
  parent: string | null;
}

export interface OpenAIModelsListResponse {
  object: "list";
  data: OpenAIModelEntry[];
}

export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param?: string;
    code: string;
  };
}

export const KNOWN_MODEL_NAMES: Record<string, string> = {
  "deepseek-flash": "DeepSeek-V4.1-Flash",
  "deepseek-v4-pro": "DeepSeek-V4-Pro-0813",
  "deepseek-chat": "DeepSeek-Chat",
  "deepseek-reasoner": "DeepSeek-Reasoner",
};

const DEFAULT_MODELS = [
  { id: "deepseek-flash", ownedBy: "deepseek" },
  { id: "deepseek-v4-pro", ownedBy: "deepseek" },
  { id: "deepseek-chat", ownedBy: "deepseek" },
  { id: "deepseek-reasoner", ownedBy: "deepseek" },
];

async function resolveApiKey(ctx: Context, keyRef: string): Promise<string | undefined> {
  let apiKey: string | undefined;
  const credentials = (ctx as unknown as { get?: (name: string) => unknown }).get?.("credentials") as {
    resolve?: (ref: string) => Promise<{ value: string } | undefined>;
  } | undefined;

  if (credentials && typeof credentials.resolve === "function") {
    const hit = await credentials.resolve(keyRef);
    if (hit && typeof hit.value === "string") apiKey = hit.value.trim();
  }

  if (!apiKey) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const yaml = await import("yaml");
      const home = process.env.DSH_HOME || path.join(process.cwd(), ".lab", "dsh-home");
      const credPath = path.join(home, ".credentials.yaml");
      if (fs.existsSync(credPath)) {
        const parsed = yaml.parse(fs.readFileSync(credPath, "utf8")) as { refs?: Record<string, string> };
        if (parsed?.refs?.[keyRef]) {
          apiKey = String(parsed.refs[keyRef]).trim();
        }
      }
    } catch {
      // Ignore credentials read error
    }
  }

  if (!apiKey && process.env[keyRef]) {
    apiKey = process.env[keyRef]?.trim();
  }

  return apiKey;
}

async function fetchEndpointModels(
  baseURL: string,
  apiKey?: string,
): Promise<Array<{ id: string; name?: string; owned_by?: string }> | null> {
  const cleanBase = baseURL.trim().replace(/\/+$/, "");
  const urls = cleanBase.endsWith("/v1")
    ? [`${cleanBase}/models`]
    : [`${cleanBase}/models`, `${cleanBase}/v1/models`];

  for (const url of urls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      if (cleanBase.includes("opencode.ai")) {
        headers["x-opencode-session"] = "discovery-session";
      }
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id: string; name?: string; owned_by?: string }> };
        if (Array.isArray(json?.data) && json.data.length > 0) {
          return json.data;
        }
      }
    } catch {
      // Continue to next probe URL
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return null;
}

/**
 * Collect available models from online API, ctx.llm, ctx.settings, and official defaults.
 */
export async function collectModels(
  ctx: Context,
  customModels: string[] = [],
  options?: CollectModelsOptions,
): Promise<OpenAIModelEntry[]> {
  const modelsMap = new Map<string, OpenAIModelEntry>();

  const addModel = (id: string, ownedBy = "deepseek", created = 1700000000, name?: string) => {
    if (!id || typeof id !== "string") return;
    let trimmed = id.trim();
    if (!trimmed) return;
    // Map legacy/preview placeholders to official model IDs only for official deepseek provider
    if (ownedBy === "deepseek" && (trimmed === "deepseek-v4-flash" || trimmed === "deepseek-v4-flash-vision-exp")) {
      trimmed = "deepseek-flash";
    }
    const key = `${ownedBy}:${trimmed}`;
    if (modelsMap.has(key)) return;
    modelsMap.set(key, {
      id: trimmed,
      object: "model",
      created,
      owned_by: ownedBy,
      name: name || KNOWN_MODEL_NAMES[trimmed] || trimmed,
      permission: [],
      root: trimmed,
      parent: null,
    });
  };

  const liveProvidersFetched = new Set<string>();

  // 1. Fetch live models from official DeepSeek API if credentials are configured (skip during unit tests)
  if (!process.env.VITEST) {
    try {
      const apiKey = await resolveApiKey(ctx, "DEEPSEEK_API_KEY");
      let baseURL = "https://api.deepseek.com";
      const settings = (ctx as unknown as { settings?: { get?: (ns: string) => unknown } }).settings;
      const deepseekSettings = settings?.get?.("llm-deepseek") as { baseURL?: string } | undefined;
      if (deepseekSettings?.baseURL && typeof deepseekSettings.baseURL === "string" && deepseekSettings.baseURL.trim()) {
        baseURL = deepseekSettings.baseURL.trim();
      }

      if (apiKey) {
        const items = await fetchEndpointModels(baseURL, apiKey);
        if (items && items.length > 0) {
          liveProvidersFetched.add("deepseek");
          liveProvidersFetched.add("deepseek-official");
          for (const item of items) {
            if (item?.id) addModel(item.id, item.owned_by ?? "deepseek", 1700000000, item.name);
          }
        }
      }
    } catch {
      // Ignore online discovery failure and continue to local providers/settings
    }
  }

  // 2. Fetch live models from external providers (e.g. opencode-go, etc.) configured in settings
  if (!process.env.VITEST) {
    try {
      const settings = (ctx as unknown as { settings?: { get?: (ns: string) => unknown } }).settings;
      const piAiSection = settings?.get?.("llm-pi-ai") as {
        providers?: Record<string, { baseURL?: string; baseUrl?: string; apiKey?: string; apiKeyEnv?: string }> | Array<{ id?: string; baseURL?: string; baseUrl?: string; apiKey?: string; apiKeyEnv?: string }>;
      } | undefined;

      const providerEntries: Array<{
        id: string;
        baseURL?: string | undefined;
        apiKey?: string | undefined;
        apiKeyEnv?: string | undefined;
      }> = [];
      if (piAiSection?.providers) {
        if (Array.isArray(piAiSection.providers)) {
          for (const p of piAiSection.providers) {
            if (p?.id) providerEntries.push({ id: p.id, baseURL: p.baseURL ?? p.baseUrl, apiKey: p.apiKey, apiKeyEnv: p.apiKeyEnv });
          }
        } else if (typeof piAiSection.providers === "object") {
          for (const [id, p] of Object.entries(piAiSection.providers)) {
            if (p) providerEntries.push({ id, baseURL: p.baseURL ?? p.baseUrl, apiKey: p.apiKey, apiKeyEnv: p.apiKeyEnv });
          }
        }
      }

      for (const entry of providerEntries) {
        const providerId = entry.id;
        if (liveProvidersFetched.has(providerId)) continue;
        let baseURL = entry.baseURL;
        if (!baseURL && providerId === "opencode-go") {
          baseURL = "https://opencode.ai/zen/go/v1";
        }
        let apiKey = entry.apiKey;
        if (!apiKey && entry.apiKeyEnv) {
          apiKey = await resolveApiKey(ctx, entry.apiKeyEnv);
        }
        if (!apiKey) {
          const envCandidate = `${providerId.toUpperCase().replace(/-/g, "_")}_API_KEY`;
          apiKey = await resolveApiKey(ctx, envCandidate);
        }
        if (baseURL) {
          const items = await fetchEndpointModels(baseURL, apiKey);
          if (items && items.length > 0) {
            liveProvidersFetched.add(providerId);
            for (const item of items) {
              if (item?.id) addModel(item.id, providerId, 1700000000, item.name);
            }
          }
        }
      }
    } catch {
      // Ignore external provider live discovery failure
    }
  }

  // 3. Collect from ctx.llm runtime if present
  try {
    const llm = (ctx as unknown as { llm?: {
      listProviders?: () => Array<{ id: string }>;
      listModels?: (provider: string) => Promise<Array<{ id: string; provider?: string } | string>>;
    } }).llm ?? (ctx as unknown as { get?: (name: string) => unknown }).get?.("llm") as {
      listProviders?: () => Array<{ id: string }>;
      listModels?: (provider: string) => Promise<Array<{ id: string; provider?: string } | string>>;
    } | undefined;

    if (llm && typeof llm.listProviders === "function") {
      const providers = llm.listProviders();
      if (Array.isArray(providers)) {
        for (const provider of providers) {
          const providerId = provider?.id ?? "deepseek";
          if (liveProvidersFetched.has(providerId)) continue;
          try {
            if (typeof llm.listModels === "function") {
              const discovered = await llm.listModels(providerId);
              if (Array.isArray(discovered)) {
                for (const item of discovered) {
                  const modelId = typeof item === "string" ? item : item?.id;
                  const owner = typeof item === "object" && item?.provider ? item.provider : providerId;
                  if (modelId) addModel(modelId, owner);
                }
              }
            }
          } catch {
            // Ignore failure listing specific provider models
          }
        }
      }
    }
  } catch {
    // Ignore llm discovery failure
  }

  // 4. Collect from settings if present
  try {
    const settings = (ctx as unknown as { settings?: { get?: (ns: string) => unknown } }).settings;
    if (settings && typeof settings.get === "function") {
      if (!liveProvidersFetched.has("deepseek")) {
        const deepseekSection = settings.get("llm-deepseek") as { models?: Array<{ id: string; name?: string } | string> } | undefined;
        if (deepseekSection && Array.isArray(deepseekSection.models)) {
          for (const m of deepseekSection.models) {
            const modelId = typeof m === "string" ? m : m?.id;
            const modelName = typeof m === "object" ? m?.name : undefined;
            if (modelId) addModel(modelId, "deepseek", 1700000000, modelName);
          }
        }
      }

      const piAiSection = settings.get("llm-pi-ai") as {
        providers?: Record<string, { models?: Array<{ id: string; name?: string } | string> }> | Array<{ id?: string; models?: Array<{ id: string; name?: string } | string> }>;
      } | undefined;
      if (piAiSection && piAiSection.providers) {
        if (Array.isArray(piAiSection.providers)) {
          for (const p of piAiSection.providers) {
            const providerId = p.id ?? "pi-ai";
            if (liveProvidersFetched.has(providerId)) continue;
            if (Array.isArray(p?.models)) {
              for (const m of p.models) {
                const modelId = typeof m === "string" ? m : m?.id;
                const modelName = typeof m === "object" ? m?.name : undefined;
                if (modelId) addModel(modelId, providerId, 1700000000, modelName);
              }
            }
          }
        } else if (typeof piAiSection.providers === "object") {
          for (const [providerId, p] of Object.entries(piAiSection.providers)) {
            if (liveProvidersFetched.has(providerId)) continue;
            if (p && Array.isArray(p.models)) {
              for (const m of p.models) {
                const modelId = typeof m === "string" ? m : m?.id;
                const modelName = typeof m === "object" ? m?.name : undefined;
                if (modelId) addModel(modelId, providerId, 1700000000, modelName);
              }
            }
          }
        }
      }

      const defaultModelSection = settings.get("agent-default-model") as {
        provider?: string;
        model?: string;
      } | undefined;
      if (defaultModelSection?.model) {
        const p = defaultModelSection.provider ?? "deepseek";
        if (!liveProvidersFetched.has(p)) {
          addModel(defaultModelSection.model, p);
        }
      }
    }
  } catch {
    // Ignore settings access failure
  }

  // 5. User custom models
  for (const custom of customModels) {
    addModel(custom, "custom");
  }

  // 6. Built-in defaults (only when live discovery did not fetch models)
  if (!liveProvidersFetched.has("deepseek")) {
    for (const def of DEFAULT_MODELS) {
      if (!Array.from(modelsMap.values()).some((m) => m.id === def.id)) {
        addModel(def.id, def.ownedBy);
      }
    }
  }

  let result = Array.from(modelsMap.values());
  if (options?.provider) {
    const target = options.provider.toLowerCase();
    result = result.filter((m) =>
      target === "deepseek"
        ? m.owned_by.toLowerCase() === "deepseek" || m.owned_by.toLowerCase() === "deepseek-official"
        : m.owned_by.toLowerCase() === target,
    );
  }
  return result;
}

/** Set CORS headers allowing any client to inspect models */
export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/**
 * Extract target model ID from requested pathname if query is for a specific model.
 * E.g.
 * - /models -> null
 * - /models/ -> null
 * - /models/deepseek-chat -> deepseek-chat
 * - /v1/models -> null
 * - /v1/models/deepseek-chat -> deepseek-chat
 */
export function extractModelId(pathname: string): string | null {
  let sub = pathname;
  if (sub.startsWith("/v1/models")) {
    sub = sub.slice("/v1/models".length);
  } else if (sub.startsWith("/models")) {
    sub = sub.slice("/models".length);
  } else {
    return null;
  }
  const clean = sub.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) return null;
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

/**
 * Creates the HTTP handler for /models and /v1/models routes.
 */
export function createModelsHandler(
  ctx: Context,
  getCustomModels?: () => string[],
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, {
        "Content-Type": "application/json; charset=utf-8",
        Allow: "GET, OPTIONS",
      });
      res.end(JSON.stringify({
        error: {
          message: `Method ${req.method} not allowed`,
          type: "invalid_request_error",
          code: "method_not_allowed",
        },
      } satisfies OpenAIErrorResponse));
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const requestedModelId = extractModelId(pathname);
    const providerFilter = url.searchParams.get("provider") || undefined;
    const customModels = getCustomModels ? getCustomModels() : [];
    const models = await collectModels(ctx, customModels, { provider: providerFilter });

    if (requestedModelId !== null) {
      const found = models.find((m) => m.id === requestedModelId);
      if (!found) {
        res.writeHead(404, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(JSON.stringify({
          error: {
            message: `Model '${requestedModelId}' not found`,
            type: "invalid_request_error",
            param: "model",
            code: "model_not_found",
          },
        } satisfies OpenAIErrorResponse, null, 2));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(JSON.stringify(found, null, 2));
      return;
    }

    // List all models
    const responseData: OpenAIModelsListResponse = {
      object: "list",
      data: models,
    };

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(JSON.stringify(responseData, null, 2));
  };
}

/**
 * Registers /models and /v1/models routes on webServer.
 * Returns a disposer function that unregisters both routes.
 */
export function registerModelsRoutes(
  ctx: Context,
  getCustomModels?: () => string[],
): () => void {
  const server = (ctx as unknown as { webServer?: {
    register: (route: {
      kind: "exact" | "prefix";
      path: string;
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
    }) => () => void;
  } }).webServer;

  if (!server || typeof server.register !== "function") {
    return () => {};
  }

  const handler = createModelsHandler(ctx, getCustomModels);

  const disposeModels = server.register({
    kind: "prefix",
    path: "/models",
    handler,
  });

  const disposeV1Models = server.register({
    kind: "prefix",
    path: "/v1/models",
    handler,
  });

  return () => {
    disposeModels();
    disposeV1Models();
  };
}
