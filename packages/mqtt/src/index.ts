/**
 * @memu/mqtt — Señalización liviana para los aparatos.
 *
 * Solo lleva avisos de control ("hay audio nuevo en el grupo X"), NUNCA los
 * audios. Cada aparato se suscribe únicamente al tópico de su grupo
 * (aislamiento por groupId, spec 05: sin wildcards entre grupos).
 *
 * Integración dormida: sin MQTT_URL, `createMqttPublisher` devuelve null y
 * quien lo usa hace no-op con log.
 */
import mqtt from "mqtt";

export type MqttEnv = {
	MQTT_URL?: string;
	MQTT_USERNAME?: string;
	MQTT_PASSWORD?: string;
};

/** Tópico de avisos de un grupo. El aparato solo ve su grupo. */
export function groupTopic(groupId: string): string {
	if (
		!groupId ||
		groupId.includes("/") ||
		groupId.includes("+") ||
		groupId.includes("#")
	) {
		throw new Error(
			`groupId inválido para tópico MQTT: ${JSON.stringify(groupId)}`,
		);
	}
	return `memu/grupos/${groupId}/avisos`;
}

export type GroupNotificationPayload = {
	messageId: string;
	groupId: string;
	sentAt: string; // ISO
};

/**
 * Payload MÍNIMO del aviso. Nunca incluye audio, transcripciones ni
 * metadatos sensibles: el aparato pide el detalle por HTTPS autenticado.
 */
export function buildNotificationPayload(
	messageId: string,
	groupId: string,
	sentAt: Date = new Date(),
): GroupNotificationPayload {
	return { messageId, groupId, sentAt: sentAt.toISOString() };
}

export type MqttPublisher = {
	publishGroupNotification(input: {
		groupId: string;
		messageId: string;
	}): Promise<void>;
	close(): Promise<void>;
};

type ConnectFn = (
	url: string,
	opts?: mqtt.IClientOptions,
) => Pick<mqtt.MqttClient, "publish" | "end" | "once">;

/**
 * Crea el publicador MQTT, o null si la integración está dormida.
 * `connect` es inyectable para tests (por defecto, el cliente real).
 * Publica con QoS 1: el broker reintenta hasta confirmar (spec: no se
 * pierde el aviso del LED).
 */
export function createMqttPublisher(
	env: MqttEnv,
	connect: ConnectFn = mqtt.connect,
): MqttPublisher | null {
	if (!env.MQTT_URL) {
		return null;
	}

	let client: Pick<mqtt.MqttClient, "publish" | "end" | "once"> | null = null;
	let connecting: Promise<void> | null = null;

	async function ensureConnected(): Promise<
		Pick<mqtt.MqttClient, "publish" | "end" | "once">
	> {
		if (client) return client;
		if (!connecting) {
			connecting = new Promise<void>((resolve, reject) => {
				const c = connect(env.MQTT_URL as string, {
					username: env.MQTT_USERNAME || undefined,
					password: env.MQTT_PASSWORD || undefined,
					reconnectPeriod: 2000,
				});
				c.once("connect", () => {
					client = c;
					resolve();
				});
				c.once("error", (err) => {
					connecting = null;
					reject(err);
				});
			});
		}
		await connecting;
		if (!client) {
			throw new Error("No se pudo conectar al broker MQTT");
		}
		return client;
	}

	return {
		async publishGroupNotification({ groupId, messageId }) {
			const c = await ensureConnected();
			const topic = groupTopic(groupId);
			const payload = JSON.stringify(
				buildNotificationPayload(messageId, groupId),
			);
			await new Promise<void>((resolve, reject) => {
				c.publish(topic, payload, { qos: 1 }, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		},
		async close() {
			if (client) {
				await client.end();
				client = null;
				connecting = null;
			}
		},
	};
}
