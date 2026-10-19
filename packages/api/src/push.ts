/**
 * Push a celulares vía Expo.
 *
 * REGLA DE PRIVACIDAD (spec 05, no negociable): solo metadatos. El tipo de
 * `sendPush` solo acepta `title`/`body` como strings: es imposible pasarle
 * un audio, una transcripción o IDs internos por construcción. Además las
 * notificaciones pasan por servidores de Expo (EE.UU.), informado en la
 * política de privacidad.
 *
 * Sin EXPO_ACCESS_TOKEN la integración está dormida (null → no-op con log).
 */
export type PushEnv = {
	EXPO_ACCESS_TOKEN?: string;
};

export type PushNotification = {
	title: string;
	body: string;
};

export type PushSender = {
	sendPush: (tokens: string[], notification: PushNotification) => Promise<void>;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export function createPushSender(
	env: PushEnv,
	fetchFn: typeof fetch = fetch,
): PushSender | null {
	const token = env.EXPO_ACCESS_TOKEN;
	if (!token) {
		return null;
	}
	return {
		async sendPush(tokens: string[], notification: PushNotification) {
			const clean = tokens.filter(Boolean);
			if (clean.length === 0) return;
			const { title, body } = notification;
			if (typeof title !== "string" || typeof body !== "string") {
				throw new Error(
					"Push: title y body deben ser strings (solo metadatos)",
				);
			}
			const res = await fetchFn(EXPO_PUSH_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				// Solo metadatos: to/title/body/sound. Nada más viaja a Expo.
				body: JSON.stringify(
					clean.map((to) => ({ to, title, body, sound: "default" })),
				),
			});
			if (!res.ok) {
				throw new Error(`Expo push falló con status ${res.status}`);
			}
		},
	};
}
