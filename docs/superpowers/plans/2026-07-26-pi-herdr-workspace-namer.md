# Pi Herdr Workspace Namer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, document, and publish a community-ready Pi package that generates one AI task title per Pi session and mirrors the native Pi session name to the pane’s current Herdr workspace.

**Architecture:** A global Pi extension owns lifecycle orchestration and treats Pi’s native session name as the source of truth. Focused modules handle configuration, AI/local naming, append-only session state, and safe Herdr CLI calls; all external effects are dependency-injected for deterministic tests. Herdr synchronization resolves the pane’s current workspace immediately before each rename and serializes concurrent workspace writers with a short filesystem lock.

**Tech Stack:** TypeScript ESM, Pi 0.82.1 extension API, `@earendil-works/pi-ai`, Herdr 0.7.5 CLI, Node 22+, Vitest, Biome, GitHub Actions, npm.

## Global Constraints

- Package/repository name: `pi-herdr-workspace-namer`; public GitHub target: `tfolkman/pi-herdr-workspace-namer`.
- npm keyword `pi-package` and explicit `pi.extensions` manifest are required for `pi.dev/packages` discovery.
- Minimum supported versions: Pi `0.82.1`, Herdr `0.7.5`, Node `22`.
- Pi session name is the sole source of truth; synchronization is one-way from Pi to Herdr.
- One current-model title request per new/forked unnamed session; no timer, periodic check, or later automatic retitle in the same session.
- `/resume` and startup use the saved Pi session name without a model request; manual Pi `/name` changes sync immediately.
- The active/resumed Pi session always replaces the current Herdr workspace label.
- Never rename Herdr panes, tabs, branches, or worktrees.
- Never use `agent_end` as completion; title generation occurs at `agent_settled`.
- Every Herdr mutation must resolve current placement with `herdr pane current --current`; never trust a stale launch-time workspace ID after a pane move.
- Invoke external commands through `pi.exec(command, args)` only; no shell interpolation.
- Failures must not fail or block the normal Pi turn.
- Disclose that title generation sends the first task prompt to the active model provider and adds one model request.
- Disclose that Herdr `workspace rename` sets a custom name and Herdr 0.7.5 cannot reset it to cwd-derived automatic naming.
- Pi packages run with full user privileges; package source and release contents must be reviewable and minimal.

---

## Planned File Map

- `package.json` — npm/Pi manifest, scripts, package allowlist, dependencies, gallery keywords.
- `tsconfig.json` — strict no-emit ESM typechecking for source, extension, and tests.
- `biome.json` — deterministic formatting/lint policy.
- `.gitignore` / `.npmignore` — exclude generated/local artifacts.
- `src/config.ts` — load and validate user/project `herdrWorkspaceNamer` settings.
- `src/naming.ts` — model title request, response normalization, deterministic fallback.
- `src/state.ts` — versioned records and active-branch reconstruction scoped by Pi session ID.
- `src/herdr.ts` — Herdr JSON parsing, current-workspace resolution, rename verification, filesystem lock.
- `src/lifecycle.ts` — Pi event state machine and dependency orchestration.
- `extensions/workspace-namer.ts` — thin runtime adapter wiring official Pi APIs to modules.
- `test/*.test.ts` — focused unit/integration-contract tests with fake Pi/Herdr effects.
- `test/fixtures/fake-herdr.mjs` — deterministic CLI fixture for argument and failure-path tests.
- `scripts/verify-package.mjs` — inspect packed tarball and reject unsafe/unexpected files.
- `scripts/live-smoke.mjs` — explicitly opt-in Herdr smoke test using a named disposable test session/workspace.
- `README.md` — installation, behavior, privacy/cost, limitations, configuration, troubleshooting.
- `AGENTS.md` — repository invariants and agent contribution instructions.
- `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `LICENSE` — community/release policy.
- `.github/workflows/ci.yml`, `.github/dependabot.yml` — CI and dependency maintenance.

---

### Task 1: Package Scaffold and Configuration Contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `.npmignore`
- Create: `src/config.ts`
- Create: `test/config.test.ts`

**Interfaces:**
- Produces: `WorkspaceNamerConfig`, `DEFAULT_CONFIG`, `loadConfig(input): WorkspaceNamerConfig`.
- Consumes: user settings at `${PI_CODING_AGENT_DIR:-~/.pi/agent}/settings.json`; project settings at `<cwd>/.pi/settings.json`.
- Later tasks rely on exact config fields: `enabled`, `maxLength`, `fallback`, `notifyOnError`, `herdrCommand`, `commandTimeoutMs`.

- [ ] **Step 1: Create package metadata and strict tooling configuration**

Create `package.json`:

```json
{
  "name": "pi-herdr-workspace-namer",
  "version": "0.1.0",
  "description": "Automatically name Herdr workspaces from native Pi session task titles",
  "type": "module",
  "license": "MIT",
  "author": "Tyler Folkman",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/tfolkman/pi-herdr-workspace-namer.git"
  },
  "bugs": {
    "url": "https://github.com/tfolkman/pi-herdr-workspace-namer/issues"
  },
  "homepage": "https://github.com/tfolkman/pi-herdr-workspace-namer#readme",
  "keywords": [
    "pi-package",
    "pi-extension",
    "pi-coding-agent",
    "herdr",
    "workspace",
    "terminal",
    "ai-agent"
  ],
  "files": [
    "extensions",
    "src",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "SECURITY.md"
  ],
  "pi": {
    "extensions": ["./extensions/workspace-namer.ts"]
  },
  "engines": {
    "node": ">=22"
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*"
  },
  "dependencies": {
    "jsonc-parser": "^3.3.1"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.2.4",
    "@earendil-works/pi-ai": "^0.82.1",
    "@earendil-works/pi-coding-agent": "^0.82.1",
    "@types/node": "^24.0.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "biome check . && npm run typecheck && npm test",
    "check:write": "biome check --write .",
    "verify:package": "node scripts/verify-package.mjs",
    "test:live": "node scripts/live-smoke.mjs",
    "prepack": "npm run check && npm run verify:package"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["extensions/**/*.ts", "src/**/*.ts", "test/**/*.ts"]
}
```

Create `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.2.4/schema.json",
  "files": { "includes": ["**", "!node_modules", "!coverage", "!*.tgz"] },
  "formatter": { "enabled": true, "indentStyle": "tab", "lineWidth": 110 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } }
}
```

Create `.gitignore`:

```gitignore
node_modules/
coverage/
*.tgz
.DS_Store
.env
.pi-herdr-workspace-namer/
```

Create `.npmignore`:

```gitignore
.github/
docs/
test/
scripts/live-smoke.mjs
AGENTS.md
CONTRIBUTING.md
biome.json
tsconfig.json
```

- [ ] **Step 2: Install dependencies and capture the lockfile**

Run:

```bash
npm install
```

Expected: `package-lock.json` created; audit exits successfully or reports only explicitly reviewed non-runtime advisories.

- [ ] **Step 3: Write failing configuration tests**

Create `test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
	it("returns safe defaults when files are absent", () => {
		expect(loadConfig({ cwd: "/repo", agentDir: "/agent", readFile: () => undefined })).toEqual(
			DEFAULT_CONFIG,
		);
	});

	it("merges project values over user values and clamps invalid data", () => {
		const files = new Map([
			[
				"/agent/settings.json",
				JSON.stringify({ herdrWorkspaceNamer: { maxLength: 64, notifyOnError: false } }),
			],
			[
				"/repo/.pi/settings.json",
				`{ // project override\n "herdrWorkspaceNamer": { "maxLength": 32, "commandTimeoutMs": -1 } }`,
			],
		]);
		const result = loadConfig({ cwd: "/repo", agentDir: "/agent", readFile: (path) => files.get(path) });
		expect(result).toMatchObject({ maxLength: 32, notifyOnError: false, commandTimeoutMs: 5000 });
	});
});
```

- [ ] **Step 4: Run the test to verify RED**

Run:

```bash
npm test -- test/config.test.ts
```

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 5: Implement configuration loading**

Create `src/config.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";

