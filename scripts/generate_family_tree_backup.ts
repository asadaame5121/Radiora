import type {
	Branch,
	Occurrence,
	OutlineLink,
	RelationTypeDefinition,
	Revision,
	Work,
	WorkingCopy,
} from "../src/domain/models.ts";
import { BUILT_IN_RELATION_TYPES } from "../src/domain/relation_type.ts";
import type { JsonBackupV7 } from "../src/services/json_backup.ts";
import { APP_VERSION } from "../src/shared/app_version.ts";

export interface PersonNodeSpec {
	id: string;
	title: string;
	body: string;
	parentId: string | null;
}

export interface FamilyLinkSpec {
	id: string;
	fromId: string;
	toId: string;
	type: string;
}

export interface CustomRelationSpec {
	name: string;
	direction: "directed" | "symmetric";
	advancesGeneration?: boolean;
}

const BASE_TIMESTAMP = "2026-09-01T00:00:00.000Z";
const ORDER_KEY_INTERVAL = 1024;

function buildNodeEntities(nodes: readonly PersonNodeSpec[]) {
	const works: Work[] = [];
	const branches: Branch[] = [];
	const workingCopies: WorkingCopy[] = [];
	const revisions: Revision[] = [];
	const occurrences: Occurrence[] = [];

	nodes.forEach((node, index) => {
		const workId = node.id;
		const branchId = `${workId}-main`;
		const revisionId = `${workId}-rev-1`;
		const occurrenceId = `${workId}-occ`;
		const fullText = `${node.title}\n\n${node.body}`;

		works.push({ id: workId, createdAt: BASE_TIMESTAMP, updatedAt: BASE_TIMESTAMP });
		branches.push({
			id: branchId,
			workId,
			name: "main",
			headRevisionId: revisionId,
			createdAt: BASE_TIMESTAMP,
		});
		workingCopies.push({ branchId, workId, text: fullText, updatedAt: BASE_TIMESTAMP });
		revisions.push({
			id: revisionId,
			workId,
			text: fullText,
			parentRevisionIds: [],
			kind: "edition",
			createdAt: BASE_TIMESTAMP,
		});
		occurrences.push({
			id: occurrenceId,
			workId,
			parentOccurrenceId: node.parentId ? `${node.parentId}-occ` : null,
			orderKey: (index + 1) * ORDER_KEY_INTERVAL,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId },
		});
	});

	return { works, branches, workingCopies, revisions, occurrences };
}

function buildRelationDefinitions(
	customRelations: readonly CustomRelationSpec[],
): RelationTypeDefinition[] {
	return [
		...BUILT_IN_RELATION_TYPES.map((def) => ({ ...def })),
		...customRelations.map((cr) => ({
			name: cr.name,
			direction: cr.direction,
			...(cr.advancesGeneration !== undefined ? { advancesGeneration: cr.advancesGeneration } : {}),
			builtIn: false,
			createdAt: BASE_TIMESTAMP,
		})),
	];
}

export function buildGraphFromSpecs(
	nodes: readonly PersonNodeSpec[],
	links: readonly FamilyLinkSpec[],
	customRelations: readonly CustomRelationSpec[],
): JsonBackupV7 {
	const { works, branches, workingCopies, revisions, occurrences } = buildNodeEntities(nodes);

	const outlineLinks: OutlineLink[] = links.map((link) => ({
		id: link.id,
		fromId: link.fromId,
		toId: link.toId,
		from: { scope: "work", workId: link.fromId },
		to: { scope: "work", workId: link.toId },
		type: link.type,
		status: "asserted",
		origin: "human",
		createdAt: BASE_TIMESTAMP,
	}));

	return {
		format: "radiora-backup",
		schemaVersion: 7,
		exportedAt: BASE_TIMESTAMP,
		appVersion: APP_VERSION,
		source: { storageSchemaVersion: 7 },
		data: {
			works,
			branches,
			workingCopies,
			occurrences,
			links: outlineLinks,
			systemRelations: [],
			knots: [],
			aliases: [],
			emergenceFeedback: {},
			emergenceSuggestions: [],
			savedRuleQueries: [],
			purgeManifests: [],
			revisions,
			recoverySnapshots: [],
			bookmarks: [],
			resumePosition: null,
			relationTypeDefinitions: buildRelationDefinitions(customRelations),
		},
	};
}

