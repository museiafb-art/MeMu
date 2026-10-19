/**
 * Servicios externos de la API como singletons inyectables.
 *
 * En producción se inicializan desde las envs con `initServicesFromEnv`
 * (cada integración queda dormida —null— sin su env, spec 06). En tests se
 * reemplazan directamente por fakes: `services.mqtt = fakeMqtt`.
 */

import type { MqttEnv, MqttPublisher } from "@memu/mqtt";
import { createMqttPublisher } from "@memu/mqtt";
import type { StorageClient, StorageEnv } from "@memu/storage";
import { createStorageClient } from "@memu/storage";
import type { PushEnv, PushSender } from "./push";
import { createPushSender } from "./push";

export type Services = {
	storage: StorageClient | null;
	mqtt: MqttPublisher | null;
	push: PushSender | null;
};

export const services: Services = {
	storage: null,
	mqtt: null,
	push: null,
};

export type ServicesEnv = StorageEnv & MqttEnv & PushEnv;

/** Inicializa los servicios desde envs (idempotente). Sin env → dormidos. */
export function initServicesFromEnv(env: ServicesEnv): Services {
	if (!services.storage) {
		services.storage = createStorageClient(env);
	}
	if (!services.mqtt) {
		services.mqtt = createMqttPublisher(env);
	}
	if (!services.push) {
		services.push = createPushSender(env);
	}
	return services;
}

/** Resetea los servicios (tests). */
export function resetServices(): void {
	services.storage = null;
	services.mqtt = null;
	services.push = null;
}
