/**
 * Genera `src/web.css` y `src/native.css` desde `src/tokens.ts`.
 * Fuente única de verdad: tokens.ts. No editar los CSS a mano.
 *
 * Uso: pnpm --filter @memu/theme build
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { charts, colors, pastels, radii } from "../src/tokens.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const HEADER =
	"/* GENERATED from tokens.ts — do not edit by hand. Run: pnpm --filter @memu/theme build */\n\n";

const toKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

function varsBlock(palette) {
	return Object.entries(palette)
		.map(([key, value]) => `\t--${toKebab(key)}: ${value.toLowerCase()};`)
		.join("\n");
}

function chartsBlock(mode) {
	return charts[mode]
		.map((value, i) => `\t--chart-${i + 1}: ${value.toLowerCase()};`)
		.join("\n");
}

/** Tintes pasteles decorativos (nunca para texto): --pastel-sky, etc. */
function pastelsBlock(mode) {
	return Object.entries(pastels[mode])
		.map(([key, value]) => `\t--${toKebab(key)}: ${value.toLowerCase()};`)
		.join("\n");
}

/** Web (Tailwind v4): variables shadcn en :root / .dark. */
function buildWebCss() {
	return (
		HEADER +
		`:root {\n${varsBlock(colors.light)}\n${pastelsBlock("light")}\n${chartsBlock("light")}\n\t--radius: ${radii.lg / 16}rem;\n}\n\n` +
		`.dark {\n${varsBlock(colors.dark)}\n${pastelsBlock("dark")}\n${chartsBlock("dark")}\n}\n`
	);
}

/**
 * Native (Uniwind + heroui-native): sobrescribe las variables de heroui-native
 * con los tokens de MeMu. Debe importarse DESPUÉS de "heroui-native/styles".
 */
const NATIVE_MAP = [
	["background", "background"],
	["foreground", "foreground"],
	["surface", "card"],
	["surface-foreground", "cardForeground"],
	["surface-secondary", "secondary"],
	["surface-secondary-foreground", "secondaryForeground"],
	["surface-tertiary", "muted"],
	["surface-tertiary-foreground", "mutedForeground"],
	["overlay", "popover"],
	["overlay-foreground", "popoverForeground"],
	["muted", "mutedForeground"],
	["default", "secondary"],
	["default-foreground", "secondaryForeground"],
	["accent", "accent"],
	["accent-foreground", "accentForeground"],
	["success", "success"],
	["success-foreground", "successForeground"],
	["warning", "warning"],
	["warning-foreground", "warningForeground"],
	["danger", "destructive"],
	["danger-foreground", "destructiveForeground"],
	["border", "border"],
	["separator", "border"],
	["focus", "ring"],
	["link", "info"],
	["field-background", "card"],
	["field-foreground", "foreground"],
	["field-placeholder", "mutedForeground"],
	["field-border", "border"],
];

function nativeVarsBlock(mode) {
	const palette = colors[mode];
	return NATIVE_MAP.map(([cssVar, token]) => {
		const value = palette[token];
		if (!value) throw new Error(`Token faltante: colors.${mode}.${token}`);
		return `\t\t\t--${cssVar}: ${value.toLowerCase()};`;
	}).join("\n");
}

/** Pasteles decorativos en native (mismo bloque @layer theme). */
function nativePastelsBlock(mode) {
	return Object.entries(pastels[mode])
		.map(([key, value]) => `\t\t\t--${toKebab(key)}: ${value.toLowerCase()};`)
		.join("\n");
}

function buildNativeCss() {
	return (
		HEADER +
		`@layer theme {\n\t:root {\n\t\t@variant light {\n${nativeVarsBlock("light")}\n${nativePastelsBlock("light")}\n\t\t}\n\n\t\t@variant dark {\n${nativeVarsBlock("dark")}\n${nativePastelsBlock("dark")}\n\t\t}\n\t}\n}\n`
	);
}

writeFileSync(join(root, "web.css"), buildWebCss());
writeFileSync(join(root, "native.css"), buildNativeCss());
console.log("OK: web.css y native.css generados desde tokens.ts");
