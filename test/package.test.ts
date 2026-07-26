import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("package metadata", () => {
	it("declares the Pi extension and publishable runtime files", () => {
		expect(pkg.keywords).toContain("pi-package");
		expect(pkg.pi.extensions).toEqual(["./extensions/workspace-namer.ts"]);
		expect(pkg.files).toEqual(expect.arrayContaining(["extensions", "src", "README.md", "LICENSE"]));
		expect(pkg.peerDependencies["@earendil-works/pi-ai"]).toBe("*");
		expect(pkg.peerDependencies["@earendil-works/pi-coding-agent"]).toBe("*");
	});
});

describe("package verifier", () => {
	it("accepts the package produced by npm pack", () => {
		expect(() =>
			execFileSync(process.execPath, ["scripts/verify-package.mjs"], {
				cwd: root,
				stdio: "pipe",
			}),
		).not.toThrow();
	});

	it("uses a script-free dry run and distinguishes documentation from secret assignments", async () => {
		// @ts-expect-error The verifier is intentionally plain JavaScript for direct Node execution.
		const { PACK_ARGS, containsSecretAssignment } = await import("../scripts/verify-package.mjs");
		expect(PACK_ARGS).toEqual(["pack", "--json", "--dry-run", "--ignore-scripts"]);
		expect(containsSecretAssignment("Set API_KEY= in your environment.")).toBe(false);
		expect(containsSecretAssignment("The TOKEN= form is supported.")).toBe(false);
		expect(containsSecretAssignment("API_KEY=[REDACTED:Generic Password Field]")).toBe(true);
		expect(containsSecretAssignment('PASSWORD="[REDACTED:Generic Password Field]"')).toBe(true);
	});

	it("exits nonzero for an unsafe packed-file record and identifies an absolute-home path", () => {
		const fixture = mkdtempSync(path.join(tmpdir(), "workspace-namer-unsafe-package-"));
		try {
			mkdirSync(path.join(fixture, "bin"), { recursive: true });
			mkdirSync(path.join(fixture, "src"));
			writeFileSync(path.join(fixture, "src", "index.ts"), "export {};\n");
			const files = [
				"package.json",
				"README.md",
				"LICENSE",
				"CHANGELOG.md",
				"SECURITY.md",
				"extensions/workspace-namer.ts",
				"src/index.ts",
				"home/alice/.env",
			].map((packagePath) => ({ path: packagePath, size: 10 }));
			const fakeNpm = path.join(fixture, "bin", "npm");
			writeFileSync(fakeNpm, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify([{ files }])}'\n`);
			chmodSync(fakeNpm, 0o755);

			const result = spawnSync(process.execPath, [path.join(root.pathname, "scripts/verify-package.mjs")], {
				cwd: fixture,
				encoding: "utf8",
				env: { ...process.env, PATH: `${path.join(fixture, "bin")}:${process.env.PATH}` },
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("absolute home fragment in path: home/alice/.env");
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	it("rejects unsafe, non-allowlisted, oversized, session, and absolute-home paths", async () => {
		// @ts-expect-error The verifier is intentionally plain JavaScript for direct Node execution.
		const { inspectPackage } = await import("../scripts/verify-package.mjs");
		const errors = inspectPackage(
			{
				files: [
					{ path: "package.json", size: 10 },
					{ path: "README.md", size: 10 },
					{ path: "LICENSE", size: 10 },
					{ path: "CHANGELOG.md", size: 10 },
					{ path: "SECURITY.md", size: 10 },
					{ path: "extensions/workspace-namer.ts", size: 10 },
					{ path: "src/index.ts", size: 10 },
					{ path: "docs/private.txt", size: 10 },
					{ path: "src/oversized.ts", size: 250 * 1024 + 1 },
					{ path: "src/debug.session", size: 10 },
					{ path: "home/alice/private.ts", size: 10 },
				],
			},
			{ runtimeFiles: ["src/index.ts"], readContents: () => "" },
		);
		expect(errors).toEqual(
			expect.arrayContaining([
				"file is not allowlisted: docs/private.txt",
				"unsafe directory in path: docs/private.txt",
				"file exceeds 250 KiB: src/oversized.ts (256001 bytes)",
				"session/log artifact in path: src/debug.session",
				"absolute home fragment in path: home/alice/private.ts",
			]),
		);
	});

	it("rejects a package with no runtime module", async () => {
		// @ts-expect-error The verifier is intentionally plain JavaScript for direct Node execution.
		const { inspectPackage } = await import("../scripts/verify-package.mjs");
		const errors = inspectPackage(
			{
				files: [
					{ path: "package.json", size: 10 },
					{ path: "README.md", size: 10 },
					{ path: "LICENSE", size: 10 },
					{ path: "CHANGELOG.md", size: 10 },
					{ path: "SECURITY.md", size: 10 },
					{ path: "extensions/workspace-namer.ts", size: 10 },
				],
			},
			{ runtimeFiles: [], readContents: () => "" },
		);
		expect(errors).toContain("missing src/*.ts runtime modules");
	});
});