const SAZAE_CUSTOM_RELATIONS: readonly CustomRelationSpec[] = [
	{ name: "SPOUSE", direction: "symmetric" },
	{ name: "FATHER_OF", direction: "directed", advancesGeneration: true },
	{ name: "MOTHER_OF", direction: "directed", advancesGeneration: true },
	{ name: "SIBLING", direction: "symmetric" },
	{ name: "COUSIN", direction: "symmetric" },
];

const SAZAE_NODES: readonly PersonNodeSpec[] = [
	{
		id: "group-isono",
		title: "磯野家",
		body: "世田谷区桜新町在住の磯野家一族。",
		parentId: null,
	},
	{
		id: "person-namihei",
		title: "磯野波平",
		body: "磯野家の大黒柱。山高商事の課長。頑固だが情に厚い。フネの夫。",
		parentId: "group-isono",
	},
	{
		id: "person-fune",
		title: "磯野フネ",
		body: "波平の妻。物静かで家族を温かく見守る良妻賢母。",
		parentId: "group-isono",
	},
	{
		id: "person-umihei",
		title: "磯野海平",
		body: "波平の双子の兄。福岡在住。波平との見分け方は頭頂部の髪の毛（2本）。",
		parentId: "group-isono",
	},
	{
		id: "person-katsuo",
		title: "磯野カツオ",
		body: "磯野家の長男。小学5年3組。いたずら好きでお調子者だが機転が利く。",
		parentId: "group-isono",
	},
	{
		id: "person-wakame",
		title: "磯野ワカメ",
		body: "磯野家の次女。小学3年1組。真面目で心優しい少女。",
		parentId: "group-isono",
	},
	{
		id: "group-fuguta",
		title: "フグ田家",
		body: "磯野家に同居するサザエ・マスオ・タラオの一家。",
		parentId: null,
	},
	{
		id: "person-sazae",
		title: "フグ田サザエ",
		body: "本作の主人公。波平とフネの長女。マスオの妻、タラオの母。明るく行動的。",
		parentId: "group-fuguta",
	},
	{
		id: "person-masuo",
		title: "フグ田マスオ",
		body: "サザエの夫。海山商事勤務。誠実で優しく、義理の実家でも円満に暮らす。",
		parentId: "group-fuguta",
	},
	{
		id: "person-tarao",
		title: "フグ田タラオ",
		body: "サザエとマスオの長男。3歳。好奇心旺盛で礼儀正しい。",
		parentId: "group-fuguta",
	},
	{
		id: "group-namino",
		title: "波野家",
		body: "波平の甥であるノリスケの一家。",
		parentId: null,
	},
	{
		id: "person-norisuke",
		title: "波野ノリスケ",
		body: "波平・海平の妹なぎえの息子（甥）。出版社勤務。明るく図々しい愛されキャラ。",
		parentId: "group-namino",
	},
	{
		id: "person-taiko",
		title: "波野タイコ",
		body: "ノリスケの妻。上品でしっかり者。サザエとも仲が良い。",
		parentId: "group-namino",
	},
	{
		id: "person-ikura",
		title: "波野イクラ",
		body: "ノリスケとタイコの長男。タラオのいとこ甥（はとこ）。「ハーイ」「チャーン」「バブー」。",
		parentId: "group-namino",
	},
];

