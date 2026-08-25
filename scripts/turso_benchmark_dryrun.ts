import { assert, assertEquals } from "jsr:@std/assert@1";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import { graphStateHash, migrateLegacyStorageToTurso } from "../src/storage/turso_migration.ts";
import { TursoGraphStore } from "../src/storage/turso_store.ts";

const CREATED_AT = "2026-07-28T00:00:00.000Z";
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const DECIMAL_PLACES = 2;
const ORDER_KEY_GAP = 1024;
const PARENT_BRANCHING_FACTOR = 5;
const LINK_INTERVAL = 3;
const KNOT_INTERVAL = 50;
const SECTION_HEADING_INTERVAL = 10;
const SAMPLE_CARET_OFFSET = 42;

interface NodeData {
	workId: string;
	branchId: string;
	occId: string;
}

interface BenchmarkPaths {
	source: string;
	sourceVersion: string;
	backupRoot: string;
	target: string;
	marker: string;
}

function buildNodes(itemCount: number): NodeData[] {
	return Array.from({ length: itemCount }, () => ({
		workId: crypto.randomUUID(),
		branchId: crypto.randomUUID(),
		occId: crypto.randomUUID(),
	}));
}

function buildOccurrences(nodes: NodeData[]): GraphStateSnapshot["occurrences"] {
	return nodes.map((node, i) => {
		const parentId = i > 0 && i % PARENT_BRANCHING_FACTOR !== 0 ? nodes[i - 1].occId : null;
		return {
			id: node.occId,
			workId: node.workId,
			parentOccurrenceId: parentId,
			orderKey: (i + 1) * ORDER_KEY_GAP,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: node.branchId },
			contextualHeading: i % SECTION_HEADING_INTERVAL === 0
				? `見出しセクション ${i / SECTION_HEADING_INTERVAL}`
				: undefined,
		};
	});
}

function buildLinks(nodes: NodeData[]): GraphStateSnapshot["links"] {
	const links: GraphStateSnapshot["links"] = [];
	for (let i = LINK_INTERVAL; i < nodes.length; i += LINK_INTERVAL) {
		const targetWorkId = nodes[i - LINK_INTERVAL].workId;
		links.push({
			id: crypto.randomUUID(),
			fromId: nodes[i].workId,
			toId: targetWorkId,
			from: { scope: "work", workId: nodes[i].workId },
			to: { scope: "work", workId: targetWorkId },
			type: "RELATED",
			status: "asserted",
			origin: "human",
			createdAt: CREATED_AT,
		});
	}
	return links;
}

function buildKnots(nodes: NodeData[]): GraphStateSnapshot["knots"] {
	const knots: GraphStateSnapshot["knots"] = [];
	for (let i = KNOT_INTERVAL; i < nodes.length; i += KNOT_INTERVAL) {
		knots.push({
			id: crypto.randomUUID(),
			cycleIds: [nodes[i - 1].occId, nodes[i].occId],
			createdAt: CREATED_AT,
		});
	}
	return knots;
}

function generateLargeSnapshot(itemCount: number): GraphStateSnapshot {
	const nodes = buildNodes(itemCount);
	const works: GraphStateSnapshot["works"] = nodes.map((n) => ({
		id: n.workId,
		createdAt: CREATED_AT,
		updatedAt: CREATED_AT,
	}));
	const branches: GraphStateSnapshot["branches"] = nodes.map((n) => ({
		id: n.branchId,
		workId: n.workId,
		name: "main",
		headRevisionId: null,
		createdAt: CREATED_AT,
	}));
	const workingCopies: GraphStateSnapshot["workingCopies"] = nodes.map((n, i) => ({
		branchId: n.branchId,
		workId: n.workId,
		text: `項目 #${i}: これはRadioraのTurso移行ベンチマーク用の日本語テキストです。\n` +
			`複数行のMarkdown文書と [[関連リンク#${i}]] を含みます。\n` +
			`特殊文字: 𠮷野家, 🍣, 漢字, カタカナ, ひらがな, English words.`,
		updatedAt: CREATED_AT,
	}));

	return {
		works,
		branches,
		workingCopies,
		occurrences: buildOccurrences(nodes),
		links: buildLinks(nodes),
		systemRelations: [],
		knots: buildKnots(nodes),
		aliases: [{
			id: crypto.randomUUID(),
			canonical: "ベンチマーク用語",
			variants: ["ベンチ1", "ベンチ2"],
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
		}],
		emergenceFeedback: {},
		emergenceSuggestions: [],
		savedRuleQueries: [],
		purgeManifests: [],
		revisions: [],
		recoverySnapshots: [],
		bookmarks: [{
			id: crypto.randomUUID(),
			workId: nodes[0].workId,
			occurrenceId: nodes[0].occId,
			createdAt: CREATED_AT,
		}],
		resumePosition: {
			workId: nodes[0].workId,
			occurrenceId: nodes[0].occId,
			caretOffset: SAMPLE_CARET_OFFSET,
			updatedAt: CREATED_AT,
		},
	};
}

