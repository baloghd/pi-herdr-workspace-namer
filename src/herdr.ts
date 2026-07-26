import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";

export type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
export type SyncResult =
	| { ok: true; workspaceId: string; title: string }
	| { ok: false; code: string; message: string; workspaceId?: string };

export interface SyncWorkspaceNameInput {
	title: string;
	command: string;
	timeoutMs: number;
	exec: Exec;
	lockRoot?: string;
}

const LOCK_WAIT_MS = 2_000;
const STALE_LOCK_MS = 10_000;
const POLL_MS = 40;
const HEARTBEAT_MS = 3_000;
const MAX_PLACEMENT_CHANGES = 8;
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function bounded(value: unknown): string {
	return String(value ?? "")
		.replace(/[\r\n\t]+/g, " ")
		.slice(0, 160);
}

function failure(code: string, message: string, workspaceId?: string): SyncResult {
	return workspaceId === undefined
		? { ok: false, code: bounded(code), message: bounded(message) }
		: { ok: false, code: bounded(code), message: bounded(message), workspaceId };
}

function parseJson(stdout: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		return undefined;
	}
}

function nestedString(value: unknown, path: string[]): string | undefined {
	let current: unknown = value;
	for (const key of path) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === "string" ? current : undefined;
}

async function run(exec: Exec, command: string, args: string[], timeout: number): Promise<ExecResult> {
	return exec(command, args, { timeout });
}

function isErrno(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === code
	);
}

async function removeIfOwned(lock: string, token: string): Promise<void> {
	try {
		if ((await readFile(lock, "utf8")) === token) await rm(lock, { force: true });
	} catch {
		// The lock disappeared or changed while ownership was being checked.
	}
}

async function refreshIfOwned(lock: string, token: string): Promise<void> {
	try {
		if ((await readFile(lock, "utf8")) === token) {
			const now = new Date();
			await utimes(lock, now, now);
		}
	} catch {
		// The lock disappeared or changed while ownership was being checked.
	}
}

async function removeIfStale(lock: string): Promise<void> {
	try {
		const before = await stat(lock);
		if (Date.now() - before.mtimeMs <= STALE_LOCK_MS) return;
		const token = await readFile(lock, "utf8");
		const after = await stat(lock);
		if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) return;
		// Ownership tokens prevent an old holder's finally block from deleting a
		// replacement lock. Re-check content immediately before stale reclamation.
		if ((await readFile(lock, "utf8")) === token) await rm(lock, { force: true });
	} catch {
		// Another contender changed the lock; retry normal acquisition.
	}
}

async function withLock<T>(workspaceId: string, action: () => Promise<T>, root: string): Promise<T> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	const lock = join(root, `${workspaceId}.lock`);
	const deadline = Date.now() + LOCK_WAIT_MS;
	const token = randomUUID();
	for (;;) {
		try {
			const handle = await open(lock, "wx", 0o600);
			try {
				await handle.writeFile(token, "utf8");
			} catch (error) {
				await handle.close();
				await removeIfOwned(lock, token);
				throw error;
			}
			await handle.close();
			break;
		} catch (error) {
			if (!isErrno(error, "EEXIST")) throw error;
			if (Date.now() >= deadline) throw new Error("lock deadline exceeded");
			await removeIfStale(lock);
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}
	}
	const heartbeat = setInterval(() => void refreshIfOwned(lock, token), HEARTBEAT_MS);
	heartbeat.unref();
	try {
		return await action();
	} finally {
		clearInterval(heartbeat);
		await removeIfOwned(lock, token);
	}
}

async function currentWorkspace(input: SyncWorkspaceNameInput): Promise<SyncResult | string> {
	let result: ExecResult;
	try {
		result = await run(input.exec, input.command, ["pane", "current", "--current"], input.timeoutMs);
	} catch {
		return failure("current_pane_failed", "Unable to resolve the current Herdr pane");
	}
	if (result.code !== 0) return failure("current_pane_failed", "Unable to resolve the current Herdr pane");
	const workspaceId = nestedString(parseJson(result.stdout), ["result", "pane", "workspace_id"]);
	if (!workspaceId || !WORKSPACE_ID.test(workspaceId)) {
		return failure("invalid_current_pane", "Herdr returned an invalid current pane response");
	}
	return workspaceId;
}

async function synchronizeLocked(input: SyncWorkspaceNameInput, workspaceId: string): Promise<SyncResult> {
	let rename: ExecResult;
	try {
		rename = await run(
			input.exec,
			input.command,
			["workspace", "rename", workspaceId, input.title],
			input.timeoutMs,
		);
	} catch {
		return failure("rename_failed", "Herdr workspace rename failed", workspaceId);
	}
	if (rename.code !== 0) return failure("rename_failed", "Herdr workspace rename failed", workspaceId);

	let verify: ExecResult;
	try {
		verify = await run(input.exec, input.command, ["workspace", "get", workspaceId], input.timeoutMs);
	} catch {
		return failure("verification_failed", "Unable to verify the Herdr workspace label", workspaceId);
	}
	if (verify.code !== 0)
		return failure("verification_failed", "Unable to verify the Herdr workspace label", workspaceId);
	const parsed = parseJson(verify.stdout);
	const label = nestedString(parsed, ["result", "workspace", "label"]);
	const returnedId = nestedString(parsed, ["result", "workspace", "workspace_id"]);
	if (label !== input.title || (returnedId !== undefined && returnedId !== workspaceId)) {
		return failure("verification_mismatch", "Herdr workspace label verification did not match", workspaceId);
	}
	return { ok: true, workspaceId, title: input.title };
}

export async function syncWorkspaceName(input: SyncWorkspaceNameInput): Promise<SyncResult> {
	if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
		return failure("invalid_options", "A positive execution timeout is required");
	}
	const root = input.lockRoot ?? join(tmpdir(), "pi-herdr-workspace-namer");
	let resolved = await currentWorkspace(input);
	if (typeof resolved !== "string") return resolved;

	for (let movement = 0; movement <= MAX_PLACEMENT_CHANGES; movement += 1) {
		const lockedWorkspace: string = resolved;
		try {
			const outcome: SyncResult | string = await withLock<SyncResult | string>(
				lockedWorkspace,
				async (): Promise<SyncResult | string> => {
					const inside = await currentWorkspace(input);
					if (typeof inside !== "string") return inside;
					if (inside !== lockedWorkspace) return inside;
					return synchronizeLocked(input, lockedWorkspace);
				},
				root,
			);
			if (typeof outcome !== "string") return outcome;
			resolved = outcome;
		} catch {
			return failure(
				"lock_unavailable",
				"Unable to acquire the Herdr workspace writer lock",
				lockedWorkspace,
			);
		}
	}
	return failure("placement_unstable", "The current Herdr pane placement did not stabilize", resolved);
}