const SAZAE_LINKS: readonly FamilyLinkSpec[] = [
	{ id: "link-sp-namihei-fune", fromId: "person-namihei", toId: "person-fune", type: "SPOUSE" },
	{ id: "link-sp-sazae-masuo", fromId: "person-sazae", toId: "person-masuo", type: "SPOUSE" },
	{ id: "link-sp-norisuke-taiko", fromId: "person-norisuke", toId: "person-taiko", type: "SPOUSE" },
	{
		id: "link-fo-namihei-sazae",
		fromId: "person-namihei",
		toId: "person-sazae",
		type: "FATHER_OF",
	},
	{
		id: "link-fo-namihei-katsuo",
		fromId: "person-namihei",
		toId: "person-katsuo",
		type: "FATHER_OF",
	},
	{
		id: "link-fo-namihei-wakame",
		fromId: "person-namihei",
		toId: "person-wakame",
		type: "FATHER_OF",
	},
	{ id: "link-fo-masuo-tarao", fromId: "person-masuo", toId: "person-tarao", type: "FATHER_OF" },
	{
		id: "link-fo-norisuke-ikura",
		fromId: "person-norisuke",
		toId: "person-ikura",
		type: "FATHER_OF",
	},
	{ id: "link-mo-fune-sazae", fromId: "person-fune", toId: "person-sazae", type: "MOTHER_OF" },
	{ id: "link-mo-fune-katsuo", fromId: "person-fune", toId: "person-katsuo", type: "MOTHER_OF" },
	{ id: "link-mo-fune-wakame", fromId: "person-fune", toId: "person-wakame", type: "MOTHER_OF" },
	{ id: "link-mo-sazae-tarao", fromId: "person-sazae", toId: "person-tarao", type: "MOTHER_OF" },
	{ id: "link-mo-taiko-ikura", fromId: "person-taiko", toId: "person-ikura", type: "MOTHER_OF" },
	{
		id: "link-sb-namihei-umihei",
		fromId: "person-namihei",
		toId: "person-umihei",
		type: "SIBLING",
	},
	{ id: "link-sb-sazae-katsuo", fromId: "person-sazae", toId: "person-katsuo", type: "SIBLING" },
	{ id: "link-sb-sazae-wakame", fromId: "person-sazae", toId: "person-wakame", type: "SIBLING" },
	{ id: "link-sb-katsuo-wakame", fromId: "person-katsuo", toId: "person-wakame", type: "SIBLING" },
	{ id: "link-cs-sazae-norisuke", fromId: "person-sazae", toId: "person-norisuke", type: "COUSIN" },
	{
		id: "link-cs-katsuo-norisuke",
		fromId: "person-katsuo",
		toId: "person-norisuke",
		type: "COUSIN",
	},
	{
		id: "link-cs-wakame-norisuke",
		fromId: "person-wakame",
		toId: "person-norisuke",
		type: "COUSIN",
	},
	{ id: "link-cs-tarao-ikura", fromId: "person-tarao", toId: "person-ikura", type: "COUSIN" },
];

export function buildSazaeSanFamilyTreeBackup(): JsonBackupV7 {
	return buildGraphFromSpecs(SAZAE_NODES, SAZAE_LINKS, SAZAE_CUSTOM_RELATIONS);
}

const MAKOTO_CUSTOM_RELATIONS: readonly CustomRelationSpec[] = [
	{ name: "FATHER_OF", direction: "directed", advancesGeneration: true },
	{ name: "MOTHER_OF", direction: "directed", advancesGeneration: true },
	{ name: "COUSIN", direction: "symmetric" },
	{ name: "ROMANTIC_RELATION", direction: "symmetric" },
];

const MAKOTO_NODES: readonly PersonNodeSpec[] = [
	{
		id: "group-overflow",
		title: "沢越家・伊藤家系譜",
		body: "Overflow作品群の壮絶な血縁グラフ。",
		parentId: null,
	},
	{
		id: "person-tomaru",
		title: "沢越止",
		body: "すべての元凶。数多くの女性との間に子孫を残した始祖的存在。",
		parentId: "group-overflow",
	},
	{
		id: "person-moeka",
		title: "伊能萌香",
		body: "止の娘であり、止のパートナーの一人。",
		parentId: "group-overflow",
	},
	{
		id: "person-odoriko",
		title: "西園寺踊子",
		body: "止の娘。世界の母。",
		parentId: "group-overflow",
	},
	{
		id: "person-manami",
		title: "桂真奈美",
		body: "止の娘。言葉と心の母。",
		parentId: "group-overflow",
	},
	{
		id: "person-shun",
		title: "間瞬",
		body: "止の息子。踊子との間に世界をもうける。",
		parentId: "group-overflow",
	},
	{
		id: "person-chiho",
		title: "伊藤智歩",
		body: "止の娘。止との間に誠と止をもうける。",
		parentId: "group-overflow",
	},
	{
		id: "person-makoto",
		title: "伊藤誠",
		body: "『School Days』主人公。沢越止と伊藤智歩の息子。止は父であり祖父。",
		parentId: "group-overflow",
	},
	{
		id: "person-sekai",
		title: "西園寺世界",
		body: "『School Days』ヒロイン。間瞬と西園寺踊子の娘。誠とはいとこかつ叔父と姪。",
		parentId: "group-overflow",
	},
	{
		id: "person-kotonoha",
		title: "桂言葉",
		body: "『School Days』メインヒロイン。桂真奈美の長女。誠とは異母姉妹の血を引く。",
		parentId: "group-overflow",
	},
	{
		id: "person-setsuna",
		title: "清浦刹那",
		body: "世界の親友でいとこ（母の舞が踊子の妹）。誠に想いを寄せる。",
		parentId: "group-overflow",
	},
];

