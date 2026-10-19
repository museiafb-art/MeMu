import { describe, expect, it } from "vitest";

import {
	ALLOWED_AUDIO_MIME_TYPES,
	assertAllowedMimeType,
	assertSafeKey,
	createStorageClient,
	MAX_AUDIO_BYTES,
	PRESIGNED_URL_TTL_SECONDS,
	requireStorageClient,
	StorageDormantError,
} from "./index";

function mustClient(
	v: ReturnType<typeof createStorageClient>,
): NonNullable<typeof v> {
	if (!v) throw new Error("se esperaba cliente de storage");
	return v;
}

const ENV = {
	S3_ENDPOINT: "https://bucket.test",
	S3_REGION: "auto",
	S3_BUCKET: "memu-test",
	S3_ACCESS_KEY_ID: "test",
	S3_SECRET_ACCESS_KEY: "test",
};

describe("integración dormida", () => {
	it("devuelve null sin S3_ENDPOINT ni S3_BUCKET", () => {
		expect(createStorageClient({})).toBeNull();
		expect(createStorageClient({ S3_ENDPOINT: "https://x" })).toBeNull();
		expect(createStorageClient({ S3_BUCKET: "b" })).toBeNull();
	});

	it("requireStorageClient lanza un error claro, nunca un crash", () => {
		expect(() => requireStorageClient(null)).toThrow(StorageDormantError);
		expect(() => requireStorageClient(null)).toThrow(/dormida/);
	});
});

describe("validaciones", () => {
	it("la expiración de URLs prefirmadas es 15 minutos (spec 05)", () => {
		expect(PRESIGNED_URL_TTL_SECONDS).toBe(15 * 60);
	});

	it("hay límite de tamaño de subida (lección 06)", () => {
		expect(MAX_AUDIO_BYTES).toBe(25 * 1024 * 1024);
	});

	it("rechaza claves que intentan escapar del prefijo", () => {
		expect(() => assertSafeKey("../secreto")).toThrow();
		expect(() => assertSafeKey("/absoluta")).toThrow();
		expect(() => assertSafeKey("")).toThrow();
		expect(() => assertSafeKey("audio/grupo1/x.wav")).not.toThrow();
	});

	it("rechaza MIME types fuera de la lista", () => {
		expect(() => assertAllowedMimeType("video/mp4")).toThrow();
		expect(() => assertAllowedMimeType("audio/wav")).not.toThrow();
		expect(ALLOWED_AUDIO_MIME_TYPES).toContain("audio/wav");
		expect(ALLOWED_AUDIO_MIME_TYPES).toContain("audio/mp4");
	});
});

describe("URLs prefirmadas (firmado local, sin red)", () => {
	it("genera PUT firmada con expiración de 15 min", async () => {
		const client = mustClient(createStorageClient(ENV));
		const url = await client.getPresignedPutUrl(
			"audio/grupo1/m1.wav",
			"audio/wav",
		);
		expect(url).toContain("memu-test");
		expect(url).toContain("audio/grupo1/m1.wav");
		// X-Amz-Expires refleja los 15 minutos
		expect(url).toMatch(/X-Amz-Expires=900/);
	});

	it("genera GET firmada", async () => {
		const client = mustClient(createStorageClient(ENV));
		const url = await client.getPresignedGetUrl("audio/grupo1/m1.m4a");
		expect(url).toContain("audio/grupo1/m1.m4a");
		expect(url).toMatch(/X-Amz-Expires=900/);
	});

	it("no firma claves inválidas ni MIME no permitidos", async () => {
		const client = mustClient(createStorageClient(ENV));
		await expect(
			client.getPresignedPutUrl("../x", "audio/wav"),
		).rejects.toThrow();
		await expect(
			client.getPresignedPutUrl("audio/g/m.wav", "video/mp4"),
		).rejects.toThrow();
	});
});

describe("put/delete con sender inyectado", () => {
	it("putObject envía el comando correcto", async () => {
		const sent: Array<{ name: string; input: unknown }> = [];
		const client = mustClient(
			createStorageClient(ENV, {
				send: async (command: unknown) => {
					sent.push({
						name: (command as { constructor: { name: string } }).constructor
							.name,
						input: (command as { input: unknown }).input,
					});
					return {};
				},
			}),
		);
		await client.putObject(
			"audio/g/m.wav",
			new Uint8Array([1, 2, 3]),
			"audio/wav",
		);
		expect(sent).toHaveLength(1);
		const first = sent[0];
		if (!first) throw new Error("se esperaba un comando enviado");
		expect(first.name).toBe("PutObjectCommand");
		expect(first.input).toMatchObject({
			Bucket: "memu-test",
			Key: "audio/g/m.wav",
			ContentType: "audio/wav",
		});
	});

	it("deleteObject envía el comando correcto", async () => {
		const sent: string[] = [];
		const client = mustClient(
			createStorageClient(ENV, {
				send: async (command: unknown) => {
					sent.push(
						(command as { constructor: { name: string } }).constructor.name,
					);
					return {};
				},
			}),
		);
		await client.deleteObject("audio/g/viejo.wav");
		expect(sent).toEqual(["DeleteObjectCommand"]);
	});
});
