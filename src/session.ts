import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { chioExtension, type KernelExecutor } from "./extension.js";
import { canonicalJson, createToolRegistry, registryInventory, resolveRegistryCall, type ChioToolSpec, type ToolMode, type ToolRegistry } from "./tool-registry.js";
import { join } from "node:path";
import { withUncertaintyInterlock } from "./uncertainty.js";

export interface ChioPiOptions {
  /** Disposable or operator-controlled directory, not the protected resource. */
  cwd: string;
  /** Dedicated profile outside the agent's kernel-accessible resource scope. */
  agentDir: string;
  modelRuntime: ModelRuntime;
  provider: string;
  model: string;
  /** Operator-owned local model relay in the sandboxed launcher. */
  modelBaseUrl?: string;
  executor?: KernelExecutor;
  /** The launcher-owned gateway supplies durable outcome handling. */
  trustedGatewayTransport?: boolean;
  sessionManager?: SessionManager;
  toolInventory?: readonly ChioToolSpec[];
  toolMode?: ToolMode;
  registry?: ToolRegistry;
}

function selectedRegistry(options: ChioPiOptions): ToolRegistry {
  const registry = options.registry ?? createToolRegistry(options.toolInventory ?? [], options.toolMode ?? "typed");
  if (options.toolMode && registry.mode !== options.toolMode || options.registry && options.toolInventory && createToolRegistry(options.toolInventory, registry.mode).digest !== registry.digest) throw new Error("Session inventory differs from the pinned registry");
  return registry;
}

/** Construct only the selected inline extension. No project/global packages,
 * context files, prompt templates, themes, or skills can introduce executable
 * code. Explicit tool allowlisting also filters later tool activation. */
export async function createChioPiSession(options: ChioPiOptions) {
  const executor = options.trustedGatewayTransport ? options.executor : options.executor ? withUncertaintyInterlock(options.executor, join(options.agentDir, "chio")) : undefined;
  const registry = selectedRegistry(options);
  return createRestrictedSession({...options, registry}, chioExtension(executor, registry));
}

/** Also used to test that extension omission or load failure cannot reactivate
 * built-ins. Not exported from the package entry point. */
export async function createRestrictedSession(options: ChioPiOptions, extension?: ExtensionFactory) {
  if (VERSION !== "1.0.2") throw new Error("Pi host version differs from the pinned 1.0.2 contract");
  const registry = selectedRegistry(options);
  const settingsManager = SettingsManager.inMemory({
    defaultTools: [],
    packages: [],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
    enableSkillCommands: false,
    enableInstallTelemetry: false,
    enableAnalytics: false,
    defaultProjectTrust: "never",
    retry: { enabled: false },
    transport: "sse",
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "You are Pi using operator-pinned Chio kernel tools. Complete useful tasks through the declared tools and their native arguments. Treat kernel errors as failures, and uncertain external outcomes as unresolved. Never claim a resource effect without its result. There are no native local tools in this profile."
      + `\nPinned tool registry ${registry.digest} (${registry.mode}). Declared aliases: ${registry.tools.map(tool => tool.name).join(", ") || "none"}.`
      + (registry.mode === "legacy" ? `\nLegacy wrapper kernel inventory:\n${JSON.stringify(registryInventory(registry))}` : ""),
    appendSystemPrompt: [],
    extensionFactories: extension ? [extension] : [],
  });
  await resourceLoader.reload();
  const diagnostics = resourceLoader.getExtensions().errors;
  if (diagnostics.length) throw new Error(`Chio Pi extension failed to load: ${diagnostics.map(item => item.error).join("; ")}`);
  const model = options.modelRuntime.getModel(options.provider, options.model);
  if (!model) throw new Error(`Model unavailable: ${options.provider}/${options.model}`);
  const result = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime: options.modelRuntime,
    model: options.modelBaseUrl ? { ...model, baseUrl: options.modelBaseUrl } : model,
    noTools: "all",
    tools: registry.tools.map(tool => tool.name),
    resourceLoader,
    settingsManager,
    sessionManager: options.sessionManager ?? SessionManager.inMemory(options.cwd),
  });
  // The profile has one durable in-flight interlock. Ask the stock host to
  // serialize model-emitted sibling calls instead of creating false conflicts.
  result.session.agent.toolExecution = "sequential";
  // Pi validates and may coerce schema arguments before its native tool hook.
  // Bind the original model call as well, using the public Agent hook, so a
  // numeric path, stripped null, or other normalization never becomes an effect.
  const beforeToolCall = result.session.agent.beforeToolCall;
  result.session.agent.beforeToolCall = async (context, signal) => {
    try {
      resolveRegistryCall(registry, context.toolCall.name, context.toolCall.arguments);
      if (canonicalJson(context.args) !== canonicalJson(context.toolCall.arguments)) throw new Error("Native Pi normalization changed pinned arguments");
    } catch {return {block: true, reason: "Tool call differs from the pinned registry or exact argument binding"};}
    return beforeToolCall?.(context, signal);
  };
  const allowed = new Map(registry.tools.map(tool => [tool.name, tool]));
  const configured = result.session.getAllTools();
  const unexpected = configured.some(tool => {
    const pinned = allowed.get(tool.name);
    return !pinned || tool.exposure !== "direct" || tool.description !== pinned.description || canonicalJson(tool.parameters) !== canonicalJson(pinned.parameters);
  });
  if (unexpected || result.session.getActiveToolNames().some(name => !allowed.has(name)) || result.session.getCallableToolNames().some(name => !allowed.has(name))) {
    result.session.dispose();
    throw new Error("Unexpected native declaration or callable tool in protected profile");
  }
  return result;
}
