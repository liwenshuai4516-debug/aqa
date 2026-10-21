// Diagnostic hook, NOT an OS sandbox. Only synthetic local fixtures are allowed.
const net = require("node:net");
const fs = require("node:fs");
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
	const first = Array.isArray(args[0]) ? args[0][0] : args[0];
	const options = typeof first === "object" ? first : { port: first, host: args[1] };
	const host = options.host ?? "localhost";
	fs.appendFileSync(process.env.P0_NETWORK_LOG, JSON.stringify({ host, port: options.port ?? null }) + "\n");
	if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
		// Fail closed before DNS/connect; caller must preserve an unknown execution result.
		process.exit(78);
	}
	return original.apply(this, args);
};