export interface WorkspaceNamerConfig {
	enabled: boolean;
	maxLength: number;
	fallback: "local";
	notifyOnError: boolean;
	herdrCommand: string;
	commandTimeoutMs: number;
}

export const DEFAULT_CONFIG: WorkspaceNamerConfig = {
	enabled: true,
	maxLength: 48,
	fallback: "local",
	notifyOnError: true,
	herdrCommand: "herdr",
	commandTimeoutMs: 5000,
};

interface LoadConfigInput {
	cwd: string;
	agentDir?: string;
	readFile(path: string): string | undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function parseSettings(text: string | undefined): Record<string, unknown> {
	if (!text) return {};
	try {
		return objectValue(parse(text));
	} catch {
		return {};
	}
}

export function loadConfig(input: LoadConfigInput): WorkspaceNamerConfig {
	const agentDir = input.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	const user = objectValue(parseSettings(input.readFile(join(agentDir, "settings.json"))).herdrWorkspaceNamer);
	const project = objectValue(
		parseSettings(input.readFile(join(input.cwd, ".pi", "settings.json"))).herdrWorkspaceNamer,
	);
	const merged = { ...user, ...project };
	const maxLength = Number.isInteger(merged.maxLength) && Number(merged.maxLength) >= 16 && Number(merged.maxLength) <= 80
		? Number(merged.maxLength)
		: DEFAULT_CONFIG.maxLength;
	const commandTimeoutMs =
		Number.isInteger(merged.commandTimeoutMs) && Number(merged.commandTimeoutMs) >= 500 && Number(merged.commandTimeoutMs) <= 30000
			? Number(merged.commandTimeoutMs)
			: DEFAULT_CONFIG.commandTimeoutMs;
	return {
		enabled: typeof merged.enabled === "boolean" ? merged.enabled : DEFAULT_CONFIG.enabled,
		maxLength,
		fallback: "local",
		notifyOnError:
			typeof merged.notifyOnError === "boolean" ? merged.notifyOnError : DEFAULT_CONFIG.notifyOnError,
		herdrCommand:
			typeof merged.herdrCommand === "string" && merged.herdrCommand.trim()
				? merged.herdrCommand.trim()
				: DEFAULT_CONFIG.herdrCommand,
		commandTimeoutMs,
	};
}
```

- [ ] **Step 6: Verify GREEN and scaffold quality**

Run:

```bash
npm test -- test/config.test.ts
npm run typecheck
npm exec biome check -- src/config.ts test/config.test.ts package.json tsconfig.json biome.json
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json biome.json .gitignore .npmignore src/config.ts test/config.test.ts
git commit -m "build: scaffold Pi package and configuration"
```

---

### Task 2: AI Title Generation and Deterministic Fallback

**Files:**
- Create: `src/naming.ts`
- Create: `test/naming.test.ts`

**Interfaces:**
- Produces: `normalizeTitle(value, maxLength)`, `fallbackTitle(prompt, maxLength)`, `generateTitle(input)`.
- `generateTitle` consumes an injected `complete()` callback so lifecycle tests do not contact a provider.
- Returns `Promise<{ title: string; source: "model" | "fallback" }>`.

- [ ] **Step 1: Write failing title tests**

Create `test/naming.test.ts` with cases that assert:

```ts
import { describe, expect, it, vi } from "vitest";
import { fallbackTitle, generateTitle, normalizeTitle } from "../src/naming.ts";

describe("normalizeTitle", () => {
	it("removes markdown, quotes, punctuation, and truncates by code point", () => {
		expect(normalizeTitle('**"Research Herdr Workspace Naming."**', 30)).toBe(
			"Research Herdr Workspace Naming",
		);
	});
	it("rejects commentary and empty responses", () => {
		expect(normalizeTitle("Here is your title:\nFix Status", 48)).toBeUndefined();
	});
});

describe("fallbackTitle", () => {
	it("builds a readable task title without leaking paths or command syntax", () => {
		expect(fallbackTitle("please research how to fix /home/me/project Herdr status", 48)).toBe(
			"Research Fix Herdr Status",
		);
	});
});

describe("generateTitle", () => {
	it("uses one validated current-model result", async () => {
		const complete = vi.fn().mockResolvedValue("Fix Herdr Agent Status");
		await expect(generateTitle({ prompt: "fix it", maxLength: 48, complete })).resolves.toEqual({
			title: "Fix Herdr Agent Status",
			source: "model",
		});
		expect(complete).toHaveBeenCalledTimes(1);
	});
	it("falls back locally after model failure or invalid output", async () => {
		const complete = vi.fn().mockRejectedValue(new Error("provider unavailable"));
		const result = await generateTitle({ prompt: "research workspace naming", maxLength: 48, complete });
		expect(result).toEqual({ title: "Research Workspace Naming", source: "fallback" });
	});
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- test/naming.test.ts
```

Expected: FAIL because `src/naming.ts` does not exist.

- [ ] **Step 3: Implement title policy**

Create `src/naming.ts` with:

```ts
const TITLE_SYSTEM_PROMPT = [
	"Create a concise task title for a coding-agent workspace.",
	"Return only 3 to 6 words in the user's language.",
	"Use title case when natural for that language.",
	"Describe the task, not the conversation.",
	"No quotes, markdown, path names, issue commentary, or trailing punctuation.",
].join("\n");

const STOP_WORDS = new Set([
	"a", "an", "and", "can", "could", "for", "how", "i", "in", "is", "it", "me", "my", "of",
	"on", "please", "should", "the", "this", "to", "we", "with", "you",
]);

export function normalizeTitle(value: string, maxLength: number): string | undefined {
	const text = value
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/^\s*[-*#>`]+\s*/g, "")
		.replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
		.replace(/[.!?:;,]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!text || /^(here(?:'s| is)|title\s*:)/i.test(text) || text.includes("\n")) return undefined;
	const words = text.split(" ");
	if (words.length < 2 || words.length > 8) return undefined;
	return [...text].slice(0, maxLength).join("").trim().replace(/[.!?:;,]+$/g, "") || undefined;
}

export function fallbackTitle(prompt: string, maxLength: number): string {
	const safe = prompt
		.replace(/(?:[A-Za-z]:)?[\\/][^\s]+/g, " ")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/[^\p{L}\p{N}\s-]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	const words = safe
		.split(" ")
		.filter((word) => word && !STOP_WORDS.has(word.toLowerCase()))
		.slice(0, 6)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
	const candidate = words.join(" ") || "Pi Task";
	return [...candidate].slice(0, maxLength).join("").trim();
}

export interface GenerateTitleInput {
	prompt: string;
	maxLength: number;
	complete(systemPrompt: string, prompt: string): Promise<string>;
}

export async function generateTitle(input: GenerateTitleInput): Promise<{ title: string; source: "model" | "fallback" }> {
	try {
		const result = normalizeTitle(await input.complete(TITLE_SYSTEM_PROMPT, input.prompt), input.maxLength);
		if (result) return { title: result, source: "model" };
	} catch {
		// The caller receives a deterministic fallback; provider details are intentionally not propagated.
	}
	return { title: fallbackTitle(input.prompt, input.maxLength), source: "fallback" };
}
```

Refine implementation only as needed to satisfy the stated tests; keep one model attempt, bounded output, and no provider error leakage.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- test/naming.test.ts
npm run typecheck
npm exec biome check -- src/naming.ts test/naming.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/naming.ts test/naming.test.ts
git commit -m "feat: add bounded AI task title generation"
```

---

### Task 3: Versioned Session State and Active-Branch Reconstruction

**Files:**
- Create: `src/state.ts`
- Create: `test/state.test.ts`

**Interfaces:**
- Produces: `STATE_TYPE`, `StateRecord`, `SessionState`, `reconstructState(branch, sessionId)`, `record(pi, value)`.
- Input branch entries use Pi custom-entry shape `{ type: "custom", customType, data }`.
- Later lifecycle code depends on `candidate`, `named`, and latest sync status fields.

- [ ] **Step 1: Write failing active-branch/session-scope tests**

Create `test/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { STATE_TYPE, reconstructState } from "../src/state.ts";

const custom = (data: unknown) => ({ type: "custom", customType: STATE_TYPE, data });

describe("reconstructState", () => {
	it("uses only valid records matching the current session", () => {
		const state = reconstructState(
			[
				custom({ v: 1, kind: "named", sessionId: "parent", title: "Parent Task", at: 1 }),
				custom({ v: 1, kind: "candidate", sessionId: "fork", prompt: "new task", at: 2 }),
				custom({ v: 99, kind: "named", sessionId: "fork", title: "bad", at: 3 }),
			],
			"fork",
		);
		expect(state).toMatchObject({ candidate: "new task", title: undefined });
	});

	it("replays latest records deterministically", () => {
		const state = reconstructState(
			[
				custom({ v: 1, kind: "named", sessionId: "s1", title: "First", at: 1 }),
				custom({ v: 1, kind: "named", sessionId: "s1", title: "Second", at: 2 }),
				custom({ v: 1, kind: "sync-finished", sessionId: "s1", title: "Second", workspaceId: "w2", at: 3 }),
			],
			"s1",
		);
		expect(state).toMatchObject({ title: "Second", syncedTitle: "Second", workspaceId: "w2" });
	});
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/state.test.ts
```

Expected: FAIL because state module is absent.

- [ ] **Step 3: Implement strict record parsing and replay**

Create `src/state.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const STATE_TYPE = "pi-herdr-workspace-namer/v1";

export type StateRecord =
	| { v: 1; kind: "candidate"; sessionId: string; prompt: string; at: number }
	| { v: 1; kind: "named"; sessionId: string; title: string; at: number }
	| { v: 1; kind: "sync-started"; sessionId: string; title: string; workspaceId?: string; at: number }
	| { v: 1; kind: "sync-finished" | "sync-failed"; sessionId: string; title: string; workspaceId?: string; at: number };

export interface SessionState {
	sessionId: string;
	candidate?: string;
	title?: string;
	syncedTitle?: string;
	workspaceId?: string;
}

function validRecord(value: unknown, sessionId: string): value is StateRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return record.v === 1 && record.sessionId === sessionId && typeof record.kind === "string" && typeof record.at === "number";
}

export function reconstructState(branch: readonly unknown[], sessionId: string): SessionState {
	const state: SessionState = { sessionId };
	for (const entry of branch) {
		if (!entry || typeof entry !== "object") continue;
		const item = entry as { type?: string; customType?: string; data?: unknown };
		if (item.type !== "custom" || item.customType !== STATE_TYPE || !validRecord(item.data, sessionId)) continue;
		const record = item.data;
		if (record.kind === "candidate" && typeof record.prompt === "string") state.candidate = record.prompt;
		if (record.kind === "named" && typeof record.title === "string") state.title = record.title;
		if (record.kind === "sync-finished" && typeof record.title === "string") {
			state.syncedTitle = record.title;
			state.workspaceId = record.workspaceId;
		}
	}
	return state;
}

export function record(pi: Pick<ExtensionAPI, "appendEntry">, value: StateRecord): void {
	pi.appendEntry(STATE_TYPE, value);
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- test/state.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts test/state.test.ts
git commit -m "feat: persist workspace naming session state"
```

---

### Task 4: Safe Herdr Adapter and Concurrent Writer Lock

**Files:**
- Create: `src/herdr.ts`
- Create: `test/herdr.test.ts`
- Create: `test/fixtures/fake-herdr.mjs`

**Interfaces:**
- Produces: `syncWorkspaceName(input): Promise<SyncResult>`.
- Consumes injected `exec(command, args, options)` compatible with `pi.exec`.
- `SyncResult` is `{ ok: true, workspaceId, title }` or `{ ok: false, code, message }` where messages are bounded/sanitized.

- [ ] **Step 1: Write failing adapter tests**

Create tests covering exact arguments and failure handling:

```ts
import { describe, expect, it, vi } from "vitest";
import { syncWorkspaceName } from "../src/herdr.ts";

const ok = (stdout: string) => ({ stdout, stderr: "", code: 0, killed: false });

describe("syncWorkspaceName", () => {
	it("resolves current placement, renames explicit workspace, and verifies", async () => {
		const exec = vi
			.fn()
			.mockResolvedValueOnce(ok(JSON.stringify({ result: { pane: { workspace_id: "wA" } } })))
			.mockResolvedValueOnce(ok(JSON.stringify({ result: { workspace: { workspace_id: "wA", label: "Fix Status" } } })))
			.mockResolvedValueOnce(ok(JSON.stringify({ result: { workspace: { workspace_id: "wA", label: "Fix Status" } } })));
		await expect(syncWorkspaceName({ title: "Fix Status", command: "herdr", timeoutMs: 5000, exec })).resolves.toEqual({
			ok: true,
			workspaceId: "wA",
			title: "Fix Status",
		});
		expect(exec.mock.calls.map((call) => call[1])).toEqual([
			["pane", "current", "--current"],
			["workspace", "rename", "wA", "Fix Status"],
			["workspace", "get", "wA"],
		]);
	});

	it("fails closed on malformed JSON and never attempts rename", async () => {
		const exec = vi.fn().mockResolvedValue(ok("not json"));
		const result = await syncWorkspaceName({ title: "Safe; rm -rf /", command: "herdr", timeoutMs: 5000, exec });
		expect(result).toMatchObject({ ok: false, code: "invalid_current_pane" });
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it("reports verification mismatch without retrying", async () => {
		const exec = vi
			.fn()
			.mockResolvedValueOnce(ok(JSON.stringify({ result: { pane: { workspace_id: "w1" } } })))
			.mockResolvedValueOnce(ok("{}"))
			.mockResolvedValueOnce(ok(JSON.stringify({ result: { workspace: { label: "Someone Else" } } })));
		expect((await syncWorkspaceName({ title: "Expected", command: "herdr", timeoutMs: 5000, exec })).ok).toBe(false);
		expect(exec).toHaveBeenCalledTimes(3);
	});
});
```

Also add a lock test with two concurrent calls and an injected temporary lock root; assert rename critical sections do not overlap.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/herdr.test.ts
```

Expected: FAIL because adapter is absent.

- [ ] **Step 3: Implement parsing, locking, command execution, and verification**

Create `src/herdr.ts` with these concrete contracts:

```ts
import { mkdir, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";

export type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
export type SyncResult =
	| { ok: true; workspaceId: string; title: string }
	| { ok: false; code: string; message: string; workspaceId?: string };

function bounded(value: unknown): string {
	return String(value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, 160);
}

function parseJson(stdout: string): unknown {
	try { return JSON.parse(stdout); } catch { return undefined; }
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

async function withLock<T>(workspaceId: string, action: () => Promise<T>, root = join(tmpdir(), "pi-herdr-workspace-namer")): Promise<T> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	const lock = join(root, `${workspaceId}.lock`);
	const deadline = Date.now() + 2000;
	for (;;) {
		try {
			const handle = await open(lock, "wx", 0o600);
			await handle.close();
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw error;
			try {
				if (Date.now() - (await stat(lock)).mtimeMs > 10000) await rm(lock, { force: true });
			} catch { /* another writer changed the lock */ }
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
	}
	try { return await action(); } finally { await rm(lock, { force: true }); }
}
```

Complete `syncWorkspaceName` using the three exact command calls from tests. Check `result.code === 0`, parse current `workspace_id`, lock by that ID, re-resolve current pane once inside the lock, and if it moved acquire/synchronize using the newly resolved ID rather than renaming the old workspace. Return bounded codes/messages; never include raw title/prompt or unbounded stderr in failure messages.

Create `test/fixtures/fake-herdr.mjs` as an executable fixture that logs `process.argv.slice(2)` to a path supplied by `FAKE_HERDR_LOG` and emits configured JSON from `FAKE_HERDR_RESPONSES`; use it in one test to prove metacharacters remain one argv element.

- [ ] **Step 4: Verify GREEN and subprocess safety**

Run:

```bash
npm test -- test/herdr.test.ts
npm run typecheck
```

Expected: PASS; metacharacter test proves no shell execution.

- [ ] **Step 5: Commit**

```bash
git add src/herdr.ts test/herdr.test.ts test/fixtures/fake-herdr.mjs
git commit -m "feat: safely synchronize Herdr workspace labels"
```

---

### Task 5: Pi Lifecycle State Machine and Runtime Extension

**Files:**
- Create: `src/lifecycle.ts`
- Create: `extensions/workspace-namer.ts`
- Create: `test/lifecycle.test.ts`

**Interfaces:**
- Produces: `registerWorkspaceNamer(pi, dependencies)` for tests and runtime.
- Runtime adapter imports `completeSimple` from `@earendil-works/pi-ai` and official `ExtensionAPI` types.
- Lifecycle dependency contract includes config loader, title generator, Herdr synchronizer, clock, and file reader.

- [ ] **Step 1: Write a fake Pi harness and failing lifecycle tests**

In `test/lifecycle.test.ts`, implement a minimal harness whose `on(name, handler)` stores handlers, whose `setSessionName`, `getSessionName`, `appendEntry`, and `exec` are spies, and whose contexts expose `sessionManager.getSessionId()` and `getBranch()`.

Required tests:

```ts
it("generates once only after the first agent_settled", async () => {
	// session_start(s1), input(first task), before_agent_start(expanded), agent_settled
	// assert generateTitle once, setSessionName once, sync once
	// input(second task), agent_settled
	// assert counts remain one
});

it("syncs a resumed native session name without generating", async () => {
	// getSessionName() returns "Resume Auth Refactor" at session_start reason resume
	// assert sync called once and generateTitle never called
});

it("a fork ignores inherited parent records and names from its first new prompt", async () => {
	// branch includes parent session records; current session ID differs
	// assert one fresh generation
});

it("mirrors manual session_info_changed and suppresses duplicate own-name event", async () => {
	// own setSessionName event produces one sync total
	// later manual event name produces another sync
});

it("ignores extension messages, streaming steering/followups, blank text, and image-only input", async () => {
	// assert no candidate and no generation
});

it("falls back to expanded before_agent_start prompt for skill/template input", async () => {
	// raw '/skill:search' is command-like; expanded prompt is used
});

it("never throws when Herdr synchronization fails", async () => {
	// synchronize returns failure; event handler resolves and optionally notifies once
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/lifecycle.test.ts
```

Expected: FAIL because lifecycle module is absent.

- [ ] **Step 3: Implement lifecycle orchestration**

Create `src/lifecycle.ts` around this explicit state:

```ts
interface RuntimeState {
	sessionId: string;
	candidate?: string;
	title?: string;
	generating: boolean;
	syncing: boolean;
	suppressSessionName?: string;
	shuttingDown: boolean;
}
```

Implement handlers with these exact rules:

1. `session_start` reconstructs only current-session active-branch records, resets all mutex flags, and if `pi.getSessionName()` is nonempty queues one safe `synchronize(name, ctx)` call.
2. `input` captures only sources `interactive|rpc`, absent `streamingBehavior`, nonblank text, and text not beginning `/`; append a `candidate` record immediately.
3. `before_agent_start` uses `event.prompt` only when no candidate exists, normalizes it, and appends the candidate record. This supports expanded skill/template prompts.
4. `agent_settled` exits if disabled, shutting down, already named, already generating, or no candidate. Otherwise set `generating`, invoke injected title generation once, append `named`, set `suppressSessionName`, call `pi.setSessionName`, synchronize, then clear `generating` in `finally`.
5. `session_info_changed` ignores undefined/blank names. If it matches `suppressSessionName`, clear suppression and do not duplicate the explicit sync. Otherwise treat it as manual/native and synchronize immediately.
6. `session_shutdown` marks state shut down and clears candidate/mutex references; asynchronous completions must check session ID before mutating current state.
7. Notifications are one concise message only when `notifyOnError && ctx.hasUI`; never include raw stderr or prompt.

Use an internal promise queue for synchronization so startup/resume/manual events execute in order. Each queued action captures the session ID and aborts if the current runtime has switched sessions.

- [ ] **Step 4: Wire the official Pi runtime adapter**

Create `extensions/workspace-namer.ts`:

```ts
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";
import { loadConfig } from "../src/config.ts";
import { syncWorkspaceName } from "../src/herdr.ts";
import { registerWorkspaceNamer } from "../src/lifecycle.ts";
import { generateTitle } from "../src/naming.ts";

function readOptional(path: string): string | undefined {
	try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

async function completeWithCurrentModel(ctx: ExtensionContext, systemPrompt: string, prompt: string): Promise<string> {
	if (!ctx.model) throw new Error("no active model");
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error("model authentication unavailable");
	const response = await completeSimple(
		ctx.model,
		{ systemPrompt, messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
		{
			maxTokens: 32,
			apiKey: auth.apiKey,
			headers: { ...(ctx.model.headers ?? {}), ...(auth.headers ?? {}) },
		},
	);
	const text = response.content.findLast((part) => part.type === "text");
	if (!text || text.type !== "text") throw new Error("model returned no title");
	return text.text;
}

export default function workspaceNamer(pi: ExtensionAPI): void {
	registerWorkspaceNamer(pi, {
		loadConfig: (cwd) => loadConfig({ cwd, readFile: readOptional }),
		generateTitle: (ctx, prompt, maxLength) =>
			generateTitle({ prompt, maxLength, complete: (system, user) => completeWithCurrentModel(ctx, system, user) }),
		syncWorkspace: (title, config) => {
			if (process.env.HERDR_ENV !== "1") return Promise.resolve({ ok: false as const, code: "outside_herdr", message: "Pi is not running inside Herdr" });
			return syncWorkspaceName({ title, command: config.herdrCommand, timeoutMs: config.commandTimeoutMs, exec: pi.exec.bind(pi) });
		},
		now: Date.now,
	});
}
```

Adapt type details only to match installed Pi 0.82.1 declarations; preserve one model call and the module boundaries.

- [ ] **Step 5: Verify lifecycle and full suite GREEN**

Run:

```bash
npm test
npm run typecheck
npm exec biome check -- extensions src test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lifecycle.ts extensions/workspace-namer.ts test/lifecycle.test.ts
git commit -m "feat: connect Pi session lifecycle to Herdr naming"
```

---

### Task 6: Community Documentation, Agent Guidance, and Security Policy

**Files:**
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`
- Create: `test/docs.test.ts`

**Interfaces:**
- Documentation commands must match `package.json` exactly.
- AGENTS instructions must preserve lifecycle, source-of-truth, subprocess, TDD, and release invariants.

- [ ] **Step 1: Write failing documentation-contract tests**

Create `test/docs.test.ts` to read repository files and assert:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("community documentation", () => {
	it("documents install, update, uninstall, privacy, cost, trust, and Herdr custom-name behavior", () => {
		const readme = read("README.md");
		for (const phrase of [
			"pi install npm:pi-herdr-workspace-namer",
			"pi update pi-herdr-workspace-namer",
			"pi remove npm:pi-herdr-workspace-namer",
			"one additional model request",
			"full user privileges",
			"cannot reset",
		]) expect(readme).toContain(phrase);
	});

	it("gives agents the non-negotiable implementation invariants", () => {
		const agents = read("AGENTS.md");
		for (const phrase of ["agent_settled", "Pi session name", "pi.exec", "npm pack --dry-run", "test first"])
			expect(agents).toContain(phrase);
	});
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/docs.test.ts
```

Expected: FAIL because public docs do not exist.

- [ ] **Step 3: Write README and community files**

`README.md` must contain these sections in order:

1. Hero statement and short example.
2. Requirements: Pi `>=0.82.1`, Herdr `>=0.7.5`, Node `>=22`.
3. Install/update/uninstall commands.
4. Behavior table for startup, `/new`, `/resume`, `/fork`, `/name`, later prompts, outside-Herdr mode.
5. Configuration JSON and defaults.
6. Privacy/cost: first prompt sent to active provider in one additional model request; local fallback; no telemetry.
7. Herdr limitation: `workspace rename` creates a custom name and current Herdr cannot reset it; active Pi session overwrites workspace label.
8. Security warning: Pi packages execute with full user privileges; review source.
9. Troubleshooting using `herdr integration status`, `herdr pane current --current`, `pi list`, and `/reload`.
10. Development, release, contributing, security, and license links.

`AGENTS.md` must state:

```md
# AGENTS.md

## Source of truth
Pi session name is authoritative. Herdr workspace label is derived one-way.

## Required references
Before changing lifecycle code, read the installed Pi `docs/extensions.md` and the matching version's extension types. Before changing Herdr behavior, read Herdr's matching tagged `SKILL.md`, workspace CLI/API schema, and workspace implementation.

## Invariants
- Generate at most once per Pi session ID.
- Use `agent_settled`, never `agent_end`, for naming completion.
- Reconstruct only from `ctx.sessionManager.getBranch()` and scope records by current session ID.
- Resolve placement with `herdr pane current --current` before every rename.
- Execute Herdr through `pi.exec` with argument arrays; never use `sh -c` or string interpolation.
- Never log prompts, provider credentials, raw model failures, or unbounded stderr.
- Never rename panes, tabs, branches, or worktrees.
- Failures must not fail the Pi turn.

## Development
Use test-driven development: add a failing focused test first, observe RED, implement minimally, then verify GREEN. Run `npm run check` before claiming completion. Run `npm pack --dry-run` and `npm run verify:package` before release. Keep one writer in the active worktree and avoid unrelated refactors.
```

`CONTRIBUTING.md`: Node/npm setup, `npm ci`, RED/GREEN workflow, `npm run check`, optional live smoke, issue and PR evidence requirements, compatibility report template.

`SECURITY.md`: full-system-access model, no secrets in issues, private reporting through GitHub Security Advisories, supported versions table, 90-day coordinated disclosure target.

`CHANGELOG.md`: Keep a Changelog format with `0.1.0` features and compatibility floors.

`LICENSE`: standard MIT text, copyright `2026 Tyler Folkman`.

- [ ] **Step 4: Verify GREEN and spelling/command consistency**

Run:

```bash
npm test -- test/docs.test.ts
npm exec biome check -- README.md AGENTS.md CONTRIBUTING.md SECURITY.md CHANGELOG.md test/docs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md CONTRIBUTING.md SECURITY.md CHANGELOG.md LICENSE test/docs.test.ts
git commit -m "docs: prepare community package guidance"
```

---

### Task 7: CI, Package Inspection, and Install/Live Smoke Verification

**Files:**
- Create: `scripts/verify-package.mjs`
- Create: `scripts/live-smoke.mjs`
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `test/package.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- `verify-package.mjs` runs `npm pack --json --dry-run`, validates allowlist and required resources, exits nonzero on unsafe files.
- `live-smoke.mjs` runs only when `PI_HERDR_WORKSPACE_NAMER_LIVE=1`; it must use a disposable named Herdr test session and never touch the user's active session.

- [ ] **Step 1: Write failing package-content tests**

Create `test/package.test.ts` to parse `package.json` and assert:

```ts
expect(pkg.keywords).toContain("pi-package");
expect(pkg.pi.extensions).toEqual(["./extensions/workspace-namer.ts"]);
expect(pkg.files).toEqual(expect.arrayContaining(["extensions", "src", "README.md", "LICENSE"]));
expect(pkg.peerDependencies["@earendil-works/pi-ai"]).toBe("*");
expect(pkg.peerDependencies["@earendil-works/pi-coding-agent"]).toBe("*");
```

Add a process test that executes `node scripts/verify-package.mjs` and expects exit code `0` only after the script exists.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/package.test.ts
```

Expected: FAIL because verification script is absent.

- [ ] **Step 3: Implement package verification**

Create `scripts/verify-package.mjs` that:

1. Executes `npm pack --json --dry-run --ignore-scripts`.
2. Parses the first package record's `files[].path`.
3. Requires `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `extensions/workspace-namer.ts`, and every `src/*.ts` runtime module.
4. Rejects paths matching `(^|/)(\.env|\.git|node_modules|test|docs|coverage|\.pi-subagents)(/|$)`, session/log extensions, absolute-home fragments, or files over 250 KiB.
5. Rejects package contents containing likely secret assignments such as `API_KEY=`, `TOKEN=`, or `PASSWORD=` while allowing documentation phrases that do not assign values.
6. Prints a concise file/size summary and exits zero.

- [ ] **Step 4: Add safe optional live smoke**

Create `scripts/live-smoke.mjs` with hard guards:

```js
if (process.env.PI_HERDR_WORKSPACE_NAMER_LIVE !== "1") {
	console.error("Set PI_HERDR_WORKSPACE_NAMER_LIVE=1 to run the disposable Herdr smoke test.");
	process.exit(2);
}
```

Use `herdr --session pi-herdr-workspace-namer-smoke ...` only after checking current installed CLI syntax. Create a disposable workspace labeled `before-smoke`, invoke the adapter against a fake/current pane in that named session if supported, verify `after-smoke`, then close only resources created by the script. Never call `herdr server stop` on the active/default session. If Herdr cannot provide a fully isolated noninteractive pane, skip with a documented reason rather than targeting live user state.

- [ ] **Step 5: Add CI and Dependabot**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm pack --dry-run
```

Create `.github/dependabot.yml` for monthly npm and GitHub Actions updates, limit five open PRs each.

- [ ] **Step 6: Verify packed install locally**

Run:

```bash
npm run check
npm run verify:package
npm pack --dry-run
TARBALL=$(npm pack --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].filename))')
TMP=$(mktemp -d)
cd "$TMP"
npm init -y >/dev/null
npm install "/home/tyler/Coding/pi-herdr-workspace-namer/$TARBALL"
test -f node_modules/pi-herdr-workspace-namer/extensions/workspace-namer.ts
cd /home/tyler/Coding/pi-herdr-workspace-namer
rm -f "$TARBALL"
```

Expected: checks PASS and packed extension exists.

Then run Pi's temporary package smoke outside the user's primary session:

```bash
pi -e /home/tyler/Coding/pi-herdr-workspace-namer -p "Reply with OK only" --no-session
```

Expected: Pi loads package without extension/type/load errors; outside Herdr, workspace synchronization is skipped.

- [ ] **Step 7: Commit**

```bash
git add scripts .github test/package.test.ts package.json package-lock.json README.md
git commit -m "ci: verify package and installation paths"
```

---

### Task 8: Independent Review, Local Adoption, and Public Release

**Files:**
- Modify only files required by evidence-backed reviewer findings.
- Potentially modify: `package.json`, `CHANGELOG.md`, `README.md` for final release metadata.

**Interfaces:**
- Release requires all prior checks plus independent review.
- GitHub/npm publication are external actions; confirm authenticated identities and ask for final explicit publication approval immediately before creating the public repo or publishing npm.

- [ ] **Step 1: Run full verification from a clean checkout state**

Run:

```bash
git status --short
npm ci
npm run check
npm run verify:package
npm pack --dry-run
```

Expected: clean status before generated artifacts; all checks PASS; only intended files are packed.

- [ ] **Step 2: Request independent code and package review**

Dispatch fresh-context reviewers with distinct scopes:

1. Pi lifecycle/state correctness against Pi 0.82.1 docs.
2. Herdr safety/concurrency against Herdr 0.7.5 APIs.
3. Supply-chain/package/docs/community readiness.

Each reviewer must return only evidence-backed findings with file/line references and no edits. Apply accepted fixes as one writer, add regression tests first, and rerun `npm run check`.

- [ ] **Step 3: Install locally through Pi package management**

Run:

```bash
pi install /home/tyler/Coding/pi-herdr-workspace-namer
pi list
```

Start a disposable Pi session in a disposable Herdr workspace, submit one non-sensitive test prompt, and verify:

- one Pi session name is created;
- current Herdr workspace receives identical label;
- second prompt makes no naming request/rename;
- `/new` names after first settled turn;
- `/resume` restores saved title without a naming call;
- `/name Manual Test` mirrors immediately.

Remove/close only disposable resources. Keep the local package installed for Tyler only after successful verification.

- [ ] **Step 4: Prepare the release commit and tag locally**

Confirm `package.json` and `CHANGELOG.md` both say `0.1.0`, then run:

```bash
git add -A
git commit -m "release: prepare v0.1.0" || true
git tag -a v0.1.0 -m "v0.1.0"
```

Do not push yet.

- [ ] **Step 5: Confirm publication identities and request final approval**

Run read-only checks:

```bash
gh api user --jq .login
npm whoami
npm view pi-herdr-workspace-namer version || true
```

Expected GitHub identity: `tfolkman`. Expected npm package: not found before first publication. Report identities, exact release contents, test evidence, and residual risks. Ask Tyler for explicit approval to create the public repository and publish npm.

- [ ] **Step 6: Create public GitHub repository after approval**

After explicit approval only:

```bash
gh repo create tfolkman/pi-herdr-workspace-namer \
  --public \
  --source=. \
  --remote=origin \
  --description="Automatically name Herdr workspaces from native Pi session task titles"
git push -u origin main
git push origin v0.1.0
```

Verify:

```bash
gh repo view tfolkman/pi-herdr-workspace-namer --json url,visibility,defaultBranchRef
```

Expected: public repo, `main` default branch.

- [ ] **Step 7: Publish npm with provenance after approval**

Use the authenticated npm CLI store; do not read or print token values:

```bash
npm publish --provenance --access public
npm view pi-herdr-workspace-namer name version keywords repository --json
```

Expected: version `0.1.0`, `pi-package` keyword, correct GitHub repository.

- [ ] **Step 8: Verify public installation and gallery eligibility**

In a temporary Pi environment or disposable user settings backup, run:

```bash
pi -e npm:pi-herdr-workspace-namer -p "Reply with OK only" --no-session
```

Expected: package resolves from npm and loads successfully.

Check `https://pi.dev/packages` after registry indexing. If gallery ingestion is delayed, record that npm metadata is correct rather than changing runtime code.

- [ ] **Step 9: Final evidence report**

Report:

- GitHub URL and npm URL.
- Published version/tag/commit.
- Verification commands and outcomes.
- Installed local source (`npm:` after replacing local path, if desired).
- Known Herdr reset-to-auto limitation.
- One-extra-model-request privacy/cost behavior.
- Any deferred gallery image/demo work.
