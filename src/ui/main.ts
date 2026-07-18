import { mount } from "svelte";
import App from "./App.svelte";
import "./styles.css";

void fetch("/api/renderer-log", { method: "POST", body: "Svelte entry module started" });
const target = document.getElementById("app");
if (!target) throw new Error("#app mount target was not found.");
mount(App, { target });
void fetch("/api/renderer-log", { method: "POST", body: "Svelte app mounted" });
setTimeout(() => {
	const style = getComputedStyle(document.body);
	const diagnostic = {
		appChildren: target.childElementCount,
		bodyText: document.body.innerText.slice(0, 240),
		bodyBackground: style.backgroundColor,
		bodyColor: style.color,
		viewport: `${window.innerWidth}x${window.innerHeight}`,
		documentVisibility: document.visibilityState,
	};
	void fetch("/api/renderer-log", {
		method: "POST",
		body: `DOM diagnostic: ${JSON.stringify(diagnostic)}`,
	});
}, 1000);
