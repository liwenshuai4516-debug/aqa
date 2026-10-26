/** Administrator-only enrollment; requires an explicit application and trusted signed helper. */
import { resolve, join } from "node:path";
import { realpathSync, lstatSync } from "node:fs";
import { enrollOfflineRuntime } from "../dist/server/external-evaluation-enrollment.js";
const values = {},
	args = process.argv.slice(2);
for (let n = 0; n < args.length; n += 2) {
	if (
		!["--data-dir", "--helper", "--kernel", "--initrd"].includes(args[n]) ||
		!args[n + 1] ||
		args[n + 1].startsWith("--") ||
		values[args[n]]
	)
		throw new Error(
			"Usage: enroll-agent-evaluation-runtime.mjs --data-dir <application data> --helper <trusted signed helper> --kernel <pinned kernel> --initrd <pinned initrd>",
		);
	values[args[n]] = resolve(args[n + 1]);
}
if (Object.keys(values).length !== 4)
	throw new Error("Explicit data directory, helper, kernel and initrd are required");
for (const name of ["--helper", "--kernel", "--initrd"]) {
	if (!lstatSync(values[name]).isFile())
		throw new Error("Enrollment input must be a regular file, not a link or device");
}
const result = enrollOfflineRuntime(
	values["--data-dir"],
	{
		binary: realpathSync(values["--helper"]),
		kernel: realpathSync(values["--kernel"]),
		initrd: realpathSync(values["--initrd"]),
	},
	realpathSync(join(values["--data-dir"], "plugins/agent-evaluation/runtime")),
);
console.log(
	JSON.stringify({
		status: "enrolled",
		fingerprint: result.fingerprint,
		runtimeRoot: result.runtimeRoot,
		version: result.guest.version,
		modelAccess: false,
	}),
);
