import { user } from "@memu/db/schema/auth";
import {
	group,
	listenReceipt,
	member,
	voiceMessage,
} from "@memu/db/schema/memu";
import { createStorageClient } from "@memu/storage";
import { call } from "@orpc/server";
import { beforeEach, describe, expect, it } from "vitest";

import type { Context } from "../context";
import { generateDeviceToken, hashDeviceToken } from "../device-auth";
import { resetServices, services } from "../services";
import { createTestDb, must } from "../test-utils";
import { voiceRouter } from "./voice";

const ctx = (overrides: Partial<Context> = {}): Context =>
	({
		db: null,
		session: null,
		device: null,
		...overrides,
	}) as unknown as Context;

type TestDb = ReturnType<typeof createTestDb>;

async function seedTwoGroups(db: TestDb) {
	const sofi = must(
		(
			await db
				.insert(user)
				.values({
					id: "u-sofi",
					name: "Sofi",
					email: "sofi@x.com",
					pushToken: "expo-sofi",
				})
				.returning()
		)[0],
	);
	const abuela = must(
		(
			await db
				.insert(user)
				.values({
					id: "u-abuela",
					name: "Abuela",
					email: "abuela@x.com",
					pushToken: "expo-abuela",
				})
				.returning()
		)[0],
	);
	const vecino = must(
		(
			await db
				.insert(user)
				.values({ id: "u-vecino", name: "Vecino", email: "vecino@x.com" })
				.returning()
		)[0],
	);
	const familia = must(
		(await db.insert(group).values({ name: "Familia" }).returning())[0],
	);
	const vecinos = must(
		(await db.insert(group).values({ name: "Vecinos" }).returning())[0],
	);
	await db.insert(member).values([
		{ groupId: familia.id, memberType: "person", userId: sofi.id },
		{ groupId: familia.id, memberType: "person", userId: abuela.id },
		{ groupId: vecinos.id, memberType: "person", userId: vecino.id },
	]);
	return { sofi, abuela, vecino, familia, vecinos };
}

const personCtx = (db: TestDb, userId: string) =>
	ctx({ db, session: { user: { id: userId } } as never });

const tick = () => new Promise((r) => setTimeout(r, 100));

beforeEach(() => {
	resetServices();
});

