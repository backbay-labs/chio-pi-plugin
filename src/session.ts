import {
  createAgentSession,
  createAgentSessionRuntime,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { selectGovernedRelay } from "./model-relay.js";
import { relayCredentials } from "./model-credentials.js";
import { installNativeSessionGates, preflightNativeSession, restrictBoundaryDrafts, type SessionGovernance } from "./pi-governance.js";
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
  governance?: SessionGovernance;
  sessionTarget?: {kind: "new" | "resume"; path?: string; sessionsDir?: string};
}

function selectedRegistry(options: ChioPiOptions): ToolRegistry {
  const registry = options.registry ?? createToolRegistry(options.toolInventory ?? [], options.toolMode ?? "typed");
  if (options.toolMode && registry.mode !== options.toolMode || options.registry && options.toolInventory && createToolRegistry(options.toolInventory, registry.mode).digest !== registry.digest) throw new Error("Session inventory differs from the pinned registry");
  return registry;
}

/** Snapshot the closed startup target before any native or SDK await. */
function snapshotSessionOptions(options: ChioPiOptions): ChioPiOptions {
  const target = options.sessionTarget;
  const sessionTarget = target ? Object.freeze({kind: target.kind,
    ...(target.path !== undefined ? {path: target.path} : {}),
    ...(target.sessionsDir !== undefined ? {sessionsDir: target.sessionsDir} : {})}) : undefined;
  return Object.freeze({...options,
    ...(sessionTarget ? {sessionTarget} : {}),
    ...(options.governance ? {governance: Object.freeze({...options.governance})} : {})});
}

/** Construct only the selected inline extension. No project/global packages,
 * context files, prompt templates, themes, or skills can introduce executable
 * code. Explicit tool allowlisting also filters later tool activation. */
export async function createChioPiSession(options: ChioPiOptions) {
  options = snapshotSessionOptions(options);
  const executor = options.trustedGatewayTransport ? options.executor : options.executor ? withUncertaintyInterlock(options.executor, join(options.agentDir, "chio")) : undefined;
  const registry = selectedRegistry(options);
  return createRestrictedSession({...options, registry}, pi => {chioExtension(executor, registry)(pi); installNativeSessionGates(pi, options.governance);});
}

/** Also used to test that extension omission or load failure cannot reactivate
 * built-ins. Not exported from the package entry point. */
export async function createRestrictedSession(options: ChioPiOptions, extension?: ExtensionFactory) {
  options = snapshotSessionOptions(options);
  if (VERSION !== "1.0.2") throw new Error("Pi host version differs from the pinned 1.0.2 contract");
  await preflightNativeSession(options.governance, options.sessionTarget ?? {kind: "new"});
  if (options.governance?.required && options.sessionManager && !runtimeManagers.has(options.sessionManager)) throw new Error("Governed initial SessionManager must be opened after native preflight");
  const registry = selectedRegistry(options);
  const selectedRelay = options.governance?.required ? selectGovernedRelay(options.governance.relayReference, options.governance.embedding, options.provider, options.model, registry) : undefined;
  const modelRuntime = selectedRelay ? await ModelRuntime.create({credentials: relayCredentials(options.provider, selectedRelay.token), modelsPath: null, modelsStorePath: join(options.agentDir, "models-cache.json"), allowModelNetwork: false, refreshOnCreate: false}) : options.modelRuntime;
  const modelBaseUrl = selectedRelay?.baseUrl ?? options.modelBaseUrl;
  const manager = options.sessionManager ?? (options.sessionTarget?.kind === "resume"
    ? SessionManager.open(options.sessionTarget.path!, options.sessionTarget.sessionsDir, options.cwd)
    : options.sessionTarget?.sessionsDir ? SessionManager.create(options.cwd, options.sessionTarget.sessionsDir) : SessionManager.inMemory(options.cwd));
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
  const model = modelRuntime.getModel(options.provider, options.model);
  if (!model) throw new Error(`Model unavailable: ${options.provider}/${options.model}`);
  const result = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime,
    model: modelBaseUrl ? { ...model, baseUrl: modelBaseUrl } : model,
    noTools: "all",
    tools: registry.tools.map(tool => tool.name),
    resourceLoader,
    settingsManager,
    sessionManager: manager,
  });
  if (selectedRelay) {
    const stream = result.session.agent.streamFunction;
    if (!stream) {result.session.dispose(); throw new Error("Pinned Pi SDK stream function unavailable");}
    // Public setModel can restore a catalog URL. Pin all ordinary and stock
    // summary calls at the trusted SDK stream seam before provider execution.
    result.session.agent.streamFunction = (selected, context, streamOptions) => {
      if (selected.provider !== options.provider || selected.id !== options.model || selected.api !== model.api) throw new Error("Model differs from the pinned governed provider profile");
      return stream({...selected, baseUrl: selectedRelay.baseUrl}, context, streamOptions);
    };
  }
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
  restrictBoundaryDrafts(result.session, options.governance);
  return {...result, services: {cwd: options.cwd, agentDir: options.agentDir, modelRuntime, resourceLoader, settingsManager, diagnostics: []}, diagnostics: []};
}

const runtimeManagers = new WeakSet<SessionManager>();
/** Public Pi runtime factory repeats custody checks for every replacement.
 * Initial preflight precedes opening/restoring the initial manager. */
export async function createChioPiRuntime(options: ChioPiOptions) {
  options = snapshotSessionOptions({...options, registry: selectedRegistry(options)});
  if (options.sessionManager) throw new Error("Use a governed session target instead of a preopened manager");
  await preflightNativeSession(options.governance, options.sessionTarget ?? {kind: "new"});
  const manager = options.sessionTarget?.kind === "resume"
    ? SessionManager.open(options.sessionTarget.path!, options.sessionTarget.sessionsDir, options.cwd)
    : options.sessionTarget?.sessionsDir ? SessionManager.create(options.cwd, options.sessionTarget.sessionsDir) : SessionManager.inMemory(options.cwd);
  const runtime = await createAgentSessionRuntime(async target => {
    await preflightNativeSession(options.governance, {kind: "runtime_replacement", path: target.sessionManager.getSessionFile() ?? "in_memory"});
    runtimeManagers.add(target.sessionManager);
    return createChioPiSession({...options, cwd: target.cwd, agentDir: target.agentDir, sessionManager: target.sessionManager});
  }, {cwd: options.cwd, agentDir: options.agentDir, sessionManager: manager});
  const nativeImport = runtime.importFromJsonl.bind(runtime);
  runtime.importFromJsonl = async (source, cwdOverride) => {
    await preflightNativeSession(options.governance, {kind: "import_source", path: source});
    return nativeImport(source, cwdOverride);
  };
  return runtime;
}
