import { createHash } from "node:crypto";
import { createReadStream, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2] ?? "release");
const lines = [];
for (const name of readdirSync(root).sort()) {
	if (!/\.(dmg|zip|exe|AppImage|blockmap|yml)$/.test(name)) continue;
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(join(root, name))) hash.update(chunk);
	lines.push(`${hash.digest("hex")}  ${name}`);
}
if (!lines.length) throw new Error("No release artifacts found");
writeFileSync(join(root, "SHA256SUMS.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
