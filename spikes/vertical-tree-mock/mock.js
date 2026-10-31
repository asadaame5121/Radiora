"use strict";

// shortcut: four fixed Topic cards with measured generation rows; use Svelte Flow/ELK for the product.
const topics = [
  { id: "t01", number: "01", generation: 0, column: 0, title: "知識を育てる", aliases: ["Knowledge gardening", "思考の庭"], description: "書き留めた断片が、文書になり、つながりから次の考えが生まれる。", rows: [
    { id: "a1", text: "断片を、まず書き留める", depth: 0 },
    { id: "a2", text: "考えを構造で整理する", depth: 0 },
    { id: "a3", text: "アウトラインが文書をつくる", depth: 1 },
    { id: "a4", text: "関係から、新しい視点が生まれる", depth: 0 }
  ] },
  { id: "t02", number: "02", generation: 1, column: -1, title: "アウトラインという思考", aliases: ["Outliner", "階層で考える"], description: "文書の内側を整える。階層を動かしても、思考のつながりは書き換えない。", rows: [
    { id: "b1", text: "階層は、文書の内側にある", depth: 0 },
    { id: "b2", text: "考えを少しずつ深くする", depth: 1 },
    { id: "b3", text: "一つのBlockが、参照の単位になる", depth: 0 },
    { id: "b4", text: "知識を育てる", depth: 0, reference: "t01" }
  ] },
  { id: "t03", number: "03", generation: 1, column: 1, title: "つながりとしての知識", aliases: ["Networked thought", "Relation"], description: "派生、類似、修正、対比。文書を結ぶ線には、それぞれの意味がある。", rows: [
    { id: "c1", text: "一つの考えは、複数の源を持つ", depth: 0 },
    { id: "c2", text: "FROMは、派生を表す", depth: 0 },
    { id: "c3", text: "LIKE・FIX・VSで意味を添える", depth: 0 }
  ] },
  { id: "t04", number: "04", generation: 2, column: 0, title: "文書と関係を分ける", aliases: ["Two structures", "構造の分離"], description: "二つの考えから生まれた、一つの文書。内側はアウトライン、外側は系譜。", rows: [
    { id: "d1", text: "文書の中では、自由に組み立てる", depth: 0 },
    { id: "d2", text: "文書の間では、関係をたどる", depth: 0 }
  ] }
];
const relations = [
  { source: "t01", target: "t02", type: "FROM" }, { source: "t01", target: "t03", type: "FROM" },
  { source: "t02", target: "t04", type: "FROM" }, { source: "t03", target: "t04", type: "FROM" },
  { source: "t02", target: "t03", type: "LIKE" }, { source: "t01", target: "t04", type: "FIX" },
  { source: "t02", target: "t03", type: "VS" }
];
const byId = new Map(topics.map((topic) => [topic.id, topic]));
const $ = (id) => document.getElementById(id);
const canvas = $("canvas"), world = $("world");
const camera = { x: 0, y: 0, zoom: 1 };
let selected = "t02", activeRow = null, editing = null, composing = false, layoutFrame = 0, initialized = false, rowSequence = 0, drag = null;
let bounds = { x: 0, y: 0, width: 1, height: 1 };
function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function normalize(text) { return text.normalize("NFKC").toLowerCase().trim(); }
function titleOf(topic) { return topic.title.split("\n").find((line) => line.trim()) || "無題"; }
function status(text) { $("status").textContent = text; }
function matched(topic) { const q = normalize($("search").value); return !q || [topic.title, ...topic.aliases].some((text) => normalize(text).includes(q)); }
function applyCamera() {
  world.style.transform = "translate(" + camera.x + "px," + camera.y + "px) scale(" + camera.zoom + ")";
  $("zoom-label").textContent = Math.round(camera.zoom * 100) + "%";
}
function zoomTo(next, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
  const scale = Math.max(.3, Math.min(1.8, next));
  camera.x = x - (x - camera.x) * scale / camera.zoom; camera.y = y - (y - camera.y) * scale / camera.zoom; camera.zoom = scale; applyCamera();
}
function fitView() {
  if (!canvas.clientWidth || !canvas.clientHeight) return;
  camera.zoom = Math.max(.1, Math.min(1.12, (canvas.clientWidth - 90) / bounds.width, (canvas.clientHeight - 140) / bounds.height));
  camera.x = (canvas.clientWidth - bounds.width * camera.zoom) / 2 - bounds.x * camera.zoom;
  camera.y = 62 + (canvas.clientHeight - 126 - bounds.height * camera.zoom) / 2 - bounds.y * camera.zoom;
  applyCamera();
}
function reveal() { const t = byId.get(selected); camera.x = canvas.clientWidth / 2 - (t.x + 170) * camera.zoom; camera.y = canvas.clientHeight / 2 - (t.y + t.height / 2) * camera.zoom; applyCamera(); }
function renderSidebar() {
  $("topic-list").replaceChildren();
  const found = topics.filter(matched);
  for (const topic of found) { const button = element("button", "mock-topic-button" + (selected === topic.id ? " selected" : ""), titleOf(topic)); button.type = "button"; button.dataset.topic = topic.id; button.setAttribute("aria-pressed", String(selected === topic.id)); button.onclick = () => { selectTopic(topic.id); reveal(); }; $("topic-list").append(button); }
  $("topic-count").textContent = String(found.length); $("search-empty").hidden = found.length > 0;
  for (const topic of topics) topic.card.classList.toggle("search-dimmed", !matched(topic));
}
function renderInspector() {
  const topic = byId.get(selected);
  $("detail-title").textContent = titleOf(topic); $("detail-description").textContent = topic.description;
  $("detail-aliases").replaceChildren(...topic.aliases.map((alias) => element("span", "", alias)));
  $("detail-relations").replaceChildren();
  for (const relation of relations.filter((r) => r.type === "FROM" && (r.source === selected || r.target === selected))) {
    const other = byId.get(relation.source === selected ? relation.target : relation.source);
    const row = element("div", "mock-detail-relation"), label = element("span", "", relation.source === selected ? "派生先" : "派生元"), button = element("button", "", titleOf(other));
    button.type = "button"; button.onclick = () => { selectTopic(other.id); reveal(); }; row.append(label, button); $("detail-relations").append(row);
  }
  $("detail-outline").replaceChildren(...topic.rows.map((row) => { const el = element("div", "", (row.reference ? "↗ " : "· ") + (row.text || "空のBlock")); el.style.setProperty("--depth", row.depth); return el; }));
  $("collapse-card").textContent = topic.collapsed ? "カードを開く" : "カードを閉じる";
  $("stats").textContent = topics.length + " Topics  ·  " + topics.reduce((sum, t) => sum + t.rows.length + 1, 0) + " Blocks  ·  4 FROM";
}
function selectTopic(id, rowId = null) {
  if (editing && (editing.topic.id !== id || editing.row?.id !== rowId)) finishEdit();
  selected = id; activeRow = rowId;
  for (const topic of topics) { topic.card.classList.toggle("selected", topic.id === id); for (const row of topic.card.querySelectorAll(".mock-row")) row.classList.toggle("active", topic.id === id && row.dataset.block === rowId); }
  renderSidebar(); renderInspector(); drawEdges();
}
function subtreeEnd(topic, index) { let end = index + 1; while (end < topic.rows.length && topic.rows[end].depth > topic.rows[index].depth) end++; return end; }
function mountRows(topic) {
  const body = topic.body; body.replaceChildren(); body.hidden = !!topic.collapsed;
  let hiddenBelow = null;
  topic.rows.forEach((row, index) => {
    if (hiddenBelow !== null && row.depth > hiddenBelow) return;
    hiddenBelow = null;
    const wrapper = element("div", "mock-row" + (row.reference ? " reference" : "") + (selected === topic.id && activeRow === row.id ? " active" : ""));
    wrapper.dataset.block = row.id; wrapper.style.setProperty("--depth", row.depth);
    const hasChildren = topic.rows[index + 1]?.depth > row.depth;
    if (hasChildren) {
      const fold = element("button", "mock-fold", row.folded ? "▸" : "▾"); fold.type = "button"; fold.setAttribute("aria-label", row.folded ? "子Blockを展開" : "子Blockを折りたたむ"); fold.setAttribute("aria-expanded", String(!row.folded));
      fold.onclick = () => { if (composing) return; finishEdit(); row.folded = !row.folded; mountRows(topic); scheduleLayout(); };
      wrapper.append(fold);
    } else wrapper.append(element("span", "mock-bullet", row.reference ? "↗" : "·"));
    const text = element("button", "mock-row-text", row.text || "空のBlock"); text.type = "button";
    text.onclick = () => row.reference ? (selectTopic(row.reference), reveal(), status("代表のTopicへ移動しました")) : selectTopic(topic.id, row.id);
    text.ondblclick = () => { if (!row.reference) startEdit(topic, row); };
    text.onkeydown = (event) => { if (event.key === "Enter" && !row.reference) { event.preventDefault(); startEdit(topic, row); } };
    wrapper.append(text); body.append(wrapper);
    if (hasChildren && row.folded) hiddenBelow = row.depth;
  });
  topic.count.textContent = topic.rows.length + " Blocks"; topic.collapse.textContent = topic.collapsed ? "＋" : "−";
  topic.collapse.setAttribute("aria-label", topic.collapsed ? "カードを開く" : "カードを閉じる"); topic.collapse.setAttribute("aria-expanded", String(!topic.collapsed));
}
function finishEdit() {
  if (!editing) return;
  const previous = editing; editing = null; composing = false;
  if (previous.row) mountRows(previous.topic); else previous.topic.heading.textContent = titleOf(previous.topic);
  renderSidebar(); renderInspector(); scheduleLayout();
}
function startEdit(topic, row = null) {
  if (row?.reference || composing) return;
  if (editing?.topic === topic && editing.row === row) { editing.input.focus(); return; }
  finishEdit(); selected = topic.id; activeRow = row?.id || null;
  if (row) {
    topic.collapsed = false;
    let depth = row.depth;
    for (let index = topic.rows.indexOf(row) - 1; index >= 0 && depth > 0; index--) {
      const ancestor = topic.rows[index];
      if (ancestor.depth < depth) { ancestor.folded = false; depth = ancestor.depth; }
    }
    mountRows(topic);
  }
  selectTopic(topic.id, row?.id || null);
  const container = row ? topic.body.querySelector('[data-block="' + row.id + '"] .mock-row-text') : topic.heading;
  const input = element("textarea", "mock-inline-editor" + (row ? "" : " mock-title-editor"));
  input.setAttribute("aria-label", row ? "Block本文を編集" : "Topicタイトルを編集"); input.rows = 1; input.value = row ? row.text : topic.title;
  const resize = () => { input.style.height = "0px"; input.style.height = Math.max(28, input.scrollHeight + 2) + "px"; if (!composing) scheduleLayout(); };
  editing = { topic, row, input };
  if (row) container.replaceWith(input); else container.replaceChildren(input);
  input.oninput = () => { if (row) row.text = input.value; else topic.title = input.value; resize(); renderSidebar(); renderInspector(); status("モック内で編集中 · 再読込すると元に戻ります"); };
  input.oncompositionstart = () => { composing = true; }; input.oncompositionend = () => { composing = false; resize(); };
  input.onblur = () => { if (editing?.input === input && !composing) finishEdit(); };
  input.onkeydown = (event) => {
    event.stopPropagation(); if (event.isComposing || composing) return;
    if (event.key === "Escape") { event.preventDefault(); finishEdit(); canvas.focus(); return; }
    if (event.key === "Tab" && row) { event.preventDefault(); row.depth = Math.max(0, Math.min(3, row.depth + (event.shiftKey ? -1 : 1))); finishEdit(); mountRows(topic); startEdit(topic, row); return; }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    const next = { id: "new-" + (++rowSequence), text: "", depth: row ? row.depth : 0 };
    if (row) { const start = input.selectionStart, end = input.selectionEnd; next.text = input.value.slice(end); row.text = input.value.slice(0, start); const insert = subtreeEnd(topic, topic.rows.indexOf(row)); finishEdit(); topic.rows.splice(insert, 0, next); }
    else { finishEdit(); topic.rows.unshift(next); }
    mountRows(topic); renderInspector(); startEdit(topic, next);
  };
  resize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
}
function toggleCard(topic) { if (composing) return; finishEdit(); topic.collapsed = !topic.collapsed; mountRows(topic); renderInspector(); scheduleLayout(); }
for (const topic of topics) {
  topic.card = element("article", "mock-card"); topic.card.dataset.topic = topic.id; topic.card.setAttribute("aria-label", topic.title);
  const header = element("header", "mock-card-header"), meta = element("div", "mock-card-meta"), label = element("span", "", "TOPIC " + topic.number), dot = element("i");
  label.prepend(dot); topic.collapse = element("button", "mock-card-collapse", "−"); topic.collapse.type = "button"; topic.collapse.onclick = () => toggleCard(topic); meta.append(label, topic.collapse);
  topic.heading = element("h2", "mock-card-title", topic.title); topic.heading.tabIndex = 0; topic.heading.ondblclick = () => startEdit(topic);
  topic.heading.onkeydown = (event) => { if (event.target === topic.heading && event.key === "Enter") { event.preventDefault(); startEdit(topic); } };
  header.append(meta, topic.heading); topic.body = element("div", "mock-card-body");
  const footer = element("footer", "mock-card-footer"); topic.count = element("span"); footer.append(topic.count, element("b", "", "G" + topic.generation));
  topic.card.append(header, topic.body, footer); topic.card.addEventListener("pointerdown", (event) => { if (!event.target.closest("button,textarea") && topic.id !== selected) selectTopic(topic.id); });
  $("cards").append(topic.card); mountRows(topic);
}
function drawEdges() {
  const svg = $("edges"); svg.replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs"), marker = document.createElementNS(ns, "marker"), head = document.createElementNS(ns, "path");
  marker.id = "mock-arrow"; marker.setAttribute("viewBox", "0 0 8 8"); marker.setAttribute("refX", "7"); marker.setAttribute("refY", "4"); marker.setAttribute("markerWidth", "5"); marker.setAttribute("markerHeight", "5"); marker.setAttribute("orient", "auto"); head.setAttribute("d", "M 0 0 L 8 4 L 0 8"); head.setAttribute("fill", "context-stroke"); marker.append(head); defs.append(marker); svg.append(defs);
  for (const relation of relations) {
    if (relation.type !== "FROM" && !$("auxiliary").checked) continue;
    const a = byId.get(relation.source), b = byId.get(relation.target); if (a.y === undefined || b.y === undefined) continue;
    let d;
    if (relation.type === "FROM") { const x1 = a.x + 170, y1 = a.y + a.height + 4, x2 = b.x + 170, y2 = b.y - 6, middle = (y1 + y2) / 2; d = "M" + x1 + " " + y1 + " C" + x1 + " " + middle + " " + x2 + " " + middle + " " + x2 + " " + y2; }
    else if (relation.type === "FIX") { const bend = 910; d = "M" + (a.x + 344) + " " + (a.y + 55) + " C" + bend + " " + (a.y + 55) + " " + bend + " " + (b.y + 55) + " " + (b.x + 344) + " " + (b.y + 55); }
    else { const lower = relation.type === "VS", y1 = a.y + (lower ? a.height - 25 : 66), y2 = b.y + (lower ? b.height - 25 : 66); d = "M" + (a.x + 344) + " " + y1 + " C" + (a.x + 390) + " " + y1 + " " + (b.x - 50) + " " + y2 + " " + (b.x - 5) + " " + y2; }
    const path = document.createElementNS(ns, "path"); path.setAttribute("d", d); path.setAttribute("class", "mock-edge " + relation.type.toLowerCase()); path.setAttribute("marker-end", "url(#mock-arrow)"); path.dataset.type = relation.type;
    const title = document.createElementNS(ns, "title"); title.textContent = titleOf(a) + " → " + titleOf(b) + " · " + relation.type; path.append(title); svg.append(path);
  }
}
function layout() {
  layoutFrame = 0; if (composing) return;
  const anchor = editing && { x: editing.topic.x, y: editing.topic.y };
  let y = 20; $("generation-labels").replaceChildren();
  for (let generation = 0; generation < 3; generation++) {
    const row = topics.filter((topic) => topic.generation === generation);
    const label = element("span", "mock-generation", "G" + generation); label.style.top = y + 30 + "px"; $("generation-labels").append(label);
    let maxHeight = 0;
    for (const topic of row) { topic.height = topic.card.offsetHeight; topic.x = 270 + topic.column * 220; topic.y = y; topic.card.style.left = topic.x + "px"; topic.card.style.top = topic.y + "px"; maxHeight = Math.max(maxHeight, topic.height); }
    y += maxHeight + 84;
  }
  bounds = { x: -40, y: 0, width: 970, height: y - 70 }; drawEdges();
  if (anchor && Number.isFinite(anchor.y)) { camera.x += (anchor.x - editing.topic.x) * camera.zoom; camera.y += (anchor.y - editing.topic.y) * camera.zoom; applyCamera(); }
  if (!initialized) { initialized = true; fitView(); }
  console.assert(topics.every((topic) => Number.isFinite(topic.x) && topic.height > 0), "Mock cards must have finite measured bounds");
  console.assert(relations.filter((r) => r.type === "FROM").every((r) => byId.get(r.source).y + byId.get(r.source).height < byId.get(r.target).y), "Sources must stay above their derived Topics");
}
function scheduleLayout() { if (!layoutFrame) layoutFrame = requestAnimationFrame(layout); }
const observer = new ResizeObserver(scheduleLayout); for (const topic of topics) observer.observe(topic.card);
$("theme").onclick = () => { const light = document.documentElement.dataset.theme !== "light"; document.documentElement.dataset.theme = light ? "light" : "dark"; $("theme").textContent = light ? "ダークに切替" : "ライトに切替"; scheduleLayout(); };
$("inspector-toggle").onclick = () => { const hidden = !$("inspector").hidden; $("inspector").hidden = hidden; $("inspector-toggle").textContent = hidden ? "詳細を開く" : "詳細を閉じる"; $("inspector-toggle").setAttribute("aria-pressed", String(!hidden)); requestAnimationFrame(fitView); };
$("search").oninput = renderSidebar; $("search").onkeydown = (event) => { if (event.key === "Enter") { const first = topics.find(matched); if (first) { selectTopic(first.id); reveal(); } } };
$("auxiliary").onchange = drawEdges; $("edit").onclick = () => { const topic = byId.get(selected); if (topic.collapsed) { topic.collapsed = false; mountRows(topic); } startEdit(topic, topic.rows.find((row) => row.id === activeRow && !row.reference) || topic.rows.find((row) => !row.reference)); reveal(); };
$("collapse-card").onclick = () => toggleCard(byId.get(selected));
$("zoom-in").onclick = () => zoomTo(camera.zoom * 1.15); $("zoom-out").onclick = () => zoomTo(camera.zoom / 1.15); $("fit").onclick = fitView; $("reveal").onclick = reveal;
canvas.addEventListener("wheel", (event) => { if (event.target.closest("textarea") || composing) return; event.preventDefault(); const rect = canvas.getBoundingClientRect(); zoomTo(camera.zoom * Math.exp(-event.deltaY * .001), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
canvas.addEventListener("pointerdown", (event) => { if (event.button !== 0 || event.target.closest(".mock-card,.mock-canvas-controls")) return; event.preventDefault(); drag = { x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y }; canvas.setPointerCapture(event.pointerId); canvas.classList.add("dragging"); });
canvas.addEventListener("pointermove", (event) => { if (!drag) return; camera.x = drag.cameraX + event.clientX - drag.x; camera.y = drag.cameraY + event.clientY - drag.y; applyCamera(); });
function endDrag() { drag = null; canvas.classList.remove("dragging"); }
canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("lostpointercapture", endDrag);
canvas.addEventListener("keydown", (event) => { if (event.target !== canvas) return; if (event.key === "+" || event.key === "=") zoomTo(camera.zoom * 1.15); else if (event.key === "-") zoomTo(camera.zoom / 1.15); else if (event.key === "0") fitView(); });
window.addEventListener("resize", () => { scheduleLayout(); if (!editing) requestAnimationFrame(fitView); });
console.assert(byId.size === topics.length && relations.every((r) => byId.has(r.source) && byId.has(r.target)), "Mock fixture IDs and endpoints must be valid");
selectTopic(selected); scheduleLayout();
