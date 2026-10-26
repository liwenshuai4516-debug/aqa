/** Extract only pinned public Alpine3.22.7 boot inputs into a new diagnostic runtime directory. No download/install. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
const [iso, destination] = process.argv.slice(2);
assert.ok(iso && destination, "Usage: prepare-vm-runtime.mjs <Alpine3.22.7-aarch64.iso> <new-directory>");
assert.equal(fs.statSync(iso).size, 80644096);
const sha = (value) => createHash("sha256").update(value).digest("hex");
assert.equal(sha(fs.readFileSync(iso)), "3e37f238f6317ef56a12f4cff5c4265f99d25785945f777b19d41b35a7fabbc7");
fs.mkdirSync(destination, { mode: 0o700 });
const extraction = spawnSync(
	"/usr/bin/tar",
	["-xf", path.resolve(iso), "-C", destination, "boot/vmlinuz-virt", "boot/initramfs-virt"],
	{ encoding: "utf8", timeout: 30000 },
);
assert.equal(extraction.status, 0, extraction.stderr);
const compressed = fs.readFileSync(path.join(destination, "boot/vmlinuz-virt"));
assert.equal(sha(compressed), "01c33bc9a2a61cdde9eea7b6f3e43da6ba115b3fdcb76991a94415627b4c6768");
assert.equal(compressed.subarray(4, 8).toString(), "zimg");
const offset = compressed.readUInt32LE(8),
	size = compressed.readUInt32LE(12);
assert.ok(offset > 0 && offset + size <= compressed.length);
const kernel = gunzipSync(compressed.subarray(offset, offset + size), { maxOutputLength: 40 * 1024 ** 2 });
assert.equal(kernel.subarray(56, 60).toString(), "ARMd");
assert.equal(sha(kernel), "42a15047f7cfc785e008b43f48c090f6340f34ead8446d7568126bb5cb9bc9f1");
const initrd = fs.readFileSync(path.join(destination, "boot/initramfs-virt"));
assert.equal(sha(initrd), "aee79b02c16c87fb0b6180a4d652d51b0115d2f2c8a69c20f8e917ff602fe26e");
fs.writeFileSync(path.join(destination, "boot/Image"), kernel, { flag: "wx", mode: 0o600 });
fs.writeFileSync(
	path.join(destination, "provenance.json"),
	JSON.stringify(
		{
			version: "Alpine3.22.7 aarch64",
			source: "https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/aarch64/alpine-virt-3.22.7-aarch64.iso",
			isoSha256: "3e37f238f6317ef56a12f4cff5c4265f99d25785945f777b19d41b35a7fabbc7",
			kernelSha256: sha(kernel),
			initrdSha256: sha(initrd),
			format: "EFI zboot gzip payload extracted to raw ARM64 Image; initramfs retained exact",
			downloads: 0,
		},
		null,
		2,
	) + "\n",
	{ flag: "wx", mode: 0o600 },
);
console.log(path.resolve(destination));
