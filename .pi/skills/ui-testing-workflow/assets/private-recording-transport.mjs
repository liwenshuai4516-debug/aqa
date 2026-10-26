// Internal lifecycle guard only. The required receive callback owns private capture,
// output filtering and native draft validation. This does not enable private recording.

/**
 * @param {{
 * transport: import('@earendil-works/pi-mcp').McpTransport,
 * snapshot: Awaited<ReturnType<typeof import('./private-recording-workspace.mjs').preparePrivateRecordingWorkspace>>,
 * receive: (message: import('@earendil-works/pi-mcp').JsonRpcMessage, publish: (write: () => void) => Promise<void>) => Promise<import('@earendil-works/pi-mcp').JsonRpcMessage>
 * }} options
 * @returns {import('@earendil-works/pi-mcp').McpTransport}
 */
export function guardPrivateRecordingTransport({ transport, snapshot, receive }) {
	const pending = new Map(),
		messages = new Set(),
		errors = new Set(),
		closes = new Set();
	let closed = false,
		revocation;
	const blocked = () => new Error("私密录制连接已失效；保留私有证据并停止后续动作");
	const revoke = () => {
		// Snapshot revoke invalidates operations synchronously, before deleting its state.
		closed = true;
		if (!revocation) {
			revocation = snapshot.revoke();
			void revocation.catch(() => {
				for (const listener of errors) listener(blocked());
			});
		}
		return revocation;
	};
	const close = async () => {
		const results = await Promise.allSettled([revoke(), transport.close()]);
		for (const operation of pending.values()) operation.finish();
		pending.clear();
		if (results.some((result) => result.status === "rejected")) throw blocked();
	};
	transport.onClose(() => {
		void revoke();
		for (const operation of pending.values()) operation.finish();
		pending.clear();
		for (const listener of closes) listener();
	});
	transport.onError(() => {
		void revoke();
		for (const listener of errors) listener(blocked());
	});
	transport.onMessage((message) => {
		void (async () => {
			const operation = "id" in message && !("method" in message) ? pending.get(message.id) : undefined;
			if (operation) pending.delete(message.id);
			let published = false,
				output;
			try {
				output = await receive(message, async (write) => {
					if (!operation || published) throw blocked();
					await operation.publish(write);
					published = true;
				});
				if (operation && !published) await operation.publish(() => {});
			} catch {
				// An unprocessed response must not leave copied authentication usable.
				void snapshot.revoke().catch(() => {
					for (const listener of errors) listener(blocked());
				});
				if (!("id" in message) || "method" in message) {
					void revoke();
					for (const listener of errors) listener(blocked());
					return;
				}
				output = {
					jsonrpc: "2.0",
					id: message.id,
					error: { code: -32000, message: blocked().message },
				};
			} finally {
				// SDK completion aborts send.signal too. Unbind before delivering a reply.
				operation?.finish();
			}
			for (const listener of messages) listener(output);
		})().catch(() => {
			void revoke();
			for (const listener of errors) listener(blocked());
		});
	});
	return {
		start: async () => {
			if (closed) throw blocked();
			try {
				await snapshot.assertCurrent();
				if (closed) throw blocked();
				await transport.start();
			} catch {
				await close();
				throw blocked();
			}
		},
		send: async (message, options) => {
			if (closed) throw blocked();
			let operation;
			try {
				if ("method" in message && "id" in message) {
					if (pending.has(message.id)) throw blocked();
					// Owned browser cleanup remains possible after cancellation while connected.
					if (message.method !== "tools/call" || message.params?.name !== "browser_close") {
						operation = await snapshot.beginOperation(options?.signal);
						if (closed) throw blocked();
						pending.set(message.id, operation);
					}
				}
				operation?.assertActive();
				if (closed || options?.signal?.aborted) throw blocked();
				await transport.send(message, options);
			} catch {
				operation?.finish();
				if (operation) pending.delete(message.id);
				// A failed send may have dispatched before failing. Never reuse that state.
				await snapshot.revoke().catch(() => {
					for (const listener of errors) listener(blocked());
				});
				throw blocked();
			}
		},
		close,
		onMessage: (listener) => {
			messages.add(listener);
			return () => messages.delete(listener);
		},
		onError: (listener) => {
			errors.add(listener);
			return () => errors.delete(listener);
		},
		onClose: (listener) => {
			closes.add(listener);
			return () => closes.delete(listener);
		},
	};
}
