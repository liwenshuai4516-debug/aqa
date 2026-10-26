import { afterEach, expect, it } from "vitest";
import type { Page } from "@playwright/test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, readFile, writeFile, chmod, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	observePrivateStorage,
	readPrivateStorageEvents,
} from "../../.pi/skills/ui-testing-workflow/assets/private-recording-storage-events.mjs";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const origin = "http://fixture.invalid";
const storageId = { securityOrigin: origin, isLocalStorage: true };
async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "private-storage-events-"))),
		file = join(root, "events.ndjson");
	cleanups.push(() => rm(root, { recursive: true, force: true }));
	const client = new EventEmitter() as EventEmitter & {
		send: (method: string) => Promise<void>;
		detach: () => Promise<void>;
	};
	const sent: string[] = [];
	let detached = 0;
	client.send = async (method) => {
		sent.push(method);
	};
	client.detach = async () => {
		detached++;
	};
	const context = new EventEmitter() as EventEmitter & {
		newCDPSession: () => Promise<typeof client>;
		pages: () => unknown[];
	};
	context.newCDPSession = async () => client;
	const page = new EventEmitter() as EventEmitter & {
		context: () => typeof context;
		frames: () => unknown[];
		url: () => string;
	};
	page.context = () => context;
	context.pages = () => [page];
	page.frames = () => [{}];
	page.url = () => "about:blank";
	const observer = await observePrivateStorage(page as unknown as Page, file);
	cleanups.push(observer.dispose);
	return { root, file, client, context, page, observer, sent, detached: () => detached };
}

it("observes additions, updates and session values before deletion; flush crosses a CDP barrier", async () => {
	const f = await fixture();
	f.client.emit("DOMStorage.domStorageItemAdded", { storageId, key: "token", newValue: "synthetic-added" });
	f.client.emit("DOMStorage.domStorageItemUpdated", {
		storageId,
		key: "token",
		oldValue: "synthetic-added",
		newValue: "synthetic-assigned",
	});
	f.client.emit("DOMStorage.domStorageItemRemoved", { storageId, key: "token" });
	f.client.emit("DOMStorage.domStorageItemAdded", {
		storageId: { ...storageId, isLocalStorage: false },
		key: "token",
		newValue: "synthetic-session",
	});
	f.client.emit("DOMStorage.domStorageItemsCleared", { storageId });
	await f.observer.flush();
	const observed = readPrivateStorageEvents(f.file, origin);
	expect(observed.stateForFilter.origins[0].localStorage.map((v: { value: string }) => v.value)).toEqual([
		"synthetic-added",
		"synthetic-added",
		"synthetic-assigned",
		"synthetic-session",
	]);
	expect(f.sent).toEqual(["DOMStorage.enable", "Runtime.evaluate"]);
	expect(observed.eventCount).toBe(8);
});

it("rejects incomplete, malformed and unrelated-target evidence with a fixed error", async () => {
	const f = await fixture();
	await f.observer.flush();
	const valid = await readFile(f.file, "utf8");
	for (const bad of [
		valid.slice(0, -1),
		"not-json\n",
		valid.replace('"barrier"', '"disposed"'),
		valid.replace(
			'{"type":"barrier"}',
			JSON.stringify({ type: "domStorageItemAdded", storageId, key: "token", newValue: 42 }) + '\n{"type":"barrier"}',
		),
		valid.replace(
			'{"type":"barrier"}',
			JSON.stringify({
				type: "domStorageItemAdded",
				storageId: { ...storageId, securityOrigin: "http://other.invalid" },
				key: "token",
				newValue: "raw-synthetic-secret",
			}) + '\n{"type":"barrier"}',
		),
	]) {
		await writeFile(f.file, bad);
		expect(() => readPrivateStorageEvents(f.file, origin)).toThrow("Private storage observation unavailable");
	}
	await writeFile(f.file, valid);
	await chmod(f.file, 0o644);
	expect(() => readPrivateStorageEvents(f.file, origin)).toThrow("Private storage observation unavailable");
	await chmod(f.file, 0o600);
	await symlink(f.file, join(f.root, "link"));
	expect(() => readPrivateStorageEvents(join(f.root, "link"), origin)).toThrow(
		"Private storage observation unavailable",
	);
});

