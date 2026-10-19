/**
 * Worker de transcodificación: convierte el WAV del aparato a un formato
 * liviano para el celu (M4A/AAC).
 *
 * REQUISITO DE PRIVACIDAD (spec 05, no negociable): procesamiento
 * TRANSITORIO. El flujo es: descargar a tmp → convertir → subir el
 * resultado → actualizar la base → borrar el original → borrar el tmp.
 * Al terminar no queda ninguna copia persistente del WAV original.
 *
 * Lección 06 (costos): reintentos con TOPE + backoff, nunca infinitos. Si se
 * agotan, se registra como dead-letter (log estructurado) y el WAV original
 * se conserva para reintento manual: no se pierde ningún audio.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Database } from "@memu/db";
import { voiceMessage } from "@memu/db/schema/memu";
import type { StorageClient } from "@memu/storage";
import { eq } from "drizzle-orm";

const execFileAsync = promisify(execFile);

export type Converter = (
	inputPath: string,
	outputPath: string,
) => Promise<void>;

/** Conversor real con ffmpeg (WAV → M4A/AAC 64k). */
export async function ffmpegConverter(
	inputPath: string,
	outputPath: string,
): Promise<void> {
	await execFileAsync("ffmpeg", [
		"-y",
		"-i",
		inputPath,
		"-c:a",
		"aac",
		"-b:a",
		"64k",
		outputPath,
	]);
}

export type TranscodeJob = {
	messageId: string;
	groupId: string;
	/** Clave del WAV original en el bucket. */
	storageKey: string;
};

export type TranscoderDeps = {
	storage: StorageClient;
	db: Database;
	convert?: Converter;
};

function outputKeyFor(inputKey: string): string {
	return inputKey.replace(/\.[^.]+$/, "") + ".m4a";
}

/**
 * Transcodifica un mensaje: descarga → convierte → sube → apunta la base al
 * nuevo archivo → borra el original → limpia el tmp. Devuelve la clave final.
 */
export async function transcodeVoiceMessage(
	deps: TranscoderDeps,
	job: TranscodeJob,
): Promise<string> {
	const convert = deps.convert ?? ffmpegConverter;
	const tmpDir = await mkdtemp(join(tmpdir(), "memu-transcode-"));
	try {
		const inputPath = join(tmpDir, "input.wav");
		const outputPath = join(tmpDir, "output.m4a");

		// 1. Descarga transitoria del original.
		const downloadUrl = await deps.storage.getPresignedGetUrl(job.storageKey);
		const res = await fetch(downloadUrl);
		if (!res.ok) {
			throw new Error(`Descarga del original falló: HTTP ${res.status}`);
		}
		await writeFile(inputPath, Buffer.from(await res.arrayBuffer()));

		// 2. Conversión (solo vive en tmp).
		await convert(inputPath, outputPath);

		// 3. Subida del resultado.
		const outputKey = outputKeyFor(job.storageKey);
		const uploadUrl = await deps.storage.getPresignedPutUrl(
			outputKey,
			"audio/mp4",
		);
		const put = await fetch(uploadUrl, {
			method: "PUT",
			headers: { "Content-Type": "audio/mp4" },
			body: await readFile(outputPath),
		});
		if (!put.ok) {
			throw new Error(`Subida del transcodificado falló: HTTP ${put.status}`);
		}

		// 4. La base apunta al nuevo archivo; 5. se borra el original.
		await deps.db
			.update(voiceMessage)
			.set({ storageKey: outputKey })
			.where(eq(voiceMessage.id, job.messageId));
		await deps.storage.deleteObject(job.storageKey);

		return outputKey;
	} finally {
		// 6. Limpieza garantizada del tmp: sin copias persistentes.
		await rm(tmpDir, { recursive: true, force: true });
	}
}

export type RetryOptions = {
	maxAttempts?: number;
	baseDelayMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta la transcodificación con reintentos acotados + backoff exponencial.
 * Nunca infinito (lección 06). Si se agotan los intentos, dead-letter en log
 * y el WAV original queda intacto para reintento manual.
 */
export async function runTranscodeWithRetry(
	deps: TranscoderDeps,
	job: TranscodeJob,
	options: RetryOptions = {},
): Promise<void> {
	const maxAttempts = options.maxAttempts ?? 3;
	const baseDelayMs = options.baseDelayMs ?? 1000;
	for (let attempt = 1; ; attempt += 1) {
		try {
			await transcodeVoiceMessage(deps, job);
			return;
		} catch (err) {
			if (attempt >= maxAttempts) {
				console.error(
					`[transcode] dead-letter messageId=${job.messageId} groupId=${job.groupId} intentos=${attempt}`,
					err,
				);
				return;
			}
			await sleep(baseDelayMs * 2 ** (attempt - 1));
		}
	}
}
