export function createCommandPaletteController() {
	let open = $state(false);
	let query = $state("");
	return {
		get commandPaletteOpen() {
			return open;
		},
		get commandPaletteQuery() {
			return query;
		},
		setQuery(value: string): void {
			query = value;
		},
		openCommandPalette(): void {
			query = "";
			open = true;
		},
		closeCommandPalette(): void {
			open = false;
		},
	};
}
