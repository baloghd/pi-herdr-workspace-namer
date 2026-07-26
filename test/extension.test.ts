import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import workspaceNamer from "../extensions/workspace-namer.ts";

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
