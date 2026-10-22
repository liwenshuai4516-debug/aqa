/** Local Markdown destinations use the existing file preview, never browser navigation. */
export function fileLinkPath(href: string): string | null {
	let path = href.trim();
	if (!path || path.startsWith("#") || path.startsWith("//")) return null;
	const internal = path.startsWith("pi-file://");
	if (internal) path = path.slice("pi-file://".length);
	else if (/^file:/i.test(path)) {
		try {
			const url = new URL(path);
			if (url.hostname && url.hostname !== "localhost") return null;
			path = url.pathname;
			if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
		} catch {
			return null;
		}
	} else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
	// Strip reference locations before decoding, so encoded #/? remain part of a filename.
	path = path.split(/[?#]/, 1)[0].replace(/:\d+(?::\d+)?$/, "");
	try {
		path = decodeURIComponent(path);
	} catch {
		return null;
	}
	if (!path || [...path].some((char) => char.charCodeAt(0) < 32) || path.startsWith("//")) return null;
	path = path.replace(/\\/g, "/");
	if (path.startsWith("//") || path.endsWith("/")) return null;
	const name = path.split("/").pop() ?? "";
	if (!internal && !/\.[^./]+$/.test(name) && !/^(LICENSE|NOTICE|Dockerfile|Makefile)$/i.test(name)) return null;
	// Match the server's echoed normalized path, including ./docs/../file.md.
	const prefix = path.startsWith("/") ? "/" : "";
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (!part || part === ".") continue;
		if (part === ".." && parts.length && parts.at(-1) !== ".." && !/^[a-z]:$/i.test(parts.at(-1)!)) {
			parts.pop();
		} else if (part !== ".." || !prefix) parts.push(part);
	}
	return prefix + parts.join("/") || null;
}
