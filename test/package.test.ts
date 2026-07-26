import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

	it("rejects unsafe, non-allowlisted, oversized, and session artifact paths", async () => {
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
