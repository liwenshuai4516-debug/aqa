// Diagnostic hook, NOT an OS sandbox. Only the host-selected loopback transport port is allowed.
const net = require("node:net");
const fs = require("node:fs");
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
	const first = Array.isArray(args[0]) ? args[0][0] : args[0];
	const options = typeof first === "object" ? first : { port: first, host: args[1] };
	const host = options.host ?? "localhost";
	// A rejected redirect host may contain a reflected token; never log it verbatim.
	fs.appendFileSync(
		process.env.PI_API_TEST_NETWORK_LOG,
		JSON.stringify({
			host: ["127.0.0.1", "localhost", "::1"].includes(host) ? host : "[blocked]",
			port: typeof options.port === "number" ? options.port : null,
		}) + "\n",
	);
	if (
		!["127.0.0.1", "localhost", "::1"].includes(host) ||
		String(options.port) !== process.env.PI_API_TEST_FIXTURE_PORT
	) {
		// Fail closed before DNS/connect; caller must preserve an unknown execution result.
		process.exit(78);
	}
	return original.apply(this, args);
};