const MAKOTO_LINKS: readonly FamilyLinkSpec[] = [
	{ id: "link-fo-tomaru-chiho", fromId: "person-tomaru", toId: "person-chiho", type: "FATHER_OF" },
	{
		id: "link-fo-tomaru-odoriko",
		fromId: "person-tomaru",
		toId: "person-odoriko",
		type: "FATHER_OF",
	},
	{
		id: "link-fo-tomaru-manami",
		fromId: "person-tomaru",
		toId: "person-manami",
		type: "FATHER_OF",
	},
	{ id: "link-fo-tomaru-shun", fromId: "person-tomaru", toId: "person-shun", type: "FATHER_OF" },
	{
		id: "link-fo-tomaru-makoto",
		fromId: "person-tomaru",
		toId: "person-makoto",
		type: "FATHER_OF",
	},
	{ id: "link-fo-shun-sekai", fromId: "person-shun", toId: "person-sekai", type: "FATHER_OF" },
	{ id: "link-mo-chiho-makoto", fromId: "person-chiho", toId: "person-makoto", type: "MOTHER_OF" },
	{
		id: "link-mo-odoriko-sekai",
		fromId: "person-odoriko",
		toId: "person-sekai",
		type: "MOTHER_OF",
	},
	{
		id: "link-mo-manami-kotonoha",
		fromId: "person-manami",
		toId: "person-kotonoha",
		type: "MOTHER_OF",
	},
	{ id: "link-cs-makoto-sekai", fromId: "person-makoto", toId: "person-sekai", type: "COUSIN" },
	{ id: "link-cs-sekai-setsuna", fromId: "person-sekai", toId: "person-setsuna", type: "COUSIN" },
	{
		id: "link-rd-makoto-sekai",
		fromId: "person-makoto",
		toId: "person-sekai",
		type: "ROMANTIC_RELATION",
	},
	{
		id: "link-rd-makoto-kotonoha",
		fromId: "person-makoto",
		toId: "person-kotonoha",
		type: "ROMANTIC_RELATION",
	},
	{
		id: "link-rd-makoto-setsuna",
		fromId: "person-makoto",
		toId: "person-setsuna",
		type: "ROMANTIC_RELATION",
	},
];

export function buildItoMakotoFamilyTreeBackup(): JsonBackupV7 {
	return buildGraphFromSpecs(MAKOTO_NODES, MAKOTO_LINKS, MAKOTO_CUSTOM_RELATIONS);
}

if (import.meta.main) {
	const sazae = buildSazaeSanFamilyTreeBackup();
	const sazaeJson = JSON.stringify(sazae, null, 2);
	await Deno.writeTextFile("dummy_sazae_san_family_tree.json", sazaeJson);
	console.log("Generated dummy_sazae_san_family_tree.json successfully.");

	const makoto = buildItoMakotoFamilyTreeBackup();
	const makotoJson = JSON.stringify(makoto, null, 2);
	await Deno.writeTextFile("dummy_ito_makoto_family_tree.json", makotoJson);
	console.log("Generated dummy_ito_makoto_family_tree.json successfully.");
}
