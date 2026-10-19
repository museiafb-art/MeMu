import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { group, member, voiceMessage } from "@memu/db/schema/memu";
import type { StorageClient } from "@memu/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, must } from "./test-utils";
import {
	ffmpegConverter,
	runTranscodeWithRetry,
	transcodeVoiceMessage,
} from "./transcode";

const execFileAsync = promisify(execFile);

/** Storage falso en memoria + fetch interceptado para URLs memu:// */
function createFakeStorage() {
	const files = new Map<string, Uint8Array>();
	const storage: StorageClient = {
		bucket: "test",
		getPresignedPutUrl: async (key) => `memu://put/${key}`,
		getPresignedGetUrl: async (key) => `memu://get/${key}`,
		putObject: async (key, body) => {
			files.set(
				key,
				typeof body === "string"
					? new TextEncoder().encode(body)
					: new Uint8Array(body),
			);
		},
		deleteObject: async (key) => {
			files.delete(key);
		},
	};
	const fetchStub = (async (
		input: string,
		init?: { method?: string; body?: unknown },
	) => {
		const m = /^memu:\/\/([^/]+)\/(.+)$/.exec(input);
		if (!m) throw new Error(`URL inesperada en test: ${input}`);
		const op = must(m[1], "operación");
		const key = must(m[2], "clave");
		if (op === "get") {
			const data = files.get(key);
			if (!data) {
				return {
					ok: false,
					status: 404,
					arrayBuffer: async () => new ArrayBuffer(0),
				};
			}
			const copy = new Uint8Array(data);
			return { ok: true, status: 200, arrayBuffer: async () => copy.buffer };
		}
		files.set(key, new Uint8Array((init?.body as Uint8Array) ?? []));
		return { ok: true, status: 200 };
	}) as unknown as typeof fetch;
	return { storage, files, fetchStub };
}

function leftoverTmpDirs(): string[] {
	return readdirSync(tmpdir()).filter((d) => d.startsWith("memu-transcode-"));
}

const WAV_PATH = join(tmpdir(), "memu-test-input.wav");

beforeAll(async () => {
	// WAV sintetizado de 1s con ffmpeg (tono de 440 Hz)
	await execFileAsync("ffmpeg", [
		"-y",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=1",
		"-ar",
		"16000",
		"-ac",
		"1",
		WAV_PATH,
	]);
	vi.stubGlobal("fetch", undefined as never); // se setea por test
});

afterAll(() => {
	vi.unstubAllGlobals();
});

async function seedMessage(
	db: ReturnType<typeof createTestDb>,
	storageKey: string,
) {
	const { user } = await import("@memu/db/schema/auth");
	await db.insert(user).values({ id: "u1", name: "Test", email: "t@x.com" });
	const g = must(
		(await db.insert(group).values({ name: "Familia" }).returning())[0],
	);
	const mem = must(
		(
			await db
				.insert(member)
				.values({ groupId: g.id, memberType: "person", userId: "u1" })
				.returning()
		)[0],
	);
	const msg = must(
		(
			await db
				.insert(voiceMessage)
				.values({
					groupId: g.id,
					senderMemberId: mem.id,
					storageKey,
					durationSeconds: 1,
				})
				.returning()
		)[0],
	);
	return { g, msg };
}

describe("transcodeVoiceMessage con ffmpeg real", () => {
	it("convierte WAV→M4A, actualiza la base, borra el original y limpia el tmp", async () => {
		const db = createTestDb();
		const { storage, files, fetchStub } = createFakeStorage();
		vi.stubGlobal("fetch", fetchStub);

		const { readFile } = await import("node:fs/promises");
		const wavBytes = await readFile(WAV_PATH);
		const key = "audio/g1/m1.wav";
		files.set(key, new Uint8Array(wavBytes));
		const { g, msg } = await seedMessage(db, key);

		const before = leftoverTmpDirs();
		const outputKey = await transcodeVoiceMessage(
			{ storage, db },
			{ messageId: msg.id, groupId: g.id, storageKey: key },
		);

		expect(outputKey).toBe("audio/g1/m1.m4a");
		const out = files.get(outputKey);
		if (!out) throw new Error("se esperaba archivo transcodificado");
		expect(out.length).toBeGreaterThan(0);
		// firma de contenedor MP4/M4A ("ftyp")
		expect(Buffer.from(out.subarray(4, 8)).toString()).toBe("ftyp");

		// la base ahora apunta al transcodificado…
		const rows = await db
			.select()
			.from(voiceMessage)
			.where(eq(voiceMessage.id, msg.id));
		expect(must(rows[0]).storageKey).toBe(outputKey);
		// …y el WAV original ya no existe (sin copias persistentes)
		expect(files.has(key)).toBe(false);
		// tmp limpio
		expect(leftoverTmpDirs()).toEqual(before);
	});
});

