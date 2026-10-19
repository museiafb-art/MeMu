/**
 * @memu/storage — Cliente del bucket privado de audios (R2 en producción,
 * MinIO en local). Todo el acceso es con URLs prefirmadas de 15 minutos o
 * con el cliente autenticado; el bucket nunca es público.
 *
 * Integración dormida: si faltan S3_ENDPOINT o S3_BUCKET, `createStorageClient`
 * devuelve null y quien lo necesite debe fallar con un error claro
 * (StorageDormantError), nunca con un crash.
 */
import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Expiración de las URLs prefirmadas: 15 minutos (spec 05, URLs prefirmadas). */
export const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

/** Tamaño máximo de un audio: 25 MB (lección 06: límites en la subida). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Tipos MIME aceptados para audios (WAV del aparato + formatos transcodificados). */
export const ALLOWED_AUDIO_MIME_TYPES = [
	"audio/wav",
	"audio/x-wav",
	"audio/vnd.wave",
	"audio/mp4",
	"audio/aac",
	"audio/mpeg",
	"audio/ogg",
	"audio/webm",
] as const;

export type AllowedAudioMimeType = (typeof ALLOWED_AUDIO_MIME_TYPES)[number];

export type StorageEnv = {
	S3_ENDPOINT?: string;
	S3_REGION?: string;
	S3_BUCKET?: string;
	S3_ACCESS_KEY_ID?: string;
	S3_SECRET_ACCESS_KEY?: string;
};

export class StorageDormantError extends Error {
	constructor() {
		super(
			"Integración de almacenamiento dormida: faltan S3_ENDPOINT o S3_BUCKET (ver .env.schema)",
		);
		this.name = "StorageDormantError";
	}
}

/** Valida que la clave no permita escapar del prefijo del bucket. */
export function assertSafeKey(key: string): void {
	if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\")) {
		throw new Error(`Clave de storage inválida: ${JSON.stringify(key)}`);
	}
}

export function assertAllowedMimeType(
	contentType: string,
): asserts contentType is AllowedAudioMimeType {
	if (!ALLOWED_AUDIO_MIME_TYPES.includes(contentType as AllowedAudioMimeType)) {
		throw new Error(
			`Tipo de audio no permitido: ${contentType} (permitidos: ${ALLOWED_AUDIO_MIME_TYPES.join(", ")})`,
		);
	}
}

export type StorageClient = {
	readonly bucket: string;
	getPresignedPutUrl(key: string, contentType: string): Promise<string>;
	getPresignedGetUrl(key: string): Promise<string>;
	putObject(
		key: string,
		body: Uint8Array | string,
		contentType: string,
	): Promise<void>;
	deleteObject(key: string): Promise<void>;
};

type LowLevelSender = {
	send: (command: unknown) => Promise<unknown>;
};

/**
 * Crea el cliente de storage, o null si la integración está dormida
 * (sin S3_ENDPOINT o S3_BUCKET). `lowLevel` permite inyectar un sender
 * falso en tests; el firmado de URLs siempre es local (sin red).
 */
export function createStorageClient(
	env: StorageEnv,
	lowLevel?: LowLevelSender,
): StorageClient | null {
	const endpoint = env.S3_ENDPOINT;
	const bucket = env.S3_BUCKET;
	if (!endpoint || !bucket) {
		return null;
	}

	const signer = new S3Client({
		endpoint,
		region: env.S3_REGION || "auto",
		credentials: {
			accessKeyId: env.S3_ACCESS_KEY_ID || "dormant",
			secretAccessKey: env.S3_SECRET_ACCESS_KEY || "dormant",
		},
		forcePathStyle: true, // necesario para MinIO y R2 con endpoint propio
	});
	const sender: LowLevelSender = lowLevel ?? {
		send: (command: unknown) => signer.send(command as never),
	};

	return {
		bucket,
		async getPresignedPutUrl(key: string, contentType: string) {
			assertSafeKey(key);
			assertAllowedMimeType(contentType);
			return getSignedUrl(
				signer,
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					ContentType: contentType,
				}),
				{ expiresIn: PRESIGNED_URL_TTL_SECONDS },
			);
		},
		async getPresignedGetUrl(key: string) {
			assertSafeKey(key);
			return getSignedUrl(
				signer,
				new GetObjectCommand({ Bucket: bucket, Key: key }),
				{ expiresIn: PRESIGNED_URL_TTL_SECONDS },
			);
		},
		async putObject(
			key: string,
			body: Uint8Array | string,
			contentType: string,
		) {
			assertSafeKey(key);
			assertAllowedMimeType(contentType);
			await sender.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: body,
					ContentType: contentType,
				}),
			);
		},
		async deleteObject(key: string) {
			assertSafeKey(key);
			await sender.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
		},
	};
}

/**
 * Devuelve el cliente o lanza StorageDormantError con mensaje claro.
 * Usar en los procedimientos que sí o sí necesitan el bucket.
 */
export function requireStorageClient(
	client: StorageClient | null,
): StorageClient {
	if (!client) {
		throw new StorageDormantError();
	}
	return client;
}