async function verifyReopenedQueries(target: string): Promise<void> {
	const queryStart = performance.now();
	const store = new TursoGraphStore(target);
	await store.initialize();
	const items = await store.listItems();
	const links = await store.listLinks();
	const queryEnd = performance.now();
	console.log(`5. Reopened query test: ${(queryEnd - queryStart).toFixed(DECIMAL_PLACES)} ms`);
	console.log(`   - Loaded items: ${items.length}, links: ${links.length}`);
	await store.close();
}

async function executeMigrationBenchmark(
	paths: BenchmarkPaths,
	snapshot: GraphStateSnapshot,
	expectedHash: string,
): Promise<void> {
	const memBefore = Deno.memoryUsage();
	const migStart = performance.now();
	const result = await migrateLegacyStorageToTurso({
		sourcePath: paths.source,
		sourceVersionMarkerPath: paths.sourceVersion,
		backupRoot: paths.backupRoot,
		targetPath: paths.target,
		markerPath: paths.marker,
		exportSnapshot: () => Promise.resolve(snapshot),
	});
	const migEnd = performance.now();
	const memAfter = Deno.memoryUsage();

	assert(result);
	assertEquals(result.snapshotHash, expectedHash);
	console.log(`3. Total migration time: ${(migEnd - migStart).toFixed(DECIMAL_PLACES)} ms`);
	console.log(
		`   - Memory delta (heapUsed): ${
			((memAfter.heapUsed - memBefore.heapUsed) / BYTES_PER_MB).toFixed(DECIMAL_PLACES)
		} MB`,
	);

	const stat = await Deno.stat(paths.target);
	console.log(
		`4. Turso SQLite DB file size: ${(stat.size / BYTES_PER_KB).toFixed(DECIMAL_PLACES)} KB`,
	);
	await verifyReopenedQueries(paths.target);
}

async function runDryRunBenchmark() {
	const ITEM_COUNT = 1000;
	console.log(`\n=== Radiora Turso Migration Dry-Run Benchmark (${ITEM_COUNT} nodes) ===\n`);

	const root = await Deno.makeTempDir({ prefix: "radiora-turso-benchmark-" });
	const paths: BenchmarkPaths = {
		source: `${root}\\surreal`,
		sourceVersion: `${root}\\surreal\\storage-schema-version`,
		backupRoot: `${root}\\backups`,
		target: `${root}\\turso\\radiora.db`,
		marker: `${root}\\turso\\radiora.db.migration.json`,
	};

	await Deno.mkdir(paths.source, { recursive: true });
	await Deno.writeTextFile(`${paths.source}\\CURRENT`, "benchmark-surreal-v6");
	await Deno.writeTextFile(paths.sourceVersion, "6\n");

	const genStart = performance.now();
	const snapshot = generateLargeSnapshot(ITEM_COUNT);
	const genEnd = performance.now();
	console.log(`1. Fixture generation: ${(genEnd - genStart).toFixed(DECIMAL_PLACES)} ms`);

	const hashStart = performance.now();
	const expectedHash = await graphStateHash(snapshot);
	const hashEnd = performance.now();
	console.log(
		`2. Baseline SHA-256 canonical hash: ${(hashEnd - hashStart).toFixed(DECIMAL_PLACES)} ms`,
	);

	try {
		await executeMigrationBenchmark(paths, snapshot, expectedHash);
		console.log(`\n=== Dry-Run Benchmark Completed Successfully ===\n`);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
}

await runDryRunBenchmark();
