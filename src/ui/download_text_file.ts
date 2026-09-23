export function downloadTextFile(content: string, mimeType: string, filename: string): void {
	const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}
