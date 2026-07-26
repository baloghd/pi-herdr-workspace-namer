import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

function serverStub() {
	const server = new EventEmitter() as EventEmitter & {
		exitCode: number | null;
		stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
		kill: ReturnType<typeof vi.fn>;
	};
	const stderr = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
	stderr.setEncoding = vi.fn();
	server.exitCode = null;
	server.stderr = stderr;
	server.kill = vi.fn(() => {
		server.exitCode = 0;
		server.emit("exit", 0);
	});
	return server;
}

describe("live smoke", () => {
	it("uses a unique session and cleans it up when readiness fails", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { createSessionName, runLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const first = createSessionName(() => "first");
		const second = createSessionName(() => "second");
		expect(first).toBe("pi-herdr-workspace-namer-smoke-first");
		expect(second).toBe("pi-herdr-workspace-namer-smoke-second");

		const server = serverStub();
		const run = vi.fn(async (args: string[]) => {
			if (args[0] === "workspace" && args[1] === "list") throw new Error("not ready");
			if (args[0] === "session" && args[1] === "stop") server.kill();
			return { stdout: "{}", stderr: "" };
		});
		const spawnServer = vi.fn(() => server);

		await expect(
			runLiveSmoke({
				session: first,
				run,
				spawnServer,
				wait: vi.fn(async () => undefined),
				readinessAttempts: 1,
				importAdapter: vi.fn(),
			}),
		).rejects.toThrow("isolated Herdr server did not become ready");
		expect(spawnServer).toHaveBeenCalledOnce();
		expect(run.mock.calls.map(([args]) => args)).toContainEqual(["session", "stop", first, "--json"]);
		expect(run.mock.calls.map(([args]) => args)).toContainEqual(["session", "delete", first, "--json"]);
	});

	it("preserves the primary error and adds cleanup failure", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { runLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const session = "pi-herdr-workspace-namer-smoke-test";
		const server = serverStub();
		const run = vi.fn(async (args: string[]) => {
			if (args[0] === "workspace") throw new Error("not ready");
			if (args[0] === "session" && args[1] === "stop") server.kill();
			if (args[0] === "session" && args[1] === "delete") throw new Error("delete denied");
			return { stdout: "{}", stderr: "" };
		});

		await expect(
			runLiveSmoke({
				session,
				run,
				spawnServer: vi.fn(() => server),
				wait: vi.fn(async () => undefined),
				readinessAttempts: 1,
				importAdapter: vi.fn(),
			}),
		).rejects.toThrow(
			"isolated Herdr server did not become ready; cleanup failed: session delete failed: delete denied",
		);
	});

	it("fails an otherwise successful smoke when deletion fails", async () => {
		// @ts-expect-error The smoke is intentionally plain JavaScript for direct Node execution.
		const { runLiveSmoke } = await import("../scripts/live-smoke.mjs");
		const session = "pi-herdr-workspace-namer-smoke-test";
		const server = serverStub();
		const run = vi.fn(async (args: string[]) => {
			if (args[0] === "workspace" && args[1] === "create") {
				return {
					stdout: JSON.stringify({
						result: { root_pane: { pane_id: "p1" }, workspace: { workspace_id: "w1" } },
					}),
					stderr: "",
				};
			}
			if (args[0] === "workspace" && args[1] === "get") {
				return {
					stdout: JSON.stringify({ result: { workspace: { workspace_id: "w1", label: "after-smoke" } } }),
					stderr: "",
				};
			}
			if (args[0] === "session" && args[1] === "stop") server.kill();
			if (args[0] === "session" && args[1] === "delete") throw new Error("delete denied");
			return { stdout: "{}", stderr: "" };
		});
		const syncWorkspaceName = vi.fn(async () => ({ ok: true, workspaceId: "w1" }));

		await expect(
			runLiveSmoke({
				session,
				run,
				spawnServer: vi.fn(() => server),
				wait: vi.fn(async () => undefined),
				readinessAttempts: 1,
				importAdapter: vi.fn(async () => ({ syncWorkspaceName })),
			}),
		).rejects.toThrow("cleanup failed: session delete failed: delete denied");
		expect(syncWorkspaceName).toHaveBeenCalledOnce();
	});
});
