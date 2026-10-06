import { mount, unmount } from "svelte";
import App from "../../src/ui/App.svelte";
import { DEFAULT_UI_VOCABULARY } from "../../src/shared/ui_vocabulary.ts";
import { UI_VOCABULARY_CONTEXT } from "../../src/ui/ui_vocabulary_context.ts";
import "../../src/ui/styles.css";

const target = document.getElementById("app");
const mountButton = document.getElementById("mount");
const unmountButton = document.getElementById("unmount");
if (!target || !(mountButton instanceof HTMLButtonElement) || !(unmountButton instanceof HTMLButtonElement)) {
	throw new Error("App lifetime harness requires its mount target and buttons");
}

const start = () => {
	const app = mount(App, {
		target,
		context: new Map([[UI_VOCABULARY_CONTEXT, DEFAULT_UI_VOCABULARY]]),
	});
	mountButton.disabled = true;
	unmountButton.disabled = false;
	unmountButton.onclick = async () => {
		unmountButton.disabled = true;
		await unmount(app);
		mountButton.disabled = false;
	};
};

mountButton.onclick = start;
start();
