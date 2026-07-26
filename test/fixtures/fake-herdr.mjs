#!/usr/bin/env node
import { appendFile } from "node:fs/promises";

const args = process.argv.slice(2);
const log = process.env.FAKE_HERDR_LOG;
if (!log) {
	process.stderr.write("FAKE_HERDR_LOG is required\n");
	process.exitCode = 2;
} else {
	await appendFile(log, `${JSON.stringify(args)}\n`);
	let responses;
	try {
		responses = JSON.parse(process.env.FAKE_HERDR_RESPONSES ?? "{}");
	} catch {
		process.stderr.write("invalid FAKE_HERDR_RESPONSES\n");
		process.exitCode = 2;
	}
	if (responses) {
		const exact = args.join(" ");
		const key = args[0] === "workspace" && args[1] === "rename" ? "workspace rename" : exact;
		const response = responses[key];
		if (response === undefined) {
			process.stderr.write("missing configured response\n");
			process.exitCode = 3;
		} else {
			process.stdout.write(JSON.stringify(response));
		}
	}
}
