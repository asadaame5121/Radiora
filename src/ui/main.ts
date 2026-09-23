import { mount } from "svelte";
import App from "./App.svelte";
import { DEFAULT_UI_VOCABULARY } from "../shared/ui_vocabulary.ts";
import "./styles.css";
import { UI_VOCABULARY_CONTEXT } from "./ui_vocabulary_context.ts";

void fetch("/api/renderer-log", { method: "POST", body: "Svelte entry module started" });
const target = document.getElementById("app");
if (!target) throw new Error("#app mount target was not found.");
mount(App, {
	target,
	context: new Map([[UI_VOCABULARY_CONTEXT, DEFAULT_UI_VOCABULARY]]),
});
void fetch("/api/renderer-log", { method: "POST", body: "Svelte app mounted" });
