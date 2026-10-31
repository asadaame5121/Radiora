import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { DEFAULT_UI_VOCABULARY } from "../../../src/shared/ui_vocabulary.ts";

test("Sparse Outline View component exists and accepts TransientProjectionNode props", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(
		source.includes("TransientProjectionNode"),
		"imports TransientProjectionNode",
	).toBeTruthy();
	expect(source.includes("nodes"), "accepts nodes prop").toBeTruthy();
	expect(source.includes("onSelectNode"), "accepts onSelectNode callback").toBeTruthy();
});

test("Sparse Outline renders empty state with vocabulary label", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(source.includes("noQueryResult"), "renders no result label from vocabulary").toBeTruthy();
});

test("Sparse Outline renders nodes as tree items with vocabulary", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(source.includes("queryResult"), "uses queryResult vocabulary").toBeTruthy();
	expect(source.includes("sparseOutline"), "uses sparseOutline vocabulary").toBeTruthy();
	expect(source.includes('role="tree"'), "renders tree ARIA role").toBeTruthy();
});

test("Sparse Outline computes hierarchy via parentNodeIndex", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(source.includes("parentNodeIndex"), "uses parentNodeIndex for hierarchy").toBeTruthy();
});

test("Sparse Outline highlights matched nodes with CSS class", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(source, "has matched CSS class conditional").toMatch(/class:matched/);
	expect(source.includes("reasons"), "checks reasons for matching").toBeTruthy();
});

test("Sparse Outline shows score badge when present", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(source.includes("sparse-node-score"), "has score CSS class").toBeTruthy();
	expect(source, "formats score").toMatch(/Math\.round/);
});

test("Sparse Outline shows breadcrumb when present", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(source.includes("breadcrumb"), "renders breadcrumb").toBeTruthy();
	expect(source.includes("sparse-node-breadcrumb"), "has breadcrumb CSS class").toBeTruthy();
});

test("Sparse Outline has expand/collapse for children", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(source.includes("toggle"), "has toggle function").toBeTruthy();
	expect(source.includes("expandedIds"), "maintains expanded state").toBeTruthy();
	expect(source.includes("sparse-disclosure"), "has disclosure button CSS").toBeTruthy();
});

test("Sparse Outline uses no hardcoded UI labels — verifies vocabulary contract", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	const literalPatterns = [/textContent\s*=\s*"[^"]*結果"/, /label\s*=\s*"[^"]*投影"/];
	for (const pattern of literalPatterns) {
		const match = source.match(pattern);
		expect(!match, `found hardcoded label: ${match?.[0]}`).toBeTruthy();
	}
});

test("Sparse Outline onSelectNode callback fires with correct node data", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(source.includes("onSelectNode"), "references onSelectNode prop").toBeTruthy();
	expect(source.includes("onclick"), "has click handler").toBeTruthy();
});

test("Sparse Outline computeDepth handles cycles with visited set", async () => {
	const source = await readFile(
		new URL("../../../src/ui/SparseOutlineView.svelte", import.meta.url),
		"utf8",
	);
	expect(source.includes("visited"), "uses visited set for cycle protection").toBeTruthy();
});

test("deprecated Query panel retains SparseOutlineView for reevaluation", async () => {
	const inspector = await readFile(
		new URL("../../../src/ui/InspectorView.svelte", import.meta.url),
		"utf8",
	);
	const queryPanel = await readFile(
		new URL("../../../src/ui/InspectorQueryPanel.svelte", import.meta.url),
		"utf8",
	);
	expect(!inspector.includes("<InspectorQueryPanel")).toBeTruthy();
	expect(queryPanel.includes("SparseOutlineView"), "imports SparseOutlineView").toBeTruthy();
	expect(queryPanel, "renders SparseOutlineView component").toMatch(/<SparseOutlineView/);
	expect(queryPanel.includes("onSelectSparseNode"), "has node selection callback").toBeTruthy();
	expect(queryPanel.includes("sparseOutlineNodes"), "has sparse outline state").toBeTruthy();
});

test("App.svelte passes onSelectNode to SparseOutlineView", async () => {
	const queryPanel = await readFile(
		new URL("../../../src/ui/InspectorQueryPanel.svelte", import.meta.url),
		"utf8",
	);
	expect(queryPanel, "binds selection handler").toMatch(
		/onSelectNode=\{query\.onSelectSparseNode\}/,
	);
});

test("App.svelte toggle button switches between table and sparse outline", async () => {
	const queryPanel = await readFile(
		new URL("../../../src/ui/InspectorQueryPanel.svelte", import.meta.url),
		"utf8",
	);
	expect(queryPanel.includes("showSparseOutline"), "has toggle state").toBeTruthy();
	expect(queryPanel.includes("sparse-toggle"), "has toggle button CSS class").toBeTruthy();
});

test("outline service delegates query projection to discovery operations", async () => {
	const facade = await readFile(
		new URL("../../../src/services/outline_service.ts", import.meta.url),
		"utf8",
	);
	const discovery = await readFile(
		new URL("../../../src/services/discovery_operations.ts", import.meta.url),
		"utf8",
	);
	const ruleQuery = await readFile(
		new URL("../../../src/services/discovery_rule_query_operations.ts", import.meta.url),
		"utf8",
	);
	expect(
		facade.includes("buildQueryProjectionNodes"),
		"façade keeps the public method",
	).toBeTruthy();
	expect(
		facade.includes("this.discovery.buildQueryProjectionNodes"),
		"façade delegates query projection",
	).toBeTruthy();
	expect(
		discovery.includes("this.ruleQuery.buildQueryProjectionNodes"),
		"discovery delegates query projection",
	).toBeTruthy();
	expect(ruleQuery, "rule query operations calls buildSparseOutline with query sourceType").toMatch(
		/buildSparseOutline\(.*"query"\)/,
	);
});

test("sparse_outline accepts sourceType parameter", async () => {
	const source = await readFile(
		new URL("../../../src/services/sparse_outline.ts", import.meta.url),
		"utf8",
	);
	expect(
		source.includes("TransientProjectionSource"),
		"imports TransientProjectionSource",
	).toBeTruthy();
	expect(source, "has sourceType parameter").toMatch(/sourceType.*TransientProjectionSource/);
});

test("bindings includes buildQueryProjectionNodes", async () => {
	const source = await readFile(
		new URL("../../../src/shared/bindings.ts", import.meta.url),
		"utf8",
	);
	expect(source.includes("buildQueryProjectionNodes"), "has binding signature").toBeTruthy();
	expect(
		source.includes("TransientProjectionNode"),
		"imports TransientProjectionNode",
	).toBeTruthy();
});

test("register_bindings wires buildQueryProjectionNodes to service", async () => {
	const source = await readFile(
		new URL("../../../src/desktop/register_bindings.ts", import.meta.url),
		"utf8",
	);
	expect(source.includes("buildQueryProjectionNodes"), "has handler registration").toBeTruthy();
});

test("ui_vocabulary includes sparse outline codes", async () => {
	const source = await readFile(
		new URL("../../../src/shared/ui_vocabulary.ts", import.meta.url),
		"utf8",
	);
	expect(source.includes("sparseOutline"), "has sparseOutline code").toBeTruthy();
	expect(source.includes("queryResult"), "has queryResult code").toBeTruthy();
	expect(source.includes("noQueryResult"), "has noQueryResult code").toBeTruthy();
	expect(
		DEFAULT_UI_VOCABULARY.sparseOutline === "文脈付き表示",
		"has sparseOutline label",
	).toBeTruthy();
	expect(source.includes("一致するメモはありません"), "has noQueryResult label").toBeTruthy();
});
