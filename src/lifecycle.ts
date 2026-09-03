import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkspaceNamerConfig } from "./config.ts";
import type { SyncResult } from "./herdr.ts";
import { reconstructState, record } from "./state.ts";

interface RuntimeState {
	sessionId: string;
	candidate?: string;
	title?: string;
	generating: boolean;
	syncing: boolean;
	suppressSessionName?: string;
	shuttingDown: boolean;
}

export interface WorkspaceNamerDependencies {
	loadConfig(cwd: string): WorkspaceNamerConfig;
	generateTitle(ctx: ExtensionContext, prompt: string, maxLength: number): Promise<{ title: string }>;
	syncWorkspace(title: string, config: WorkspaceNamerConfig): Promise<SyncResult>;
	now(): number;
}

function normalizePrompt(value: string): string | undefined {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized || undefined;
}

export function registerWorkspaceNamer(pi: ExtensionAPI, dependencies: WorkspaceNamerDependencies): void {
	let state: RuntimeState | undefined;
	let config: WorkspaceNamerConfig | undefined;
	let syncQueue: Promise<void> = Promise.resolve();

	const isCurrent = (captured: RuntimeState): boolean =>
		state === captured && !captured.shuttingDown && captured.sessionId === state.sessionId;

	const notifyFailure = (captured: RuntimeState, ctx: ExtensionContext): void => {
		if (isCurrent(captured) && config?.notifyOnError && ctx.hasUI) {
			ctx.ui.notify("Unable to synchronize the Herdr workspace name.", "warning");
		}
	};

	const queueSynchronization = (
		title: string,
		ctx: ExtensionContext,
		captured: RuntimeState,
	): Promise<void> => {
		const capturedConfig = config;
		const action = async (): Promise<void> => {
			if (!capturedConfig || !isCurrent(captured)) return;
			captured.syncing = true;
			record(pi, {
				v: 1,
				kind: "sync-started",
				sessionId: captured.sessionId,
				title,
				at: dependencies.now(),
			});
			try {
				const result = await dependencies.syncWorkspace(title, capturedConfig);
				if (!isCurrent(captured)) return;
				if (result.ok) {
					record(pi, {
						v: 1,
						kind: "sync-finished",
						sessionId: captured.sessionId,
						title,
						workspaceId: result.workspaceId,
						at: dependencies.now(),
					});
				} else {
					record(pi, {
						v: 1,
						kind: "sync-failed",
						sessionId: captured.sessionId,
						title,
						...(result.workspaceId === undefined ? {} : { workspaceId: result.workspaceId }),
						at: dependencies.now(),
					});
					notifyFailure(captured, ctx);
				}
			} catch {
				if (!isCurrent(captured)) return;
				record(pi, {
					v: 1,
					kind: "sync-failed",
					sessionId: captured.sessionId,
					title,
					at: dependencies.now(),
				});
				notifyFailure(captured, ctx);
			} finally {
				if (isCurrent(captured)) captured.syncing = false;
			}
		};

		const queued = syncQueue.then(action, action);
		syncQueue = queued.catch(() => undefined);
		return queued;
	};

	const performNaming = async (ctx: ExtensionContext, captured: RuntimeState): Promise<void> => {
		const capturedConfig = config;
		const candidate = captured.candidate;
		if (!candidate) return;
		captured.generating = true;
		try {
			const generated = await dependencies.generateTitle(
				ctx,
				candidate,
				capturedConfig?.maxLength ?? 48,
			);
			if (!isCurrent(captured) || captured.title) return;
			const title = normalizePrompt(generated.title);
			if (!title) return;
			captured.title = title;
			record(pi, {
				v: 1,
				kind: "named",
				sessionId: captured.sessionId,
				title,
				at: dependencies.now(),
			});
			captured.suppressSessionName = title;
			pi.setSessionName(title);
			await queueSynchronization(title, ctx, captured);
		} catch {
			// Title generation and synchronization failures must not escape Pi event handlers.
		} finally {
			if (isCurrent(captured)) captured.generating = false;
		}
	};

	const startNaming = (ctx: ExtensionContext): void => {
		const captured = state;
		if (
			!captured ||
			!config?.enabled ||
			captured.shuttingDown ||
			captured.title ||
			captured.generating ||
			!captured.candidate
		) {
			return;
		}
		void performNaming(ctx, captured);
	};

	pi.on("session_start", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const reconstructed = reconstructState(ctx.sessionManager.getBranch(), sessionId);
		const nativeName = normalizePrompt(pi.getSessionName() ?? "");
		state = {
			sessionId,
			candidate: reconstructed.candidate,
			title: nativeName ?? reconstructed.title,
			generating: false,
			syncing: false,
			shuttingDown: false,
		};
		config = dependencies.loadConfig(ctx.cwd);
		const captured = state;
		if (nativeName) await queueSynchronization(nativeName, ctx, captured);
	});

	pi.on("input", (event, ctx) => {
		const captured = state;
		if (
			!captured ||
			captured.shuttingDown ||
			(event.source !== "interactive" && event.source !== "rpc") ||
			event.streamingBehavior !== undefined
		) {
			return;
		}
		const prompt = normalizePrompt(event.text);
		if (!prompt || prompt.startsWith("/")) return;
		captured.candidate = prompt;
		record(pi, {
			v: 1,
			kind: "candidate",
			sessionId: captured.sessionId,
			prompt,
			at: dependencies.now(),
		});
		startNaming(ctx);
	});

	pi.on("before_agent_start", (event, ctx) => {
		const captured = state;
		if (!captured || captured.shuttingDown || captured.candidate) return;
		const prompt = normalizePrompt(event.prompt);
		if (!prompt) return;
		captured.candidate = prompt;
		record(pi, {
			v: 1,
			kind: "candidate",
			sessionId: captured.sessionId,
			prompt,
			at: dependencies.now(),
		});
		startNaming(ctx);
	});

	pi.on("agent_settled", (_event, ctx) => {
		const captured = state;
		if (
			!captured ||
			!config?.enabled ||
			captured.shuttingDown ||
			captured.title ||
			captured.generating ||
			!captured.candidate
		) {
			return;
		}
		startNaming(ctx);
	});

	pi.on("session_info_changed", async (event, ctx) => {
		const captured = state;
		const name = normalizePrompt(event.name ?? "");
		if (!captured || captured.shuttingDown || !name) return;
		if (name === captured.suppressSessionName) {
			delete captured.suppressSessionName;
			return;
		}
		captured.title = name;
		await queueSynchronization(name, ctx, captured);
	});

	pi.on("session_shutdown", () => {
		if (!state) return;
		state.shuttingDown = true;
		delete state.candidate;
		delete state.suppressSessionName;
		state.generating = false;
		state.syncing = false;
	});
}
