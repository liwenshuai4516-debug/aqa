/** Host-owned fixed TCP transport. HTTP, redirects and assertions remain in Newman. */
import { createServer, connect, isIP, type Socket } from "node:net";

export const API_TARGET_RELAY_POLICY = "fixed-ipv4-http-relay-v1";

export function fixedApiHttpOrigin(value: string): string {
	const url = new URL(value);
	if (url.protocol !== "http:" || isIP(url.hostname) !== 4 || url.origin !== value)
		throw new Error("API target requires a canonical HTTP numeric IPv4 origin without credentials or path");
	return url.origin;
}

export async function startApiTargetRelay(origin: string, signal: AbortSignal) {
	const target = new URL(fixedApiHttpOrigin(origin));
	signal.throwIfAborted();
	const sockets = new Set<Socket>();
	let closing: Promise<void> | undefined;
	const server = createServer((down) => {
		if (closing || signal.aborted) {
			down.destroy();
			return;
		}
		const up = connect({ host: target.hostname, port: Number(target.port || 80) });
		for (const socket of [down, up]) {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			socket.on("error", () => {
				up.destroy();
				down.destroy();
			});
		}
		down.once("close", () => up.destroy());
		up.setTimeout(5000, () => {
			up.destroy();
			down.destroy();
		});
		down.pipe(up);
		up.pipe(down);
	});
	server.maxConnections = 4;
	await new Promise<void>((ok, fail) => {
		server.once("error", fail);
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", fail);
			ok();
		});
	});
	const onStop = (): void => {
		void close();
	};
	const close = (): Promise<void> => {
		if (!closing) {
			signal.removeEventListener("abort", onStop);
			const closed = [...sockets].map(
				(socket) =>
					new Promise<void>((ok) => {
						socket.once("close", () => ok());
						socket.destroy();
					}),
			);
			closing = Promise.all([new Promise<void>((ok) => server.close(() => ok())), ...closed]).then(() => undefined);
		}
		return closing;
	};
	const address = server.address();
	if (!address || typeof address === "string" || address.port < 8900 || signal.aborted) {
		await close();
		signal.throwIfAborted();
		throw new Error("API relay did not obtain an isolated high port");
	}
	signal.addEventListener("abort", onStop, { once: true });
	return { origin: `http://127.0.0.1:${address.port}`, close };
}

/** Preserve the approved logical collection; record this transport copy with its own hash. */
export function relayApiCollection(collection: Record<string, any>, logicalOrigin: string, relayOrigin: string) {
	const copy = structuredClone(collection);
	const host = new URL(fixedApiHttpOrigin(logicalOrigin)).host;
	const walk = (items: Array<Record<string, any>>): void => {
		for (const item of items) {
			if (item.item) walk(item.item);
			else {
				if (typeof item.request?.url !== "string") throw new Error("Target relay requires compiled URL strings");
				const url = new URL(item.request.url);
				if (url.origin !== logicalOrigin || url.username || url.password)
					throw new Error("Approved logical target changed");
				const headers = item.request.header ?? [];
				if (!Array.isArray(headers) || headers.some((h: any) => h.key?.toLowerCase() === "host" && h.value !== host))
					throw new Error("Host header conflicts with the approved target");
				item.request.header = [
					...headers.filter((h: any) => h.key?.toLowerCase() !== "host"),
					{ key: "Host", value: host },
				];
				item.request.url = relayOrigin + url.pathname + url.search;
			}
		}
	};
	walk(copy.item);
	return copy;
}
