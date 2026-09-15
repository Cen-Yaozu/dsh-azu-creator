#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const candidates = [
  resolve("node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js"),
];

for (const filePath of candidates) {
  if (!existsSync(filePath)) continue;
  let code = readFileSync(filePath, "utf8");
  if (code.includes("// PATCHED: deepseek-fetch-models")) {
    console.log(`Already patched: ${filePath}`);
    continue;
  }

  // 1. Add state and fetch logic inside DeepSeekModelsEditor
  const hookTarget = "const [expanded, setExpanded] = (0, react.useState)(() => /* @__PURE__ */ new Set());";
  const hookReplacement = `${hookTarget}
\t\t\t// PATCHED: deepseek-fetch-models
\t\t\tconst [candidates, setCandidates] = (0, react.useState)(void 0);
\t\t\tconst [picked, setPicked] = (0, react.useState)(() => /* @__PURE__ */ new Set());
\t\t\tconst [busy, setBusy] = (0, react.useState)(false);
\t\t\tconst [failure, setFailure] = (0, react.useState)(void 0);

\t\t\tconst fetchModels = async () => {
\t\t\t\tsetBusy(true);
\t\t\t\tsetFailure(void 0);
\t\t\t\ttry {
\t\t\t\t\tconst res = await fetch("/models?provider=deepseek");
\t\t\t\t\tif (!res.ok) throw new Error(\`HTTP \${res.status}\`);
\t\t\t\t\tconst json = await res.json();
\t\t\t\t\tconst found = json.data || [];
\t\t\t\t\tif (found.length === 0) {
\t\t\t\t\t\tsetFailure(props.t("fetchEmpty"));
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tsetCandidates(found);
\t\t\t\t\tsetPicked(new Set(found.map((m) => m.id)));
\t\t\t\t} catch (err) {
\t\t\t\t\tsetFailure(err instanceof Error ? err.message : String(err));
\t\t\t\t} finally {
\t\t\t\t\tsetBusy(false);
\t\t\t\t}
\t\t\t};

\t\t\tconst closePicker = () => {
\t\t\t\tsetCandidates(void 0);
\t\t\t\tsetPicked(/* @__PURE__ */ new Set());
\t\t\t};

\t\t\tconst adoptPicked = () => {
\t\t\t\tif (!candidates) return;
\t\t\t\tconst byId = new Map(props.models.map((m) => [typeof m["id"] === "string" ? m["id"] : "", m]));
\t\t\t\tfor (const candidate of candidates) {
\t\t\t\t\tif (!picked.has(candidate.id)) continue;
\t\t\t\t\tbyId.set(candidate.id, byId.get(candidate.id) ?? {
\t\t\t\t\t\tid: candidate.id,
\t\t\t\t\t\tname: candidate.name || candidate.id,
\t\t\t\t\t});
\t\t\t\t}
\t\t\t\tprops.onChange([...byId.values()]);
\t\t\t\tclosePicker();
\t\t\t};

\t\t\tconst toggleCandidate = (id) => {
\t\t\t\tsetPicked((current) => {
\t\t\t\t\tconst next = new Set(current);
\t\t\t\t\tif (!next.delete(id)) next.add(id);
\t\t\t\t\treturn next;
\t\t\t\t});
\t\t\t};

\t\t\tconst activeCandidates = candidates ?? [];
\t\t\tconst allCandidatesPicked = activeCandidates.length > 0 && activeCandidates.every((c) => picked.has(c.id));
\t\t\tconst toggleAllCandidates = () => {
\t\t\t\tsetPicked((current) => {
\t\t\t\t\treturn activeCandidates.every((c) => current.has(c.id)) ? /* @__PURE__ */ new Set() : new Set(activeCandidates.map((c) => c.id));
\t\t\t\t});
\t\t\t};`;

  if (!code.includes(hookTarget)) {
    console.error(`Could not find hookTarget in ${filePath}`);
    continue;
  }
  code = code.replace(hookTarget, hookReplacement);

  // 2. Add fetch button in modelListHead beside resetModels
  const headTarget = `props.overridden ? (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ModelsSection_module_css_default["linkButton"],
							disabled: props.disabled,
							onClick: reset,
							children: props.t("resetModels")
						}) : null]`;

  const headReplacement = `(0, react_jsx_runtime.jsxs)("div", {
							style: { display: "inline-flex", gap: "6px", alignItems: "center" },
							children: [
								props.overridden ? (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelsSection_module_css_default["linkButton"],
									disabled: props.disabled,
									onClick: reset,
									children: props.t("resetModels")
								}) : null,
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelsSection_module_css_default["linkButton"],
									disabled: props.disabled || busy,
									onClick: fetchModels,
									children: busy ? props.t("fetching") : props.t("fetchModels")
								})
							]
						})]`;

  if (!code.includes(headTarget)) {
    console.error(`Could not find headTarget in ${filePath}`);
    continue;
  }
  code = code.replace(headTarget, headReplacement);

  // 3. Add button and modal after addModel button
  const addTarget = `(0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ModelsSection_module_css_default["addModelButton"],
						disabled: props.disabled,
						onClick: () => {
							props.onChange([...props.models.map((model) => ({ ...model })), { id: "" }]);
						},
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 14 }), props.t("addModel")]
					})
				]
			});
		}`;

  const addReplacement = `(0, react_jsx_runtime.jsxs)("div", {
						style: { display: "flex", gap: "8px", alignItems: "center" },
						children: [
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ModelsSection_module_css_default["addModelButton"],
								disabled: props.disabled,
								onClick: () => {
									props.onChange([...props.models.map((model) => ({ ...model })), { id: "" }]);
								},
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 14 }), props.t("addModel")]
							}),
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ModelsSection_module_css_default["addModelButton"],
								disabled: props.disabled || busy,
								onClick: fetchModels,
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, { size: 14 }), busy ? props.t("fetching") : props.t("fetchModels")]
							})
						]
					}),
					failure !== void 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: ModelsSection_module_css_default["error"],
						children: failure
					}) : null,
					(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: candidates !== void 0,
						onClose: closePicker,
						title: props.t("fetchTitle"),
						closeLabel: props.t("close"),
						description: props.t("fetchDescription"),
						className: ModelsSection_module_css_default["fetchDialog"],
						footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: closePicker,
							children: props.t("cancel")
						}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: adoptPicked,
							children: props.t("fetchAdopt")
						})] }),
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: ModelsSection_module_css_default["candidateActions"],
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								onClick: toggleAllCandidates,
								children: props.t(allCandidatesPicked ? "fetchDeselectAll" : "fetchSelectAll")
							})
						}), (0, react_jsx_runtime.jsx)("ul", {
							className: ModelsSection_module_css_default["candidateList"],
							children: (candidates ?? []).map((candidate) => (0, react_jsx_runtime.jsx)("li", {
								className: ModelsSection_module_css_default["candidate"],
								children: (0, react_jsx_runtime.jsxs)("label", {
									className: ModelsSection_module_css_default["candidateLabel"],
									children: [(0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: picked.has(candidate.id),
										onChange: () => {
											toggleCandidate(candidate.id);
										}
									}), (0, react_jsx_runtime.jsxs)("span", {
										className: ModelsSection_module_css_default["candidateId"],
										children: [
											candidate.id,
											candidate.name && candidate.name !== candidate.id ? (0, react_jsx_runtime.jsx)("span", {
												style: { marginLeft: "8px", opacity: 0.65, fontSize: "12px", fontWeight: "normal" },
												children: " (" + candidate.name + ")"
											}) : null
										]
									})]
								})
							}, candidate.id))
						})]
					})
				]
			});
		}`;

  if (!code.includes(addTarget)) {
    console.error(`Could not find addTarget in ${filePath}`);
    continue;
  }
  code = code.replace(addTarget, addReplacement);

  writeFileSync(filePath, code, "utf8");
  console.log(`Successfully patched: ${filePath}`);
}

