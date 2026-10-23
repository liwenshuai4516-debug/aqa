/** Explicit, bounded artifact observation in the host-authorized workspace. No recursive discovery. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";
import type { AgentEvaluationArtifactSnapshot } from "../protocol.js";
import { EvidenceReadError, redactEvaluationArtifactText } from "./evaluation-evidence.js";
const LIMIT = 1024 * 1024;
export function readEvaluationArtifact(workspace: string, path: string): AgentEvaluationArtifactSnapshot {
	if (
		typeof path !== "string" ||
		path.length > 4096 ||
		isAbsolute(path) ||
		path.includes("\\") ||
		path.includes("\0") ||
		path.split("/").some((p) => !p || p === "." || p === "..")
	)
		throw new EvidenceReadError("PERMISSION_DENIED", "Expected an explicit workspace-relative artifact path");
	const parts = path.split("/");
	if (
		parts.some(
			(p) => /^(?:\.env(?:\..*)?|auth\.json|\.npmrc|\.ssh|id_rsa|id_ed25519)$/i.test(p) || /\.(?:pem|key)$/i.test(p),
		)
	)
		throw new EvidenceReadError("PERMISSION_DENIED", "Credential artifacts are not evaluation inputs");
	const root = realpathSync(workspace),
		file = join(root, path),
		observedAt = new Date().toISOString();
	const base = { path, observedAt, redaction: [] as string[], truncated: false };
	let cursor = root;
	for (const part of parts) {
		cursor = join(cursor, part);
		try {
			if (lstatSync(cursor).isSymbolicLink())
				throw new EvidenceReadError("PERMISSION_DENIED", "Artifact symlinks are not supported");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...base, exists: false };
			throw error;
		}
	}
	const inside = () => {
		const rel = relative(root, realpathSync(file));
		if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel))
			throw new EvidenceReadError("PERMISSION_DENIED", "Artifact escaped its workspace");
	};
	inside();
	if (!lstatSync(file).isFile()) throw new EvidenceReadError("INVALID_INPUT", "Artifact must be a regular file");
	const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd, { bigint: true });
		if (!before.isFile()) throw new EvidenceReadError("INVALID_INPUT", "Artifact must be a regular file");
		if (before.size > BigInt(LIMIT)) return { ...base, exists: true, size: Number(before.size), truncated: true };
		const buffer = Buffer.alloc(Number(before.size));
		let offset = 0;
		while (offset < buffer.length) {
			const n = readSync(fd, buffer, offset, buffer.length - offset, offset);
			if (!n) break;
			offset += n;
		}
		const after = fstatSync(fd, { bigint: true }),
			current = lstatSync(file, { bigint: true });
		inside();
		if (
			offset !== buffer.length ||
			before.size !== after.size ||
			before.mtimeNs !== after.mtimeNs ||
			current.ino !== after.ino ||
			current.dev !== after.dev ||
			current.isSymbolicLink()
		)
			throw new EvidenceReadError("EVIDENCE_GAP", "Artifact changed while being observed");
		let text: string | undefined;
		let redaction: string[] = [];
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
		} catch {
			/* Binary artifacts retain an existence/byte digest observation, not invented text. */
		}
		if (text !== undefined) {
			const clean = redactEvaluationArtifactText(text);
			text = clean.text;
			redaction = clean.redaction;
		}
		const observedBytes = text !== undefined && redaction.length ? Buffer.from(text) : buffer;
		const snapshot = {
			...base,
			exists: true,
			size: buffer.length,
			sha256: createHash("sha256").update(observedBytes).digest("hex"),
			...(text !== undefined ? { text } : {}),
			redaction,
		};
		if (Buffer.byteLength(JSON.stringify(snapshot)) > LIMIT) {
			delete snapshot.text;
			snapshot.truncated = true;
		}
		return snapshot;
	} finally {
		closeSync(fd);
	}
}
