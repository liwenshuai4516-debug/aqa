/** Release-owned data checks, in a fresh macOS seatbelt + Node permission process.
 * Artifacts are stdin data only; no code, workspace, credentials or result directory is exposed.
 */
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import type { ArtifactSnapshot } from "./external-evaluation-artifacts.js";
import { artifactDigest } from "./external-evaluation-artifacts.js";
const fixture = Object.freeze({ version: 1, path: "result.json", expected: { answer: 42 } });
export const verifierManifest = Object.freeze({
	id: "offline-json",
	version: "1",
	commandTemplate: "fixed-inline-node-data-check",
	allowedArtifactTypes: ["file", "directory", "deleted"],
	isolation: "macOS-seatbelt; node-permissions-when-supported",
	dependencies: [],
	timeoutMs: 2000,
	heapMiB: 32,
	inputBytes: 32768,
	outputBytes: 8192,
	fixtureDigest: artifactDigest(fixture),
});
export type VerificationResult = {
	verifierId: string;
	verifierVersion: string;
	fixtureDigest: string;
	artifactSnapshotId: string;
	state: string;
	verdict: "pass" | "fail" | "inconclusive";
	exitCode: number | null;
	signal: string | null;
	elapsedMs: number;
	checks: unknown[];
	error?: string;
	log: string;
	isolation: string;
};
const WORKER = `
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import net from "node:net";
const blocked = f => {try {f(); return false;} catch(e){return ["ERR_ACCESS_DENIED","EPERM","EACCES"].includes(e.code);}};
const guards = {read:blocked(()=>fs.readFileSync("/etc/passwd")),write:blocked(()=>fs.writeFileSync("/tmp/ae-forbidden","x")),spawn:blocked(()=>{const result=spawnSync("/usr/bin/true");if(result.error)throw result.error;})};
guards.network = await new Promise(resolve=>{const s=net.connect(9,"127.0.0.1");s.on("error",e=>resolve(e.code==="EPERM"||e.code==="EACCES"));s.on("connect",()=>{s.destroy();resolve(false)});});
if(Object.values(guards).some(v=>!v)) throw Error("isolation-probe-failed");
let input="";for await(const c of process.stdin){input+=c;if(Buffer.byteLength(input)>32768)throw Error("input-budget");}
const {snapshot,mode}=JSON.parse(input);
const fixture=${JSON.stringify(fixture)};
if(mode==="crash") throw Error("registered-verifier-crash");
if(mode==="timeout") {setInterval(()=>{},1000);await new Promise(()=>{});}
const entry=snapshot.entries.find(e=>e.path==="result.json"&&e.type==="file");
let valid=false;try{const v=JSON.parse(Buffer.from(entry?.contentBase64??"","base64").toString("utf8"));valid=v&&Object.keys(v).length===1&&v.answer===fixture.expected.answer;}catch{}
console.log(JSON.stringify({verdict:valid?"pass":"fail",checks:[{id:"result-json",pass:valid},{id:"isolation-probes",pass:true,guards}]}));
process.exitCode=valid?0:1;
`;
export async function verifyArtifacts(
	snapshot: ArtifactSnapshot,
	mode: "normal" | "crash" | "timeout" = "normal",
	signal?: AbortSignal,
): Promise<VerificationResult> {
	const began = performance.now();
	const { digest, ...body } = snapshot;
	const base = {
		verifierId: verifierManifest.id,
		verifierVersion: verifierManifest.version,
		fixtureDigest: verifierManifest.fixtureDigest,
		artifactSnapshotId: digest,
		isolation: verifierManifest.isolation,
	};
	const failure = (
		error: string,
		exitCode: number | null = null,
		signalValue: string | null = null,
		log = "",
	): VerificationResult => ({
		...base,
		state: "error",
		verdict: "inconclusive",
		error,
		exitCode,
		signal: signalValue,
		elapsedMs: performance.now() - began,
		checks: [],
		log: log.slice(0, 4096),
	});
	if (!snapshot.complete || artifactDigest(body) !== digest) return failure("artifact-snapshot-incomplete-or-changed");
	if (!["normal", "crash", "timeout"].includes(mode)) return failure("verifier-not-registered");
	if (process.platform !== "darwin") return failure("verifier-isolation-unavailable");
	const input = JSON.stringify({ snapshot, mode });
	if (Buffer.byteLength(input) > verifierManifest.inputBytes) return failure("verifier-input-budget");
	if (signal?.aborted) return failure("verifier-cancelled");
	return new Promise((resolve) => {
		// Seatbelt supplies the network denial that Node 22/23 permissions do not provide.
		const child = spawn(
			"/usr/bin/sandbox-exec",
			[
				"-p",
				`(version 1)(allow default)(deny network*)(deny file-write*)(deny process-fork)(deny file-read-data (require-all (subpath "/Users") (require-not (subpath ${JSON.stringify(dirname(dirname(realpathSync(process.execPath))))}))))(deny file-read-data (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/tmp") (subpath "/var/folders") (subpath "/Volumes") (literal "/etc/passwd") (literal "/private/etc/passwd"))`,
				process.execPath,
				...(process.versions.electron ? [] : ["--experimental-permission"]),
				"--max-old-space-size=32",
				"--disallow-code-generation-from-strings",
				...(process.versions.electron ? [] : ["--no-addons"]),
				"--no-warnings",
				"--input-type=module",
				"--eval",
				WORKER,
			],
			{
				stdio: ["pipe", "pipe", "pipe"],
				cwd: "/",
				env: { PATH: "/usr/bin:/bin", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
			},
		);
		let out = "",
			log = "",
			error: string | undefined;
		const stop = (reason: string) => {
			error ??= reason;
			child.kill("SIGKILL");
		};
		const abort = () => stop("verifier-cancelled");
		const timer = setTimeout(() => stop("verifier-timeout"), verifierManifest.timeoutMs);
		signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (c: Buffer) => {
			out += c.toString();
			if (Buffer.byteLength(out) > 8192) stop("verifier-output-budget");
			out = out.slice(0, 8192);
		});
		child.stderr.on("data", (c: Buffer) => {
			log += c.toString();
			if (Buffer.byteLength(log) > 8192) stop("verifier-output-budget");
			log = log.slice(0, 8192);
		});
		child.stdin.on("error", () => {});
		child.on("error", () => {
			error = "verifier-start-error";
		});
		child.on("close", (code, sig) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			if (error) return resolve(failure(error, code, sig, log));
			try {
				const value = JSON.parse(out);
				if (
					![0, 1].includes(code ?? -1) ||
					value.verdict !== (code === 0 ? "pass" : "fail") ||
					!Array.isArray(value.checks)
				)
					throw Error();
				resolve({
					...base,
					state: "completed",
					verdict: value.verdict,
					exitCode: code,
					signal: sig,
					elapsedMs: performance.now() - began,
					checks: value.checks,
					log: log.slice(0, 4096),
				});
			} catch {
				resolve(failure("verifier-crashed-or-invalid-output", code, sig, log));
			}
		});
		child.stdin.end(input);
	});
}
export const verifierCodeDigest = createHash("sha256").update(WORKER).digest("hex");
