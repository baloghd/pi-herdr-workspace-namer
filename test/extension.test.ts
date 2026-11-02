import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import workspaceNamer from "../extensions/workspace-namer.ts";

const { completeSimple } = vi.hoisted(() => ({ completeSimple: vi.fn() }));

vi.mock("@earendil-works/pi-ai/compat", () => ({ completeSimple }));

function runtime(): {
	pi: ExtensionAPI;
	on: ReturnType<typeof vi.fn>;
	setSessionName: ReturnType<typeof vi.fn>;
	exec: ReturnType<typeof vi.fn>;
} {
	const on = vi.fn();
	const setSessionName = vi.fn();
	const exec = vi.fn();
	return { pi: { on, setSessionName, exec } as unknown as ExtensionAPI, on, setSessionName, exec };
}

afterEach(() => {
	vi.unstubAllEnvs();
	completeSimple.mockReset();
});

describe("runtime registration", () => {
	it("does not register lifecycle handlers outside Herdr", () => {
		vi.stubEnv("HERDR_ENV", "0");
		const { pi, on, setSessionName, exec } = runtime();

		workspaceNamer(pi);

		expect(on).not.toHaveBeenCalled();
		expect(setSessionName).not.toHaveBeenCalled();
		expect(exec).not.toHaveBeenCalled();
	});

	it("does not register lifecycle handlers for Pi subagent children", () => {
		vi.stubEnv("HERDR_ENV", "1");
		vi.stubEnv("PI_SUBAGENT_CHILD", "1");
		const { pi, on, setSessionName, exec } = runtime();

		workspaceNamer(pi);

		expect(on).not.toHaveBeenCalled();
		expect(setSessionName).not.toHaveBeenCalled();
		expect(exec).not.toHaveBeenCalled();
	});

	it("registers the lifecycle handlers inside Herdr", () => {
		vi.stubEnv("HERDR_ENV", "1");
		vi.stubEnv("PI_SUBAGENT_CHILD", "0");
		const { pi, on } = runtime();

		workspaceNamer(pi);

		expect(on).toHaveBeenCalled();
		expect(on.mock.calls.map(([event]) => event)).toContain("agent_settled");
	});
});

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

interface Harness {
	ctx: ExtensionContext;
	handlers: Map<string, Handler>;
	setSessionName: ReturnType<typeof vi.fn>;
	workspaceLabels: string[];
}

function harness(): Harness {
	const handlers = new Map<string, Handler>();
	const setSessionName = vi.fn();
	const workspaceLabels: string[] = [];
	const sessionId = "session-1";
	const exec = vi.fn(async (_command: string, args: string[]) => {
		if (args[0] === "pane" && args[1] === "current") {
			return { code: 0, stdout: JSON.stringify({ result: { pane: { workspace_id: "w1" } } }), stderr: "" };
		}
		if (args[0] === "workspace" && args[1] === "rename") {
			workspaceLabels.push(args[3]);
			return { code: 0, stdout: "{}", stderr: "" };
		}
		if (args[0] === "workspace" && args[1] === "get") {
			const label = workspaceLabels[workspaceLabels.length - 1];
			return {
				code: 0,
				stdout: JSON.stringify({ result: { workspace: { workspace_id: "w1", label } } }),
				stderr: "",
			};
		}
		throw new Error(`unexpected herdr call: ${args.join(" ")}`);
	});
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
			return () => {};
		},
		getSessionName: () => undefined,
		setSessionName,
		appendEntry: vi.fn(),
		exec,
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: "/repo",
		hasUI: true,
		model: { provider: "opencode-go", id: "deepseek-v4.1-flash" },
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key", headers: {} }),
		},
		sessionManager: { getSessionId: () => sessionId, getBranch: () => [] },
		ui: { notify: vi.fn() },
	} as unknown as ExtensionContext;

	workspaceNamer(pi);

	return { ctx, handlers, setSessionName, workspaceLabels };
}

describe("title request", () => {
	it("sends the session id and a token budget that survives thinking models", async () => {
		vi.stubEnv("HERDR_ENV", "1");
		vi.stubEnv("PI_SUBAGENT_CHILD", "0");
		completeSimple.mockResolvedValue({ content: [{ type: "text", text: "Billing Health Check" }] });

		const { ctx, handlers, setSessionName, workspaceLabels } = harness();
		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
		await handlers.get("input")?.(
			{ type: "input", text: "Add a health check endpoint to the billing service", source: "interactive" },
			ctx,
		);
		await handlers.get("agent_settled")?.({ type: "agent_settled", aborted: false }, ctx);

		// Naming runs detached from the event handler, so wait for the flow to finish.
		await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledTimes(1));
		const options = completeSimple.mock.calls[0]?.[2] as { sessionId?: string; maxTokens?: number };
		// OpenCode endpoints reject requests without x-opencode-session, which the
		// provider derives from this id.
		expect(options.sessionId).toBe("session-1");
		// Thinking models spend the first tokens on reasoning, so a small cap ends
		// the response before any title text exists.
		expect(options.maxTokens).toBeGreaterThanOrEqual(256);
		await vi.waitFor(() => expect(workspaceLabels).toEqual(["Billing Health Check"]));
		expect(setSessionName).toHaveBeenCalledWith("Billing Health Check");
	});
});