it("refuses a second page and does not silently claim its storage was observed", async () => {
	const f = await fixture();
	f.context.emit("page", {});
	await f.observer.flush();
	expect(() => readPrivateStorageEvents(f.file, origin)).toThrow("Private storage observation unavailable");
});

it("event budget exhaustion blocks the next flush and bounds the private file", async () => {
	const f = await fixture();
	for (let i = 0; i < 140; i++)
		f.client.emit("DOMStorage.domStorageItemAdded", { storageId, key: "token", newValue: "synthetic-value" });
	await expect(f.observer.flush()).rejects.toThrow("Private storage observation unavailable");
	expect((await readFile(f.file, "utf8")).trim().split("\n").length).toBeLessThanOrEqual(128);
});

it("page close disposes listeners and an unavailable connection refuses further flush", async () => {
	const f = await fixture();
	f.client.emit("close");
	await expect(f.observer.flush()).rejects.toThrow("Private storage observation unavailable");
	f.page.emit("close");
	await f.observer.dispose();
	expect(f.context.listenerCount("page")).toBe(0);
	expect(f.client.listenerCount("DOMStorage.domStorageItemAdded")).toBe(0);
	expect(f.detached()).toBe(1);
	await expect(f.observer.flush()).rejects.toThrow("Private storage observation unavailable");
});

it("does not place raw event captures inside the public workspace", async () => {
	const f = await fixture();
	await expect(
		observePrivateStorage(f.page as unknown as Page, join(process.cwd(), "must-not-create-private-storage.ndjson")),
	).rejects.toThrow("Private storage observation unavailable");
});

it("byte budget exhaustion never writes the oversized credential value", async () => {
	const f = await fixture();
	f.client.emit("DOMStorage.domStorageItemAdded", { storageId, key: "token", newValue: "x".repeat(2 * 1024 * 1024) });
	await expect(f.observer.flush()).rejects.toThrow("Private storage observation unavailable");
	expect((await readFile(f.file)).length).toBeLessThan(1024);
});

it("refuses newly attached frames even if they are detached before the next flush", async () => {
	const f = await fixture();
	f.page.emit("frameattached", {});
	f.page.emit("framedetached", {});
	await f.observer.flush();
	expect(() => readPrivateStorageEvents(f.file, origin)).toThrow("Private storage observation unavailable");
});
it("requires a fresh single-page and single-frame context before installing", async () => {
	const f = await fixture();
	f.page.frames = () => [{}, {}];
	await expect(observePrivateStorage(f.page as unknown as Page, join(f.root, "existing-frame.ndjson"))).rejects.toThrow(
		"Private storage observation unavailable",
	);
	f.page.frames = () => [{}];
	f.page.url = () => "http://fixture.invalid/already-navigated";
	await expect(observePrivateStorage(f.page as unknown as Page, join(f.root, "existing-page.ndjson"))).rejects.toThrow(
		"Private storage observation unavailable",
	);
	expect(f.sent).toEqual(["DOMStorage.enable"]);
	f.page.url = () => "about:blank";
	f.context.pages = () => [f.page, {}];
	await expect(observePrivateStorage(f.page as unknown as Page, join(f.root, "multiple-pages.ndjson"))).rejects.toThrow(
		"Private storage observation unavailable",
	);
	expect(f.sent).toEqual(["DOMStorage.enable"]);
	for (const name of ["existing-frame.ndjson", "existing-page.ndjson", "multiple-pages.ndjson"])
		await expect(readFile(join(f.root, name))).rejects.toMatchObject({ code: "ENOENT" });
});
