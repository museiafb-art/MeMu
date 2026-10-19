import { describe, expect, it, vi } from "vitest";

import {
	buildNotificationPayload,
	createMqttPublisher,
	groupTopic,
} from "./index";

describe("tópicos", () => {
	it("usa el formato memu/grupos/<groupId>/avisos", () => {
		expect(groupTopic("abc123")).toBe("memu/grupos/abc123/avisos");
	});

	it("rechaza groupIds que permitirían escapar o usar wildcards", () => {
		expect(() => groupTopic("a/b")).toThrow();
		expect(() => groupTopic("a+b")).toThrow();
		expect(() => groupTopic("#")).toThrow();
		expect(() => groupTopic("")).toThrow();
	});
});

describe("payload mínimo", () => {
	it("solo lleva messageId, groupId y sentAt — nada sensible", () => {
		const payload = buildNotificationPayload(
			"m1",
			"g1",
			new Date("2026-10-19T10:00:00Z"),
		);
		expect(payload).toEqual({
			messageId: "m1",
			groupId: "g1",
			sentAt: "2026-10-19T10:00:00.000Z",
		});
		expect(Object.keys(payload).sort()).toEqual([
			"groupId",
			"messageId",
			"sentAt",
		]);
	});
});

describe("integración dormida", () => {
	it("devuelve null sin MQTT_URL (no-op con log en quien lo usa)", () => {
		expect(createMqttPublisher({})).toBeNull();
	});
});

describe("publicación (broker falso)", () => {
	it("publica en el tópico del grupo con QoS 1 y payload mínimo", async () => {
		const published: Array<{ topic: string; payload: string; opts: unknown }> =
			[];
		const fakeClient = {
			publish: (
				topic: string,
				payload: string,
				opts: unknown,
				cb: (err?: Error) => void,
			) => {
				published.push({ topic, payload, opts });
				cb();
			},
			end: vi.fn(async () => {}),
			once: (event: string, cb: () => void) => {
				if (event === "connect") queueMicrotask(cb);
			},
		};
		const maybe = createMqttPublisher(
			{ MQTT_URL: "mqtt://fake" },
			(() => fakeClient) as never,
		);
		if (!maybe) throw new Error("se esperaba publisher");
		const publisher = maybe;

		await publisher.publishGroupNotification({
			groupId: "g1",
			messageId: "m1",
		});

		expect(published).toHaveLength(1);
		const first = published[0];
		if (!first) throw new Error("se esperaba una publicación");
		expect(first.topic).toBe("memu/grupos/g1/avisos");
		expect(first.opts).toMatchObject({ qos: 1 });
		const body = JSON.parse(first.payload);
		expect(body.messageId).toBe("m1");
		expect(body.groupId).toBe("g1");
		expect(typeof body.sentAt).toBe("string");
		// Nunca audio ni metadatos sensibles en el aviso
		expect(first.payload).not.toMatch(/audio|transcript|token|secret/i);

		await publisher.close();
		expect(fakeClient.end).toHaveBeenCalled();
	});
});
