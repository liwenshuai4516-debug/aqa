/** Trusted, short-lived plugin tool invocation identity for internal MCP execution. */
export interface PluginToolContext {
	readonly clientId: string;
	readonly conversationId: string;
	readonly cwd: string;
	readonly pluginId: string;
	readonly toolName: string;
}

export interface PluginMcpRequest {
	serverId: string;
	toolName: string;
	runRef: string;
	input?: Record<string, unknown>;
}

export type PluginModelComplete = (request: {
	prompt: string;
	system?: string;
	model?: string;
	maxChars?: number;
	timeoutMs?: number;
}) => Promise<{
	ok: boolean;
	text?: string;
	model?: string;
	usage?: { input: number; output: number };
	error?: string;
}>;

export type PluginMcpCaller = (
	identity: PluginToolContext,
	request: PluginMcpRequest,
	signal: AbortSignal,
	complete?: PluginModelComplete,
) => Promise<unknown>;

export interface PluginInvocationScope {
	context: PluginToolContext;
	dispose(): void;
}

const invocations = new WeakMap<PluginToolContext, { verify(): void; signal?: AbortSignal }>();

/** Only the tool adapter creates these; model arguments cannot forge the WeakMap entry. */
export function createPluginInvocation(
	identity: PluginToolContext,
	verify: () => void,
	signal?: AbortSignal,
): PluginInvocationScope {
	const context = Object.freeze({ ...identity });
	invocations.set(context, { verify, signal });
	return { context, dispose: () => invocations.delete(context) };
}

/** Recheck live permissions during the run; revocation aborts only this dedicated invocation. */
export async function callPluginMcp(
	pluginId: string,
	context: PluginToolContext,
	request: PluginMcpRequest,
	caller: PluginMcpCaller | undefined,
	pluginSignal: AbortSignal,
	signal?: AbortSignal,
): Promise<unknown> {
	const invocation = invocations.get(context);
	if (!invocation || context.pluginId !== pluginId) throw new Error("MCP invocation identity is missing or expired");
	if (!caller) throw new Error("Controlled MCP execution is unavailable in this engine");
	invocation.verify();
	const revoked = new AbortController();
	const combined = AbortSignal.any([
		pluginSignal,
		revoked.signal,
		...[invocation.signal, signal].filter((s): s is AbortSignal => !!s),
	]);
	combined.throwIfAborted();
	const timer = setInterval(() => {
		try {
			if (!invocations.has(context)) throw new Error("MCP invocation expired");
			invocation.verify();
		} catch (error) {
			revoked.abort(error);
		}
	}, 50);
	try {
		const result = await caller(context, Object.freeze({ ...request }), combined);
		combined.throwIfAborted();
		invocation.verify();
		return result;
	} finally {
		clearInterval(timer);
	}
}

/** Trusted host scheduler binding, never a model argument or a retained chat invocation. */
export interface PluginApiScheduleHost {
	readonly cwd: string;
	readonly signal: AbortSignal;
	complete?: PluginModelComplete;
	notify?(event: { event: string; runId: string; openCount: number }): void;
	declaration(id: string): { spec: string; catchUp: "skip" | "once" } | undefined;
	verify(): void;
	schedule(
		spec: string | number,
		fn: (tick: { scheduledAt: number; firedAt: number }) => void,
		opts: {
			id: string;
			persistent: boolean;
			catchUp: "skip";
			strictPersistence: boolean;
			onStop(): void;
			label: string;
		},
	): () => void;
}
