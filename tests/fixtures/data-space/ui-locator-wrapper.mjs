/** Supplemental locator fixture; the embedded u00-1 page is served byte-for-byte unchanged. */
export function locatorWrapper(version) {
	const frame = version === 1 ? "names-frame" : "renamed-names-frame";
	const route = version === 1 ? "/frame" : "/changed-frame";
	return `<!doctype html><h1>Locator wrapper v${version}</h1>
<section aria-label="Toolbar"><button onclick="document.querySelector('#toolbar-count').textContent=String(++window.toolbarCount)">Search</button><output id="toolbar-count">0</output></section>
<section aria-label="Backup"><button onclick="document.querySelector('#backup-count').textContent=String(++window.backupCount)">Search</button><output id="backup-count">0</output></section>
<script>window.toolbarCount=0;window.backupCount=0;</script>
<iframe data-testid="${frame}" title="Names frame v${version}" src="${route}?role=tester"></iframe>
${version === 2 ? '<iframe title="Decoy" src="/decoy"></iframe>' : ""}`;
}
