// The parent owns stdin. If it is forcibly killed, do not leave its server alive.
// No process-name/port based kill: this process terminates only itself.
process.stdin.resume();
process.stdin.once("end", () => process.kill(process.pid, "SIGTERM"));
