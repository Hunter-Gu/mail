import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runGwsCommand } from "./gws";

const GMAIL_AUTH_CHECK_ARGS = [
	"gmail", "users", "labels", "list",
	"--params", JSON.stringify({ userId: "me" }),
];

function getGmailAccessError(): string | null {
	const result = runGwsCommand(GMAIL_AUTH_CHECK_ARGS);

	if (result.status === 0) return null;
	if (result.error) {
		return result.error.includes("ENOENT")
			? "`gws` is not installed or is not on PATH."
			: result.error;
	}

	return [result.stderr, result.stdout, `gws exited with code ${result.status}`]
		.filter(Boolean)
		.join("\n");
}

async function confirmLogin(): Promise<boolean> {
	const rl = readline.createInterface({ input, output });
	try {
		const answer = await rl.question("Gmail is not authenticated. Run `gws auth login -s gmail` now? [Y/n] ");
		return answer.trim().toLowerCase() !== "n";
	} finally {
		rl.close();
	}
}

export async function ensureGmailAuth(): Promise<void> {
	const initialError = getGmailAccessError();
	if (!initialError) return;

	if (initialError.includes("not installed")) {
		console.error(initialError);
		console.error("Install it with `npm install -g @googleworkspace/cli`, then run this app again.");
		process.exit(1);
	}

	console.warn("Gmail access check failed:");
	console.warn(initialError);

	if (!(await confirmLogin())) {
		console.error("Cannot continue without Gmail access.");
		process.exit(1);
	}

	const login = runGwsCommand(["auth", "login", "-s", "gmail"], { stdio: "inherit" });
	if (login.status !== 0 || login.error) {
		console.error("Gmail login failed.");
		if (login.error) console.error(login.error);
		process.exit(1);
	}

	const retryError = getGmailAccessError();
	if (retryError) {
		console.error("Gmail is still not accessible after login:");
		console.error(retryError);
		process.exit(1);
	}
}
