/** Tarjan SCC: only cycle members (including self-links), never their descendants. */
export function findCyclicWorkIds(
	workIds: readonly string[],
	children: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
	return new LineageCycles(children).find(workIds);
}

class LineageCycles {
	private index = 0;
	private readonly indexById = new Map<string, number>();
	private readonly lowLinkById = new Map<string, number>();
	private readonly stack: string[] = [];
	private readonly onStack = new Set<string>();
	private readonly cyclic = new Set<string>();

	constructor(private readonly children: ReadonlyMap<string, ReadonlySet<string>>) {}

	find(workIds: readonly string[]): Set<string> {
		for (const id of workIds) {
			if (!this.indexById.has(id)) this.visit(id);
		}
		return this.cyclic;
	}

	private visit(id: string): void {
		this.indexById.set(id, this.index);
		this.lowLinkById.set(id, this.index++);
		this.stack.push(id);
		this.onStack.add(id);
		for (const child of [...(this.children.get(id) ?? [])].sort()) {
			if (!this.indexById.has(child)) {
				this.visit(child);
				this.lower(id, this.lowLinkById.get(child) ?? 0);
			} else if (this.onStack.has(child)) {
				this.lower(id, this.indexById.get(child) ?? 0);
			}
		}
		if (this.lowLinkById.get(id) === this.indexById.get(id)) this.finishComponent(id);
	}

	private lower(id: string, index: number): void {
		this.lowLinkById.set(id, Math.min(this.lowLinkById.get(id) ?? 0, index));
	}

	private finishComponent(id: string): void {
		const component: string[] = [];
		let member: string | undefined;
		do {
			member = this.stack.pop();
			if (member === undefined) throw new Error("Incomplete lineage component");
			this.onStack.delete(member);
			component.push(member);
		} while (member !== id);
		if (component.length > 1 || this.children.get(id)?.has(id)) {
			for (const workId of component) this.cyclic.add(workId);
		}
	}
}
