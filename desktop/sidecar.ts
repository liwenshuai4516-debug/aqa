/** Host lifecycle only: the existing server owns all application and shutdown behavior. */
let loaded = false;
let shutdownRequested = false;
function requestShutdown(): void {
	shutdownRequested = true;
	if (loaded) process.emit("SIGTERM");
}
process.on("message", (message: unknown) => {
	if (message && typeof message === "object" && "type" in message && message.type === "pi-desktop:shutdown")
		requestShutdown();
});
process.on("disconnect", requestShutdown);
const serverEntry = new URL("../server/index.js", import.meta.url).href;
await import(serverEntry);
loaded = true;
if (shutdownRequested) process.emit("SIGTERM");
