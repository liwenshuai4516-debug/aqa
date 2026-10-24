/** Each mount owns its requests. Changing source invalidates replies without cancelling unrelated work. */
export function transport(ctx) {
	const pending = new Map(),
		retries = new Map();
	let source = {},
		closed = false,
		generation = 0;
	const off = ctx.onData((message) => {
		const item = pending.get(message?.requestId);
		if (!item) return;
		pending.delete(message.requestId);
		clearTimeout(item.timer);
		if (message.ok) {
			retries.delete(item.key);
			item.resolve(message.result);
		} else {
			if (!["EXECUTION_UNKNOWN", "IO_ERROR"].includes(message.error?.code)) retries.delete(item.key);
			item.reject(Object.assign(new Error(message.error?.message ?? "Request failed"), message.error));
		}
	});
	function invalidate() {
		generation++;
		for (const item of pending.values()) {
			clearTimeout(item.timer);
			item.reject(Object.assign(new Error("Source changed or view closed"), { stale: true }));
		}
		pending.clear();
		retries.clear();
	}
	return {
		get generation() {
			return generation;
		},
		select(value) {
			invalidate();
			source = value;
		},
		request(action, data = {}) {
			if (closed) return Promise.reject(Object.assign(new Error("View closed"), { stale: true }));
			const key = JSON.stringify({ action, ...source, ...data });
			const requestId = retries.get(key) ?? crypto.randomUUID();
			if (pending.has(requestId))
				return Promise.reject(
					Object.assign(new Error("The same request is already in progress"), { code: "IN_PROGRESS" }),
				);
			retries.set(key, requestId);
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(requestId);
					reject(
						Object.assign(new Error("Request timed out; refresh records before retrying a write"), { code: "TIMEOUT" }),
					);
				}, 30000);
				pending.set(requestId, { resolve, reject, timer, key });
				try {
					ctx.send({ action, ...source, ...data, requestId });
				} catch (error) {
					clearTimeout(timer);
					pending.delete(requestId);
					reject(error);
				}
			});
		},
		close() {
			closed = true;
			invalidate();
			off();
		},
	};
}
