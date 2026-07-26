import { readFileSync } from "node:fs";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.ts";
import { syncWorkspaceName } from "../src/herdr.ts";
import { registerWorkspaceNamer } from "../src/lifecycle.ts";
import { generateTitle } from "../src/naming.ts";

function readOptional(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

async function completeWithCurrentModel(
	ctx: ExtensionContext,
	systemPrompt: string,
	prompt: string,
): Promise<string> {
	if (!ctx.model) throw new Error("no active model");
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error("model authentication unavailable");
	const response = await completeSimple(
		ctx.model,
		{
			systemPrompt,
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
		},
		{
			maxTokens: 32,
			apiKey: auth.apiKey,
			headers: { ...(ctx.model.headers ?? {}), ...(auth.headers ?? {}) },
		},
	);
	const text = response.content.findLast((part) => part.type === "text");
	if (text?.type !== "text") throw new Error("model returned no title");
	return text.text;
}

export default function workspaceNamer(pi: ExtensionAPI): void {
	if (process.env.HERDR_ENV !== "1" || process.env.PI_SUBAGENT_CHILD === "1") return;

	registerWorkspaceNamer(pi, {
		loadConfig: (cwd) => loadConfig({ cwd, readFile: readOptional }),
		generateTitle: (ctx, prompt, maxLength) =>
			generateTitle({
				prompt,
				maxLength,
				complete: (system, user) => completeWithCurrentModel(ctx, system, user),
			}),
		syncWorkspace: (title, config) => {
			return syncWorkspaceName({
				title,
				command: config.herdrCommand,
				timeoutMs: config.commandTimeoutMs,
				exec: pi.exec.bind(pi),
			});
		},
		now: Date.now,
	});
}
