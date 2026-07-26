import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import workspaceNamer from "../extensions/workspace-namer.ts";

function runtime(): { pi: ExtensionAPI; on: ReturnType<typeof vi.fn> } {
	const on = vi.fn();
	return { pi: { on } as unknown as ExtensionAPI, on };
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("runtime registration", () => {
	it("does not register lifecycle handlers outside Herdr", () => {
		vi.stubEnv("HERDR_ENV", "0");
		const { pi, on } = runtime();

		workspaceNamer(pi);

		expect(on).not.toHaveBeenCalled();
	});

	it("registers the lifecycle handlers inside Herdr", () => {
		vi.stubEnv("HERDR_ENV", "1");
		const { pi, on } = runtime();

		workspaceNamer(pi);

		expect(on).toHaveBeenCalled();
		expect(on.mock.calls.map(([event]) => event)).toContain("agent_settled");
	});
});
