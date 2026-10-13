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
		const frames = [this.enter(id)];
		while (frames.length > 0) {
			const frame = frames.at(-1);
			if (!frame) break;
			const next = frame.children.next();
			if (next.done) {
				frames.pop();
				this.leave(frame.id, frames.at(-1)?.id);
			} else if (!this.indexById.has(next.value)) {
				frames.push(this.enter(next.value));
			} else if (this.onStack.has(next.value)) {
				this.lower(frame.id, this.indexById.get(next.value) ?? 0);
			}
		}
	}

	private leave(id: string, parentId?: string): void {
		if (this.lowLinkById.get(id) === this.indexById.get(id)) this.finishComponent(id);
		if (parentId !== undefined) this.lower(parentId, this.lowLinkById.get(id) ?? 0);
	}

	private enter(id: string) {
		this.indexById.set(id, this.index);
		this.lowLinkById.set(id, this.index++);
		this.stack.push(id);
		this.onStack.add(id);
		return { id, children: [...(this.children.get(id) ?? [])].sort().values() };
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
