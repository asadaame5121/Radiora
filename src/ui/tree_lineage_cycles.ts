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

	private visit(startId: string): void {
		interface Frame {
			id: string;
			children: string[];
			childIndex: number;
			lastChild: string | null;
		}
		const enter = (id: string): Frame => {
			this.indexById.set(id, this.index);
			this.lowLinkById.set(id, this.index++);
			this.stack.push(id);
			this.onStack.add(id);
			return {
				id,
				children: [...(this.children.get(id) ?? [])].sort(),
				childIndex: 0,
				lastChild: null,
			};
		};

		const callStack: Frame[] = [enter(startId)];
		while (callStack.length > 0) {
			const frame = callStack[callStack.length - 1];
			if (frame.lastChild !== null) {
				this.lower(frame.id, this.lowLinkById.get(frame.lastChild) ?? 0);
				frame.lastChild = null;
			}
			if (frame.childIndex < frame.children.length) {
				const child = frame.children[frame.childIndex++];
				if (!this.indexById.has(child)) {
					frame.lastChild = child;
					callStack.push(enter(child));
				} else if (this.onStack.has(child)) {
					this.lower(frame.id, this.indexById.get(child) ?? 0);
				}
			} else {
				callStack.pop();
				if (this.lowLinkById.get(frame.id) === this.indexById.get(frame.id)) {
					this.finishComponent(frame.id);
				}
			}
		}
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