// 4. Patch dsh-llm-pi-ai discoverModels to perform dynamic live fetch for catalog providers (like opencode-go)
const piAiPaths = [
  resolve("node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js"),
];

for (const piAiPath of piAiPaths) {
  if (!existsSync(piAiPath)) continue;
  let code = readFileSync(piAiPath, "utf8");
  if (code.includes("// PATCHED: pi-ai-live-discover")) {
    console.log(`Already patched: ${piAiPath}`);
    continue;
  }

  const target = `async function discoverModels(request, storedApiKey) {
\tif (request.provider !== void 0) {
\t\tconst installed = catalogModels(request.provider);
\t\tif (installed.size > 0) return [...installed.values()].map((model) => ({
\t\t\tid: model.id,
\t\t\tname: model.name,
\t\t\tcontextWindow: model.contextWindow,
\t\t\tmaxTokens: model.maxTokens
\t\t}));
\t}`;

  const replacement = `async function discoverModels(request, storedApiKey) {
\t// PATCHED: pi-ai-live-discover
\tconst providerBaseUrl = request.provider !== void 0 ? (catalogProvider(request.provider)?.baseUrl ?? (request.provider === "opencode-go" ? "https://opencode.ai/zen/go/v1" : void 0)) : void 0;
\tconst effectiveBaseUrl = request.baseURL ?? providerBaseUrl;
\tif (effectiveBaseUrl !== void 0 && effectiveBaseUrl.length > 0) {
\t\ttry {
\t\t\tconst url = listingUrl(effectiveBaseUrl);
\t\t\tconst supplied = request.apiKey ?? await storedApiKey?.();
\t\t\tconst apiKey = supplied === void 0 ? void 0 : usableProbeKey(supplied);
\t\t\tconst probeRes = await fetch(url, {
\t\t\t\tmethod: "GET",
\t\t\t\theaders: {
\t\t\t\t\taccept: "application/json",
\t\t\t\t\t...apiKey === void 0 ? {} : { authorization: \`Bearer \${apiKey}\` },
\t\t\t\t\t...attributionHeaders()
\t\t\t\t},
\t\t\t\t...request.signal === void 0 ? {} : { signal: request.signal }
\t\t\t});
\t\t\tif (probeRes.ok) {
\t\t\t\tconst probeText = await readBounded(probeRes, url);
\t\t\t\tconst probeBody = JSON.parse(probeText);
\t\t\t\tconst liveList = readListing(probeBody);
\t\t\t\tif (liveList.length > 0) {
\t\t\t\t\tconst installed = request.provider !== void 0 ? catalogModels(request.provider) : null;
\t\t\t\t\tconst inferSpec = (id) => {
\t\t\t\t\t\tconst lower = (id || "").toLowerCase();
\t\t\t\t\t\tif (lower.includes("minimax") || lower.includes("glm-5") || lower.includes("glm-4")) return { contextWindow: 1000000, maxTokens: 131072 };
\t\t\t\t\t\tif (lower.includes("kimi-k3")) return { contextWindow: 1048576, maxTokens: 131072 };
\t\t\t\t\t\tif (lower.includes("kimi")) return { contextWindow: 262144, maxTokens: 262144 };
\t\t\t\t\t\tif (lower.includes("qwen") || lower.includes("qwq")) return { contextWindow: 1000000, maxTokens: 32768 };
\t\t\t\t\t\tif (lower.includes("deepseek")) return { contextWindow: 1000000, maxTokens: 16384 };
\t\t\t\t\t\tif (lower.includes("gemini")) return { contextWindow: 1048576, maxTokens: 65536 };
\t\t\t\t\t\tif (lower.includes("claude")) return { contextWindow: 200000, maxTokens: 8192 };
\t\t\t\t\t\treturn { contextWindow: 262144, maxTokens: 32768 };
\t\t\t\t\t};
\t\t\t\t\treturn liveList.map((m) => {
\t\t\t\t\t\tconst meta = installed?.get(m.id);
\t\t\t\t\t\tconst inferred = inferSpec(m.id);
\t\t\t\t\t\treturn {
\t\t\t\t\t\t\tid: m.id,
\t\t\t\t\t\t\tname: m.name ?? meta?.name ?? m.id,
\t\t\t\t\t\t\tcontextWindow: m.contextWindow ?? meta?.contextWindow ?? inferred.contextWindow,
\t\t\t\t\t\t\tmaxTokens: m.maxTokens ?? meta?.maxTokens ?? inferred.maxTokens,
\t\t\t\t\t\t};
\t\t\t\t\t});
\t\t\t\t}
\t\t\t}
\t\t} catch {
\t\t\t// fall back to installed catalog or throw below
\t\t}
\t}
\tif (request.provider !== void 0) {
\t\tconst installed = catalogModels(request.provider);
\t\tif (installed.size > 0) return [...installed.values()].map((model) => ({
\t\t\tid: model.id,
\t\t\tname: model.name,
\t\t\tcontextWindow: model.contextWindow,
\t\t\tmaxTokens: model.maxTokens
\t\t}));
\t}`;

  if (!code.includes(target)) {
    console.error(`Could not find discoverModels target in ${piAiPath}`);
    continue;
  }
  code = code.replace(target, replacement);

  // Patch 5: fallback api and baseURL for opencode-go in resolveRouteModels
  const routeTarget = `\t\tconst base = defaults.get(entry.id);
\t\tconst api = request.api ?? base?.api ?? routeApi;
\t\tif (api === void 0) invalid(provider, \`model "\${entry.id}" needs an api; the installed catalog does not describe it, so set the route's api to the wire protocol its endpoint speaks\`);
\t\tconst baseUrl = request.baseURL ?? base?.baseUrl ?? providerBaseUrl;
\t\tif (baseUrl === void 0) invalid(provider, \`model "\${entry.id}" needs a baseURL; the installed catalog does not describe this route\`);`;

  const routeReplacement = `\t\tconst base = defaults.get(entry.id);
\t\t// PATCHED: opencode-go-fallback-api-baseUrl
\t\tconst api = request.api ?? base?.api ?? routeApi ?? (provider === "opencode-go" ? "openai-completions" : void 0);
\t\tif (api === void 0) invalid(provider, \`model "\${entry.id}" needs an api; the installed catalog does not describe it, so set the route's api to the wire protocol its endpoint speaks\`);
\t\tconst baseUrl = request.baseURL ?? base?.baseUrl ?? providerBaseUrl ?? (provider === "opencode-go" ? "https://opencode.ai/zen/go/v1" : void 0);
\t\tif (baseUrl === void 0) invalid(provider, \`model "\${entry.id}" needs a baseURL; the installed catalog does not describe this route\`);`;

  if (code.includes(routeTarget)) {
    code = code.replace(routeTarget, routeReplacement);
  }

  // Patch 6: inject x-opencode-session in dsh-llm-pi-ai streamSimple
  const streamTarget = `\t\t\t\t\tsignal: watchdog.signal,
\t\t\t\t\theaders: requestHeaders(profile.headers)`;
  const streamReplacement = `\t\t\t\t\tsignal: watchdog.signal,
\t\t\t\t\theaders: {
\t\t\t\t\t\t...requestHeaders(profile.headers),
\t\t\t\t\t\t...(model.provider === "opencode-go" || options.provider === "opencode-go" || model.baseUrl?.includes("opencode.ai") ? {
\t\t\t\t\t\t\t"x-opencode-session": options.sessionId ? String(options.sessionId) : \`session-\${Date.now().toString(36)}\`
\t\t\t\t\t\t} : {})
\t\t\t\t\t}`;
  if (code.includes(streamTarget)) {
    code = code.replace(streamTarget, streamReplacement);
  }

  writeFileSync(piAiPath, code, "utf8");
  console.log(`Successfully patched: ${piAiPath}`);
}

// 5. Patch @earendil-works/pi-ai for x-opencode-session header injection
const piAiCompletionsPath = resolve("node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js");
if (existsSync(piAiCompletionsPath)) {
  let cCode = readFileSync(piAiCompletionsPath, "utf8");
  if (!cCode.includes("x-opencode-session")) {
    const cTarget = `    // Merge options headers last so they can override defaults
    if (optionsHeaders) {
        Object.assign(headers, optionsHeaders);
    }
    return new OpenAI({`;
    const cReplacement = `    // Merge options headers last so they can override defaults
    if (optionsHeaders) {
        Object.assign(headers, optionsHeaders);
    }
    if (model.provider === "opencode-go" || model.baseUrl?.includes("opencode.ai")) {
        headers["x-opencode-session"] = sessionId || headers["x-opencode-session"] || (optionsHeaders && optionsHeaders["x-opencode-session"]) || ("session-" + Math.random().toString(36).slice(2));
    }
    return new OpenAI({`;
    if (cCode.includes(cTarget)) {
      cCode = cCode.replace(cTarget, cReplacement);
      writeFileSync(piAiCompletionsPath, cCode, "utf8");
      console.log(`Successfully patched: ${piAiCompletionsPath}`);
    }
  }
}
