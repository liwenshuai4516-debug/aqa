/** Restore only the declared synthetic origins; never replaces an occupied port. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createProbeServer } from "./ui-multifunction-probes.mjs";

export async function startProbeServers(deployments) {
	const servers = [],
		origins = new Set();
	const close = async () => {
		for (const server of servers) {
			server.closeAllConnections();
			if (server.listening) await new Promise((resolve) => server.close(resolve));
		}
	};
	try {
		for (const deployment of deployments) {
			const url = new URL(deployment.url);
			if (
				url.protocol !== "http:" ||
				url.hostname !== "127.0.0.1" ||
				Number(url.port) < 8900 ||
				url.pathname !== "/" ||
				url.search ||
				url.hash ||
				url.username ||
				url.password ||
				origins.has(url.origin)
			)
				throw new Error("Replay requires distinct declared loopback origins with ports >= 8900");
			origins.add(url.origin);
			const server = createProbeServer(deployment.id);
			servers.push(server);
			await new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(Number(url.port), "127.0.0.1", () => {
					server.off("error", reject);
					resolve();
				});
			});
		}
		return { close };
	} catch (error) {
		await close();
		throw error;
	}
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	const { deployments } = JSON.parse(await readFile(new URL("./deployments.json", import.meta.url), "utf8"));
	const running = await startProbeServers(deployments);
	console.log(
		JSON.stringify({
			status: "listening",
			origins: deployments.map((entry) => entry.url),
			browserReadiness: "unchecked",
		}),
	);
	let stopping = false;
	const stop = async () => {
		if (!stopping) {
			stopping = true;
			await running.close();
		}
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
}