describe("transcodeVoiceMessage con conversor falso", () => {
	it("el flujo completo funciona con el conversor inyectado", async () => {
		const db = createTestDb();
		const { storage, files, fetchStub } = createFakeStorage();
		vi.stubGlobal("fetch", fetchStub);

		const key = "audio/g1/m2.wav";
		files.set(key, new Uint8Array([1, 2, 3, 4]));
		const { g, msg } = await seedMessage(db, key);

		const convert = vi.fn(async (input: string, output: string) => {
			const { copyFile } = await import("node:fs/promises");
			await copyFile(input, output);
		});
		const outputKey = await transcodeVoiceMessage(
			{ storage, db, convert },
			{ messageId: msg.id, groupId: g.id, storageKey: key },
		);
		expect(outputKey).toBe("audio/g1/m2.m4a");
		expect(convert).toHaveBeenCalledTimes(1);
		expect(files.has(key)).toBe(false);
		const rows = await db
			.select()
			.from(voiceMessage)
			.where(eq(voiceMessage.id, msg.id));
		expect(must(rows[0]).storageKey).toBe(outputKey);
	});
});

describe("runTranscodeWithRetry", () => {
	it("reintenta con tope y tiene éxito si el conversor se recupera", async () => {
		const db = createTestDb();
		const { storage, files, fetchStub } = createFakeStorage();
		vi.stubGlobal("fetch", fetchStub);
		const key = "audio/g1/m3.wav";
		files.set(key, new Uint8Array([9, 9, 9]));
		const { g, msg } = await seedMessage(db, key);

		let attempts = 0;
		const convert = async (input: string, output: string) => {
			attempts += 1;
			if (attempts < 3) throw new Error("fallo transitorio");
			const { copyFile } = await import("node:fs/promises");
			await copyFile(input, output);
		};
		await runTranscodeWithRetry(
			{ storage, db, convert },
			{ messageId: msg.id, groupId: g.id, storageKey: key },
			{ maxAttempts: 3, baseDelayMs: 5 },
		);
		expect(attempts).toBe(3);
		expect(files.has("audio/g1/m3.m4a")).toBe(true);
	});

	it("agotados los intentos hace dead-letter y conserva el original", async () => {
		const db = createTestDb();
		const { storage, files, fetchStub } = createFakeStorage();
		vi.stubGlobal("fetch", fetchStub);
		const key = "audio/g1/m4.wav";
		files.set(key, new Uint8Array([7, 7]));
		const { g, msg } = await seedMessage(db, key);

		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		let attempts = 0;
		await runTranscodeWithRetry(
			{
				storage,
				db,
				convert: async () => {
					attempts += 1;
					throw new Error("siempre falla");
				},
			},
			{ messageId: msg.id, groupId: g.id, storageKey: key },
			{ maxAttempts: 2, baseDelayMs: 5 },
		);
		expect(attempts).toBe(2); // tope, nunca infinito
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining("dead-letter"),
			expect.anything(),
		);
		// el original se conserva: no se pierde ningún audio
		expect(files.has(key)).toBe(true);
		const rows = await db
			.select()
			.from(voiceMessage)
			.where(eq(voiceMessage.id, msg.id));
		expect(must(rows[0]).storageKey).toBe(key);
		errSpy.mockRestore();
	});
});

describe("ffmpegConverter", () => {
	it("está disponible en esta VM", async () => {
		// sanity: el conversor por defecto existe como función
		expect(typeof ffmpegConverter).toBe("function");
	});
});