describe("requestUploadUrl", () => {
	it("una persona del grupo obtiene URL con clave bajo su prefijo", async () => {
		const db = createTestDb();
		const { sofi, familia } = await seedTwoGroups(db);
		services.storage = createStorageClient({
			S3_ENDPOINT: "https://bucket.test",
			S3_BUCKET: "memu-test",
			S3_ACCESS_KEY_ID: "t",
			S3_SECRET_ACCESS_KEY: "t",
		});

		const result = await call(
			voiceRouter.requestUploadUrl,
			{ groupId: familia.id, contentType: "audio/wav", contentLength: 1000 },
			{ context: personCtx(db, sofi.id) },
		);
		expect(result.storageKey.startsWith(`audio/${familia.id}/`)).toBe(true);
		expect(result.storageKey.endsWith(".wav")).toBe(true);
		expect(result.uploadUrl).toContain("memu-test");
		expect(result.expiresInSeconds).toBe(15 * 60);
	});

	it("un aparato con token válido también puede pedir URL", async () => {
		const db = createTestDb();
		const { familia } = await seedTwoGroups(db);
		services.storage = createStorageClient({
			S3_ENDPOINT: "https://bucket.test",
			S3_BUCKET: "memu-test",
			S3_ACCESS_KEY_ID: "t",
			S3_SECRET_ACCESS_KEY: "t",
		});
		// doy de alta un aparato a mano
		const {
			device,
			deviceToken,
			member: memberTable,
		} = await import("@memu/db/schema/memu");
		const dev = must(
			(await db.insert(device).values({ name: "Abuela" }).returning())[0],
		);
		const token = generateDeviceToken();
		const tokRow = must(
			(
				await db
					.insert(deviceToken)
					.values({ deviceId: dev.id, tokenHash: hashDeviceToken(token) })
					.returning()
			)[0],
		);
		await db
			.insert(memberTable)
			.values({ groupId: familia.id, memberType: "device", deviceId: dev.id });

		const context = ctx({
			db,
			device: { tokenId: tokRow.id, deviceId: dev.id },
		});
		const result = await call(
			voiceRouter.requestUploadUrl,
			{ groupId: familia.id, contentType: "audio/wav", contentLength: 1000 },
			{ context },
		);
		expect(result.storageKey.startsWith(`audio/${familia.id}/`)).toBe(true);
	});

	it("quien no es del grupo no puede pedir URL (FORBIDDEN) y sin auth tampoco", async () => {
		const db = createTestDb();
		const { vecino, familia } = await seedTwoGroups(db);
		services.storage = createStorageClient({
			S3_ENDPOINT: "https://bucket.test",
			S3_BUCKET: "memu-test",
			S3_ACCESS_KEY_ID: "t",
			S3_SECRET_ACCESS_KEY: "t",
		});
		const input = {
			groupId: familia.id,
			contentType: "audio/wav",
			contentLength: 1000,
		};
		await expect(
			call(voiceRouter.requestUploadUrl, input, {
				context: personCtx(db, vecino.id),
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			call(voiceRouter.requestUploadUrl, input, { context: ctx({ db }) }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("valida MIME y tamaño", async () => {
		const db = createTestDb();
		const { sofi, familia } = await seedTwoGroups(db);
		services.storage = createStorageClient({
			S3_ENDPOINT: "https://bucket.test",
			S3_BUCKET: "memu-test",
			S3_ACCESS_KEY_ID: "t",
			S3_SECRET_ACCESS_KEY: "t",
		});
		const context = personCtx(db, sofi.id);
		await expect(
			call(
				voiceRouter.requestUploadUrl,
				{ groupId: familia.id, contentType: "video/mp4", contentLength: 100 },
				{ context },
			),
		).rejects.toThrow(/no permitido/);
		await expect(
			call(
				voiceRouter.requestUploadUrl,
				{
					groupId: familia.id,
					contentType: "audio/wav",
					contentLength: 100 * 1024 * 1024,
				},
				{ context },
			),
		).rejects.toThrow(/demasiado grande/);
	});

	it("sin storage configurado falla con mensaje claro (integración dormida)", async () => {
		const db = createTestDb();
		const { sofi, familia } = await seedTwoGroups(db);
		// services.storage queda null (resetServices en beforeEach)
		await expect(
			call(
				voiceRouter.requestUploadUrl,
				{ groupId: familia.id, contentType: "audio/wav", contentLength: 100 },
				{ context: personCtx(db, sofi.id) },
			),
		).rejects.toThrow(/dormida/);
	});
});

describe("registerVoiceMessage", () => {
	it("registra el mensaje y dispara MQTT + push (solo metadatos)", async () => {
		const db = createTestDb();
		const { sofi, familia } = await seedTwoGroups(db);

		const published: Array<{ groupId: string; messageId: string }> = [];
		services.mqtt = {
			publishGroupNotification: async (input) => {
				published.push(input);
			},
			close: async () => {},
		};
		const pushed: Array<{ tokens: string[]; title: string; body: string }> = [];
		services.push = {
			sendPush: async (tokens, n) => {
				pushed.push({ tokens, title: n.title, body: n.body });
			},
		};

		const storageKey = `audio/${familia.id}/abc123.m4a`; // .m4a: sin transcode
		const result = await call(
			voiceRouter.registerVoiceMessage,
			{ groupId: familia.id, storageKey, durationSeconds: 23 },
			{ context: personCtx(db, sofi.id) },
		);
		expect(result.id).toBeTruthy();

		const rows = await db.select().from(voiceMessage);
		expect(rows).toHaveLength(1);
		expect(must(rows[0]).storageKey).toBe(storageKey);
		expect(must(rows[0]).durationSeconds).toBe(23);

		await tick();
		expect(published).toHaveLength(1);
		expect(must(published[0])).toEqual({
			groupId: familia.id,
			messageId: result.id,
		});

		// push: a la abuela sí, a Sofi (remitente) no
		expect(pushed).toHaveLength(1);
		expect(must(pushed[0]).tokens).toEqual(["expo-abuela"]);
		expect(must(pushed[0]).title).toBe("MeMu");
		expect(must(pushed[0]).body).toContain("Familia");
		// metadatos solamente: nada de audio/transcripciones/ids internos
		expect(must(pushed[0]).body).not.toMatch(
			/\.wav|\.m4a|transcript|token|secret/i,
		);
	});

	it("rechaza claves fuera del prefijo del grupo", async () => {
		const db = createTestDb();
		const { sofi, familia, vecinos } = await seedTwoGroups(db);
		await expect(
			call(
				voiceRouter.registerVoiceMessage,
				{
					groupId: familia.id,
					storageKey: `audio/${vecinos.id}/otro.m4a`,
					durationSeconds: 5,
				},
				{ context: personCtx(db, sofi.id) },
			),
		).rejects.toThrow(/no pertenece al grupo/);
	});

	it("un no-miembro no puede registrar (FORBIDDEN)", async () => {
		const db = createTestDb();
		const { vecino, familia } = await seedTwoGroups(db);
		await expect(
			call(
				voiceRouter.registerVoiceMessage,
				{
					groupId: familia.id,
					storageKey: `audio/${familia.id}/x.m4a`,
					durationSeconds: 5,
				},
				{ context: personCtx(db, vecino.id) },
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("sin MQTT ni push configurados igual registra (integraciones dormidas)", async () => {
		const db = createTestDb();
		const { sofi, familia } = await seedTwoGroups(db);
		const result = await call(
			voiceRouter.registerVoiceMessage,
			{
				groupId: familia.id,
				storageKey: `audio/${familia.id}/x.m4a`,
				durationSeconds: 5,
			},
			{ context: personCtx(db, sofi.id) },
		);
		expect(result.id).toBeTruthy();
		await tick();
	});
});

describe("listMessages: aislamiento por groupId", () => {
	it("un usuario NO ve mensajes de otro grupo", async () => {
		const db = createTestDb();
		const { sofi, vecino, familia, vecinos } = await seedTwoGroups(db);

		await call(
			voiceRouter.registerVoiceMessage,
			{
				groupId: familia.id,
				storageKey: `audio/${familia.id}/a.m4a`,
				durationSeconds: 5,
			},
			{ context: personCtx(db, sofi.id) },
		);
		await call(
			voiceRouter.registerVoiceMessage,
			{
				groupId: vecinos.id,
				storageKey: `audio/${vecinos.id}/b.m4a`,
				durationSeconds: 7,
			},
			{ context: personCtx(db, vecino.id) },
		);

		const mine = await call(
			voiceRouter.listMessages,
			{ groupId: familia.id },
			{ context: personCtx(db, sofi.id) },
		);
		expect(mine).toHaveLength(1);
		expect(must(mine[0]).durationSeconds).toBe(5);
		expect(must(mine[0]).listenedByMe).toBe(false);

		// el vecino no puede ni listar el grupo Familia
		await expect(
			call(
				voiceRouter.listMessages,
				{ groupId: familia.id },
				{ context: personCtx(db, vecino.id) },
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("markListened", () => {
	it("marca escuchado y el pendingCount baja a 0 (maneja el LED)", async () => {
		const db = createTestDb();
		const { sofi, abuela, familia } = await seedTwoGroups(db);

		const { id } = await call(
			voiceRouter.registerVoiceMessage,
			{
				groupId: familia.id,
				storageKey: `audio/${familia.id}/a.m4a`,
				durationSeconds: 5,
			},
			{ context: personCtx(db, sofi.id) },
		);

		// la abuela todavía tiene 1 pendiente
		const r1 = await call(
			voiceRouter.markListened,
			{ messageId: id },
			{ context: personCtx(db, abuela.id) },
		);
		expect(r1.ok).toBe(true);
		expect(r1.pendingCount).toBe(0);

		// Sofi (remitente) también tiene 1 pendiente hasta escucharlo
		const r2 = await call(
			voiceRouter.markListened,
			{ messageId: id },
			{ context: personCtx(db, sofi.id) },
		);
		expect(r2.pendingCount).toBe(0);

		const receipts = await db.select().from(listenReceipt);
		expect(receipts).toHaveLength(2);

		// marcar dos veces no duplica (idempotente)
		await call(
			voiceRouter.markListened,
			{ messageId: id },
			{ context: personCtx(db, abuela.id) },
		);
		expect((await db.select().from(listenReceipt)).length).toBe(2);
	});

	it("no puedo marcar un mensaje de otro grupo", async () => {
		const db = createTestDb();
		const { sofi, vecino, familia } = await seedTwoGroups(db);
		const { id } = await call(
			voiceRouter.registerVoiceMessage,
			{
				groupId: familia.id,
				storageKey: `audio/${familia.id}/a.m4a`,
				durationSeconds: 5,
			},
			{ context: personCtx(db, sofi.id) },
		);
		await expect(
			call(
				voiceRouter.markListened,
				{ messageId: id },
				{ context: personCtx(db, vecino.id) },
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("setPushToken (opt-in)", () => {
	it("guarda el token de push del usuario", async () => {
		const db = createTestDb();
		const { vecino } = await seedTwoGroups(db);
		await call(
			voiceRouter.setPushToken,
			{ token: "expo-nuevo" },
			{ context: personCtx(db, vecino.id) },
		);
		const rows = await db.select().from(user);
		const v = rows.find((r) => r.id === vecino.id);
		expect(v?.pushToken).toBe("expo-nuevo");
	});

	it("sin sesión no se puede (UNAUTHORIZED)", async () => {
		const db = createTestDb();
		await expect(
			call(voiceRouter.setPushToken, { token: "x" }, { context: ctx({ db }) }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
