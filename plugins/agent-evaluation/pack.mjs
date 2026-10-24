/** Physical evidence packing only. Logical records, digests and receipts stay unchanged. */
import { requireValue } from "./schema.mjs";
const MAGIC = Buffer.from("AEVPACK1");
const safe = (n) => Number.isSafeInteger(n) && n >= 0;

export function encodePack(items, limits) {
	const bodies = [],
		manifest = [],
		index = [],
		blobs = new Map();
	let bodySize = 0;
	for (const item of items) {
		if (item.content === undefined) continue;
		const hash = item.record.contentRef.sha256;
		if (!blobs.has(hash)) {
			const size = item.record.contentRef.size;
			blobs.set(hash, { offset: 16 + bodySize, length: size });
			bodies.push(item.content);
			bodySize += size;
		}
	}
	const header = Buffer.alloc(16);
	MAGIC.copy(header);
	header.writeBigUInt64LE(BigInt(bodySize), 8);
	let offset = 16 + bodySize;
	for (const item of items) {
		const size = Buffer.byteLength(item.bytes),
			blob = blobs.get(item.record.contentRef?.sha256);
		index.push([offset, size, blob?.offset ?? null, blob?.length ?? 0]);
		manifest.push(item.bytes);
		offset += size;
	}
	const table = Buffer.from(JSON.stringify(index)),
		footer = Buffer.alloc(8);
	footer.writeBigUInt64LE(BigInt(table.length));
	const size = offset + table.length + 8;
	requireValue(
		table.length <= limits.recordBytes && size <= limits.readBytes,
		"LIMIT_EXCEEDED",
		"Evidence pack exceeds bounded batch budget",
	);
	return { body: [header, ...bodies], manifest: [...manifest, table, footer], index, size };
}

export function readPackIndex(read, fileSize, limits) {
	requireValue(fileSize >= 26 && fileSize <= limits.readBytes, "STORE_CORRUPT", "Invalid evidence pack size");
	const header = read(0, 16),
		footer = read(fileSize - 8, 8);
	requireValue(header.subarray(0, 8).equals(MAGIC), "SCHEMA_UNSUPPORTED", "Unknown evidence pack format");
	const bodySize = Number(header.readBigUInt64LE(8)),
		tableSize = Number(footer.readBigUInt64LE());
	requireValue(
		safe(bodySize) && safe(tableSize) && tableSize > 0 && tableSize <= limits.recordBytes && tableSize <= fileSize - 24,
		"STORE_CORRUPT",
		"Invalid evidence pack index size",
	);
	const tableStart = fileSize - 8 - tableSize,
		bodyEnd = 16 + bodySize;
	requireValue(bodyEnd <= tableStart, "STORE_CORRUPT", "Invalid evidence pack body size");
	let index;
	try {
		index = JSON.parse(read(tableStart, tableSize).toString("utf8"));
	} catch {
		requireValue(false, "STORE_CORRUPT", "Malformed evidence pack index");
	}
	requireValue(
		Array.isArray(index) && index.length > 0 && index.length <= limits.snapshotItems,
		"STORE_CORRUPT",
		"Invalid evidence pack count",
	);
	let offset = bodyEnd;
	const blobs = new Map();
	for (const entry of index) {
		requireValue(Array.isArray(entry) && entry.length === 4, "STORE_CORRUPT", "Invalid evidence pack entry");
		const [start, size, blobStart, blobSize] = entry;
		requireValue(
			safe(start) &&
				safe(size) &&
				size > 0 &&
				size <= limits.recordBytes &&
				start === offset &&
				start + size <= tableStart,
			"STORE_CORRUPT",
			"Invalid packed record range",
		);
		offset += size;
		requireValue(
			safe(blobSize) &&
				blobSize <= limits.evidenceBytes &&
				(blobStart === null ? blobSize === 0 : safe(blobStart) && blobStart >= 16 && blobStart + blobSize <= bodyEnd),
			"STORE_CORRUPT",
			"Invalid packed body range",
		);
		if (blobStart !== null && blobSize > 0) {
			requireValue(
				!blobs.has(blobStart) || blobs.get(blobStart) === blobSize,
				"STORE_CORRUPT",
				"Conflicting packed body range",
			);
			blobs.set(blobStart, blobSize);
		}
	}
	requireValue(offset === tableStart, "STORE_CORRUPT", "Unindexed packed record bytes");
	let bodyOffset = 16;
	for (const [start, size] of [...blobs].sort(([a], [b]) => a - b)) {
		requireValue(start === bodyOffset, "STORE_CORRUPT", "Overlapping or unindexed packed body bytes");
		bodyOffset += size;
	}
	requireValue(bodyOffset === bodyEnd, "STORE_CORRUPT", "Unindexed evidence pack body bytes");
	return index;
}
