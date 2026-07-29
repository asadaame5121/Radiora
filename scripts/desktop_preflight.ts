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

const npmVersion = await commandExists("npm");
if (!npmVersion) {
	throw new Error(
		"npm was not found. Install Node.js/npm or run this from a shell where npm is on PATH.",
	);
}

console.log(`Deno ${denoVersion}`);
console.log(npmVersion);
