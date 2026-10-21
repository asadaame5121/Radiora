async function commandExists(command: string, args = ["--version"]): Promise<string | null> {
	try {
		const output = await new Deno.Command(command, {
			args,
			stdout: "piped",
			stderr: "piped",
		}).output();
		const decoder = new TextDecoder();
		const text = decoder.decode(output.stdout).trim() || decoder.decode(output.stderr).trim();
		return output.success ? text.split(/\r?\n/)[0] : null;
	} catch {
		return null;
	}
}

const denoVersion = Deno.version.deno;
const [major, minor] = denoVersion.split(".").map(Number);
if (major < 2 || (major === 2 && minor < 9)) {
	throw new Error(`Deno Desktop requires Deno 2.9.0 or newer. Current Deno is ${denoVersion}.`);
}

const pnpmVersion = await commandExists("pnpm");
if (!pnpmVersion) {
	throw new Error(
		"pnpm was not found. Install Node.js and pnpm 12.14.0 or run this from a shell where pnpm is on PATH.",
	);
}

console.log(`Deno ${denoVersion}`);
console.log(pnpmVersion);
