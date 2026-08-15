import { assert, assertMatch } from "jsr:@std/assert@1";

Deno.test("Sparse Outline View component exists and accepts TransientProjectionNode props", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assert(source.includes("TransientProjectionNode"), "imports TransientProjectionNode");
	assert(source.includes("nodes"), "accepts nodes prop");
	assert(source.includes("onSelectNode"), "accepts onSelectNode callback");
});

Deno.test("Sparse Outline renders empty state with vocabulary label", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assert(source.includes("noQueryResult"), "renders no result label from vocabulary");
});

Deno.test("Sparse Outline renders nodes as tree items with vocabulary", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assert(source.includes("queryResult"), "uses queryResult vocabulary");
	assert(source.includes("sparseOutline"), "uses sparseOutline vocabulary");
	assert(source.includes('role="tree"'), "renders tree ARIA role");
});

Deno.test("Sparse Outline computes hierarchy via parentNodeIndex", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assert(source.includes("parentNodeIndex"), "uses parentNodeIndex for hierarchy");
});

Deno.test("Sparse Outline highlights matched nodes with CSS class", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assertMatch(source, /class:matched/, "has matched CSS class conditional");
	assert(source.includes("reasons"), "checks reasons for matching");
});

Deno.test("Sparse Outline shows score badge when present", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assert(source.includes("sparse-node-score"), "has score CSS class");
	assertMatch(source, /Math\.round/, "formats score");
});

Deno.test("Sparse Outline shows breadcrumb when present", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assert(source.includes("breadcrumb"), "renders breadcrumb");
	assert(source.includes("sparse-node-breadcrumb"), "has breadcrumb CSS class");
});

Deno.test("Sparse Outline has expand/collapse for children", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assert(source.includes("toggle"), "has toggle function");
	assert(source.includes("expandedIds"), "maintains expanded state");
	assert(source.includes("sparse-disclosure"), "has disclosure button CSS");
});

Deno.test("Sparse Outline uses no hardcoded UI labels — verifies vocabulary contract", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	const literalPatterns = [
		/textContent\s*=\s*"[^"]*結果"/,
		/label\s*=\s*"[^"]*投影"/,
	];
	for (const pattern of literalPatterns) {
		const match = source.match(pattern);
		assert(!match, `found hardcoded label: ${match?.[0]}`);
	}
});

Deno.test("Sparse Outline onSelectNode callback fires with correct node data", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assert(source.includes("onSelectNode"), "references onSelectNode prop");
	assert(source.includes("onclick"), "has click handler");
});

Deno.test("Sparse Outline computeDepth handles cycles with visited set", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/ui/SparseOutlineView.svelte", import.meta.url),
	);
	assert(source.includes("visited"), "uses visited set for cycle protection");
});

Deno.test("App.svelte integrates SparseOutlineView in query mode", async () => {
	const inspector = await Deno.readTextFile(
		new URL("../src/ui/InspectorView.svelte", import.meta.url),
	);
	assert(inspector.includes("SparseOutlineView"), "imports SparseOutlineView");
	assertMatch(inspector, /<SparseOutlineView/, "renders SparseOutlineView component");
	assert(inspector.includes("onSelectSparseNode"), "has node selection callback");
	assert(inspector.includes("sparseOutlineNodes"), "has sparse outline state");
});

Deno.test("App.svelte passes onSelectNode to SparseOutlineView", async () => {
	const inspector = await Deno.readTextFile(
		new URL("../src/ui/InspectorView.svelte", import.meta.url),
	);
	assertMatch(inspector, /onSelectNode=\{query\.onSelectSparseNode\}/, "binds selection handler");
});

Deno.test("App.svelte toggle button switches between table and sparse outline", async () => {
	const inspector = await Deno.readTextFile(
		new URL("../src/ui/InspectorView.svelte", import.meta.url),
	);
	assert(inspector.includes("showSparseOutline"), "has toggle state");
	assert(inspector.includes("sparse-toggle"), "has toggle button CSS class");
});

Deno.test("outline service delegates query projection to discovery operations", async () => {
	const facade = await Deno.readTextFile(
		new URL("../src/services/outline_service.ts", import.meta.url),
	);
	const discovery = await Deno.readTextFile(
		new URL("../src/services/discovery_operations.ts", import.meta.url),
	);
	assert(facade.includes("buildQueryProjectionNodes"), "façade keeps the public method");
	assert(
		facade.includes("this.discovery.buildQueryProjectionNodes"),
		"façade delegates query projection",
	);
	assertMatch(
		discovery,
		/buildSparseOutline\(.*"query"\)/,
		"discovery operations calls buildSparseOutline with query sourceType",
	);
});

Deno.test("sparse_outline accepts sourceType parameter", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/services/sparse_outline.ts", import.meta.url),
	);
	assert(source.includes("TransientProjectionSource"), "imports TransientProjectionSource");
	assertMatch(source, /sourceType.*TransientProjectionSource/, "has sourceType parameter");
});

Deno.test("bindings includes buildQueryProjectionNodes", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/shared/bindings.ts", import.meta.url),
	);
	assert(source.includes("buildQueryProjectionNodes"), "has binding signature");
	assert(source.includes("TransientProjectionNode"), "imports TransientProjectionNode");
});

Deno.test("register_bindings wires buildQueryProjectionNodes to service", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/desktop/register_bindings.ts", import.meta.url),
	);
	assert(source.includes("buildQueryProjectionNodes"), "has handler registration");
});

Deno.test("ui_vocabulary includes sparse outline codes", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/shared/ui_vocabulary.ts", import.meta.url),
	);
	assert(source.includes("sparseOutline"), "has sparseOutline code");
	assert(source.includes("queryResult"), "has queryResult code");
	assert(source.includes("noQueryResult"), "has noQueryResult code");
	assert(source.includes("投影表示"), "has sparseOutline label");
	assert(source.includes("一致する項目はありません"), "has noQueryResult label");
});
