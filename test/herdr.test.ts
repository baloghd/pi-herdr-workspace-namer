import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Exec, syncWorkspaceName } from "../src/herdr.ts";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const ok = (stdout: string) => ({ stdout, stderr: "", code: 0, killed: false });
const pane = (workspaceId: string) => ok(JSON.stringify({ result: { pane: { workspace_id: workspaceId } } }));
const workspace = (workspaceId: string, label: string) =>
	ok(JSON.stringify({ result: { workspace: { workspace_id: workspaceId, label } } }));

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-herdr-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("syncWorkspaceName", () => {
	it("resolves current placement inside the lock, renames explicit workspace, and verifies", async () => {
		const exec = vi
			.fn()
			.mockResolvedValueOnce(pane("wA"))
			.mockResolvedValueOnce(pane("wA"))
			.mockResolvedValueOnce(workspace("wA", "Fix Status"))
			.mockResolvedValueOnce(workspace("wA", "Fix Status"));
		await expect(
			syncWorkspaceName({
				title: "Fix Status",
				command: "herdr",
				timeoutMs: 5000,
				exec,
				lockRoot: await temporaryDirectory(),
			}),
		).resolves.toEqual({ ok: true, workspaceId: "wA", title: "Fix Status" });
		expect(exec.mock.calls.map((call) => call[1])).toEqual([
			["pane", "current", "--current"],
			["pane", "current", "--current"],
			["workspace", "rename", "wA", "Fix Status"],
			["workspace", "get", "wA"],
		]);
		expect(exec.mock.calls.every((call) => call[2]?.timeout === 5000)).toBe(true);
	});

	it("fails closed on malformed JSON and never attempts rename", async () => {
		const exec = vi.fn().mockResolvedValue(ok("not json"));
		const result = await syncWorkspaceName({
			title: "Safe; rm -rf /",
			command: "herdr",
			timeoutMs: 5000,
			exec,
			lockRoot: await temporaryDirectory(),
		});
		expect(result).toMatchObject({ ok: false, code: "invalid_current_pane" });
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it("reports verification mismatch without retrying", async () => {
		const exec = vi
			.fn()
			.mockResolvedValueOnce(pane("w1"))
			.mockResolvedValueOnce(pane("w1"))
			.mockResolvedValueOnce(ok("{}"))
			.mockResolvedValueOnce(workspace("w1", "Someone Else"));
		const result = await syncWorkspaceName({
			title: "Expected",
			command: "herdr",
			timeoutMs: 5000,
			exec,
			lockRoot: await temporaryDirectory(),
		});
		expect(result).toMatchObject({ ok: false, code: "verification_mismatch", workspaceId: "w1" });
		expect(exec).toHaveBeenCalledTimes(4);
	});

	it("releases the old lock and re-resolves a pane moved to a new workspace", async () => {
		const exec = vi
			.fn()
			.mockResolvedValueOnce(pane("old"))
			.mockResolvedValueOnce(pane("new"))
			.mockResolvedValueOnce(pane("new"))
			.mockResolvedValueOnce(workspace("new", "Moved"))
			.mockResolvedValueOnce(workspace("new", "Moved"));
		await expect(
			syncWorkspaceName({
				title: "Moved",
				command: "herdr",
				timeoutMs: 5000,
				exec,
				lockRoot: await temporaryDirectory(),
			}),
		).resolves.toEqual({ ok: true, workspaceId: "new", title: "Moved" });
		expect(exec.mock.calls.map((call) => call[1])).toEqual([
			["pane", "current", "--current"],
			["pane", "current", "--current"],
			["pane", "current", "--current"],
			["workspace", "rename", "new", "Moved"],
			["workspace", "get", "new"],
		]);
	});

	it("serializes concurrent rename critical sections", async () => {
		let activeRenames = 0;
		let maximumActiveRenames = 0;
		let currentLabel = "";
		const exec: Exec = vi.fn(async (_command, args) => {
			if (args[0] === "pane") return pane("shared");
			if (args[1] === "rename") {
				activeRenames += 1;
				maximumActiveRenames = Math.max(maximumActiveRenames, activeRenames);
				await new Promise((resolve) => setTimeout(resolve, 80));
				currentLabel = args[3];
				activeRenames -= 1;
				return workspace("shared", currentLabel);
			}
			return workspace("shared", currentLabel);
		});
		const lockRoot = await temporaryDirectory();
		const labels = ["First", "Second"];
		const results = await Promise.all(
			labels.map((title) => syncWorkspaceName({ title, command: "herdr", timeoutMs: 5000, exec, lockRoot })),
		);
		expect(results.every((result) => result.ok)).toBe(true);
		expect(maximumActiveRenames).toBe(1);
	});

	it("recovers a stale lock but does not remove a live lock on timeout", async () => {
		const lockRoot = await temporaryDirectory();
		const staleLock = join(lockRoot, "stale.lock");
		await writeFile(staleLock, "abandoned", { mode: 0o600 });
		const old = new Date(Date.now() - 20_000);
		await utimes(staleLock, old, old);
		const staleExec = vi
			.fn()
			.mockResolvedValueOnce(pane("stale"))
			.mockResolvedValueOnce(pane("stale"))
			.mockResolvedValueOnce(workspace("stale", "Recovered"))
			.mockResolvedValueOnce(workspace("stale", "Recovered"));
		await expect(
			syncWorkspaceName({ title: "Recovered", command: "herdr", timeoutMs: 5000, exec: staleExec, lockRoot }),
		).resolves.toMatchObject({ ok: true });

		const liveLock = join(lockRoot, "live.lock");
		await writeFile(liveLock, "current-owner", { mode: 0o600 });
		const liveExec = vi.fn().mockResolvedValue(pane("live"));
		const result = await syncWorkspaceName({
			title: "No entry",
			command: "herdr",
			timeoutMs: 5000,
			exec: liveExec,
			lockRoot,
		});
		expect(result).toMatchObject({ ok: false, code: "lock_unavailable" });
		expect(await readFile(liveLock, "utf8")).toBe("current-owner");
	}, 4000);

	it("uses argv execution so shell metacharacters remain one title argument", async () => {
		const directory = await temporaryDirectory();
		const log = join(directory, "argv.log");
		const fixture = join(process.cwd(), "test", "fixtures", "fake-herdr.mjs");
		await chmod(fixture, 0o755);
		const title = "Safe; touch /tmp/never-created && $(echo bad)";
		const responses = JSON.stringify({
			"pane current --current": { result: { pane: { workspace_id: "fake" } } },
			"workspace rename": { result: { workspace: { workspace_id: "fake", label: title } } },
			"workspace get fake": { result: { workspace: { workspace_id: "fake", label: title } } },
		});
		const exec: Exec = async (command, args, options) => {
			try {
				const result = await execFileAsync(command, args, {
					timeout: options?.timeout,
					env: { ...process.env, FAKE_HERDR_LOG: log, FAKE_HERDR_RESPONSES: responses },
					encoding: "utf8",
				});
				return { stdout: result.stdout, stderr: result.stderr, code: 0, killed: false };
			} catch (error) {
				const failure = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
				return {
					stdout: failure.stdout ?? "",
					stderr: failure.stderr ?? "",
					code: failure.code ?? 1,
					killed: failure.killed ?? false,
				};
			}
		};
		await expect(
			syncWorkspaceName({ title, command: fixture, timeoutMs: 5000, exec, lockRoot: directory }),
		).resolves.toEqual({
			ok: true,
			workspaceId: "fake",
			title,
		});
		const calls = (await readFile(log, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(calls).toContainEqual(["workspace", "rename", "fake", title]);
	});

	it("bounds and sanitizes execution failures without reflecting the title", async () => {
		const title = "private prompt\nwith secrets";
		const exec = vi
			.fn()
			.mockResolvedValue({ stdout: "", stderr: `bad\n${"x".repeat(500)}`, code: 9, killed: false });
		const result = await syncWorkspaceName({
			title,
			command: "herdr",
			timeoutMs: 5000,
			exec,
			lockRoot: await temporaryDirectory(),
		});
		expect(result).toMatchObject({ ok: false, code: "current_pane_failed" });
		if (result.ok) throw new Error("expected failure");
		expect(result.message.length).toBeLessThanOrEqual(160);
		expect(result.message).not.toContain("\n");
		expect(result.message).not.toContain(title);
	});
});
