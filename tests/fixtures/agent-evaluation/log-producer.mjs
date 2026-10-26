/** Trusted synthetic producer, IPC release only; never calls a model or external service. */
import { once } from "node:events";
const header = Buffer.from('{"中文":"😀"}\n{"kind":"final-text"}\n');
for (const byte of header) process.stdout.write(Buffer.from([byte]));
process.stderr.write('warning from stderr\n{"stderr":true}\n');
process.send({ phase: "waiting" });
await once(process, "message");
let drains = 0;
for (let i = 0; i < 64; i++) {
	if (!process.stdout.write(Buffer.alloc(65536, 120))) {
		drains++;
		await once(process.stdout, "drain");
	}
}
process.stdout.write("\n");
process.stderr.write('{"ended":true}\n');
process.send({ phase: "released", drains });
process.disconnect();
