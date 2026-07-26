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
		expect(containsSecretAssignment("API_KEY=real-secret-value")).toBe(true);
		expect(containsSecretAssignment('PASSWORD="not-safe"')).toBe(true);
	});
});
