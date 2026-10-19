import { describe, expect, it, vi } from "vitest";

import { createPushSender } from "./push";
import { must } from "./test-utils";

describe("integración dormida", () => {
	it("devuelve null sin EXPO_ACCESS_TOKEN", () => {
		expect(createPushSender({})).toBeNull();
	});
});

describe("sendPush (spec 05: solo metadatos)", () => {
	it("envía a Expo solo to/title/body/sound — jamás audio ni datos sensibles", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fakeFetch = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return { ok: true, status: 200 };
		}) as unknown as typeof fetch;

		const sender = createPushSender({ EXPO_ACCESS_TOKEN: "tok" }, fakeFetch);
		if (!sender) throw new Error("se esperaba sender");
		await sender.sendPush(["expo-a", "expo-b"], {
			title: "MeMu",
			body: "Tenés un mensaje nuevo en Familia",
		});

		expect(calls).toHaveLength(1);
		const call = must(calls[0], "llamada push");
		expect(call.url).toContain("exp.host");
		const payload = JSON.parse(call.init.body as string);
		expect(payload).toHaveLength(2);
		for (const msg of payload) {
			expect(Object.keys(msg).sort()).toEqual(["body", "sound", "title", "to"]);
			expect(msg.title).toBe("MeMu");
			expect(msg.body).toBe("Tenés un mensaje nuevo en Familia");
		}
		// Garantía dura: ni audio, ni transcripción, ni IDs internos viajan a Expo
		const raw = JSON.stringify(payload);
		expect(raw).not.toMatch(
			/\.wav|\.m4a|transcript|token|secret|messageId|groupId/i,
		);
	});

	it("con lista vacía no hace ningún request", async () => {
		const fakeFetch = vi.fn(async () => ({
			ok: true,
			status: 200,
		})) as unknown as typeof fetch;
		const sender = createPushSender({ EXPO_ACCESS_TOKEN: "tok" }, fakeFetch);
		if (!sender) throw new Error("se esperaba sender");
		await sender.sendPush([], { title: "T", body: "B" });
		expect(fakeFetch).not.toHaveBeenCalled();
	});

	it("si Expo responde error, lanza (el caller lo loguea, no crashea)", async () => {
		const fakeFetch = (async () => ({
			ok: false,
			status: 500,
		})) as unknown as typeof fetch;
		const sender = createPushSender({ EXPO_ACCESS_TOKEN: "tok" }, fakeFetch);
		if (!sender) throw new Error("se esperaba sender");
		await expect(
			sender.sendPush(["expo-a"], { title: "T", body: "B" }),
		).rejects.toThrow(/500/);
	});
});
