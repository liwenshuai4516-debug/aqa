/** Complete bounded export from the pinned, trusted data fixture only. Never follows guest paths on the host. */
import { createHash } from "node:crypto";
export const artifactBaseline: Record<string, string> = Object.freeze({
	"old.txt": "original\n",
	"deleted.txt": "remove me\n",
	".ignored": "original ignored\n",
	"tests.txt": "public development test\n",
});
export const artifactDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
export const ARTIFACT_LIMITS = Object.freeze({ entries: 32, fileBytes: 512, totalBytes: 8192, pathBytes: 128 });
export type ArtifactEntry = {
	path: string;
	type: string;
	size: number;
	sha256: string;
	contentBase64?: string;
	change: string;
	ignored: boolean;
};
export type ArtifactSnapshot = {
	version: 1;
	complete: boolean;
	gaps: string[];
	entries: ArtifactEntry[];
	baselineDigest: string;
	digest: string;
};
export class ArtifactCollector {
	private rows = new Map<string, ArtifactEntry>();
	private gaps: string[] = [];
	private ended = false;
	private total = 0;
	constructor(private readonly seeded: boolean) {}
	private gap(reason: string) {
		if (!this.gaps.includes(reason) && this.gaps.length < 16) this.gaps.push(reason);
	}
	add(raw: Buffer) {
		if (this.ended) {
			this.gap("artifact-after-end");
			return;
		}
		if (raw.length > 1024 || this.rows.size >= ARTIFACT_LIMITS.entries) {
			this.gap("artifact-budget");
			return;
		}
		if (!Buffer.from(raw.toString("ascii"), "ascii").equals(raw)) {
			this.gap("invalid-artifact-record");
			return;
		}
		const parts = raw.toString("ascii").split(":");
		const [encoded, type, content] = parts;
		if (parts.length !== 3) {
			this.gap("invalid-artifact-record");
			return;
		}
		const pathBytes = Buffer.from(encoded, "base64"),
			bytes = Buffer.from(content, "base64"),
			path = pathBytes.toString("utf8");
		if (
			pathBytes.toString("base64") !== encoded ||
			bytes.toString("base64") !== content ||
			!path ||
			pathBytes.length > 128 ||
			!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(path) ||
			path.split("/").some((p) => p === "." || p === "..")
		) {
			this.gap("unsafe-artifact-path-or-encoding");
			return;
		}
		if (this.rows.has(path)) {
			this.gap("duplicate-artifact-path");
			return;
		}
		const allowed = ["file", "directory"].includes(type);
		if (!allowed) this.gap("rejected-artifact-type");
		if (bytes.length > 512 || (this.total += bytes.length) > 8192 || (type === "directory" && bytes.length)) {
			this.gap("artifact-budget");
			return;
		}
		const before = this.seeded ? artifactBaseline[path] : undefined;
		this.rows.set(path, {
			path,
			type,
			size: bytes.length,
			sha256: sha(bytes),
			...(allowed ? { contentBase64: content } : {}),
			change: before === undefined ? "added" : Buffer.from(before).equals(bytes) ? "unchanged" : "modified",
			ignored: path === ".ignored",
		});
	}
	end(count: string) {
		if (this.ended || !/^(0|[1-9][0-9]?)$/.test(count) || Number(count) !== this.rows.size)
			this.gap("artifact-incomplete-count");
		this.ended = true;
	}
	reject(reason: string) {
		this.gap(reason);
	}
	freeze(): ArtifactSnapshot {
		const entries = [...this.rows.values()].map((e) => ({ ...e }));
		if (this.seeded)
			for (const path of Object.keys(artifactBaseline))
				if (!this.rows.has(path))
					entries.push({
						path,
						type: "deleted",
						size: 0,
						sha256: sha(Buffer.alloc(0)),
						change: "deleted",
						ignored: path === ".ignored",
					});
		entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
		const body = {
			version: 1 as const,
			complete: this.ended && !this.gaps.length,
			gaps: [...this.gaps, ...(this.ended ? [] : ["artifact-end-unavailable"])],
			entries,
			baselineDigest: artifactDigest(this.seeded ? artifactBaseline : {}),
		};
		return { ...body, digest: artifactDigest(body) };
	}
}
