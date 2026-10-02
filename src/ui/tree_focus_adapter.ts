/** DOM boundary for restoring keyboard focus in the tree View. */
export function focusTreeSelection(): void {
	(document.querySelector<SVGElement>(".tree-node.selected") ??
		document.querySelector<SVGElement>(".tree-node"))?.focus();
}
