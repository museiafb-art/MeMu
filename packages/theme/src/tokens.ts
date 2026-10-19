/**
 * MeMu — Design tokens (fuente única de verdad).
 *
 * REGLA DURA: cero colores/valores hardcodeados en el código. Todo lo visual
 * sale de acá. Para cambiar un color se cambia en este archivo y se regenera
 * el CSS con `pnpm --filter @memu/theme build`.
 *
 * Identidad de marca APROBADA por Sofi el 2026-10-19.
 * Concepto: "La voz de la familia, sin pantallas." Marca juguete estilo Bluey:
 * formas redondeadas, pasteles cálidos, contornos amables. Infantil para los
 * niños, confiable para los padres, legible para los mayores.
 *
 * - `colors.light` / `colors.dark`: las claves siguen la convención shadcn
 *   (background, primary, muted, ...) para que el CSS generado las mapee
 *   directo a las utilidades de Tailwind v4 (`bg-background`, `text-primary`,
 *   ...) y al theme de Uniwind en mobile.
 * - Accesibilidad (EAA / WCAG AA): los pasteles viven SOLO en superficies
 *   decorativas (`pastels`, nunca para texto). Todos los pares texto/fondo de
 *   `colors` fueron verificados ≥ 4.5:1.
 * - `pastels`: tintes decorativos de marca (ilustración, fondos lúdicos).
 *   NUNCA para texto funcional.
 * - Tipografía: Nunito (cuerpo/UI, gran legibilidad para mayores) + Titan One
 *   (display, elegida por Sofi el 2026-10-19). Ambas cargadas de verdad en
 *   web (next/font) y native (expo-font).
 */

export const colors = {
	light: {
		background: "#FFF8EE",
		foreground: "#2E2A24",
		card: "#FFFFFF",
		cardForeground: "#2E2A24",
		popover: "#FFFFFF",
		popoverForeground: "#2E2A24",
		primary: "#2A6FC2",
		primaryForeground: "#FFFFFF",
		secondary: "#FBE7C6",
		secondaryForeground: "#8A4E0F",
		muted: "#F5EDDD",
		mutedForeground: "#6F6355",
		accent: "#FFE9A8",
		accentForeground: "#6B4E00",
		destructive: "#C7382C",
		destructiveForeground: "#FFFFFF",
		border: "#EADDC6",
		input: "#EFE3CC",
		ring: "#2A6FC2",
		success: "#1F7A52",
		successForeground: "#FFFFFF",
		warning: "#9A5F0B",
		warningForeground: "#FFFFFF",
		info: "#2A6FC2",
		infoForeground: "#FFFFFF",
		sidebar: "#FBF3E4",
		sidebarForeground: "#2E2A24",
		sidebarPrimary: "#2A6FC2",
		sidebarPrimaryForeground: "#FFFFFF",
		sidebarAccent: "#F5EDDD",
		sidebarAccentForeground: "#4A4238",
		sidebarBorder: "#EADDC6",
		sidebarRing: "#2A6FC2",
	},
	dark: {
		background: "#1B1611",
		foreground: "#F8F0E1",
		card: "#251F17",
		cardForeground: "#F8F0E1",
		popover: "#251F17",
		popoverForeground: "#F8F0E1",
		primary: "#7FB6EC",
		primaryForeground: "#16283A",
		secondary: "#3A2C18",
		secondaryForeground: "#F2C384",
		muted: "#2A2318",
		mutedForeground: "#B9AC94",
		accent: "#4A3A12",
		accentForeground: "#FFDA7A",
		destructive: "#E4685C",
		destructiveForeground: "#22100B",
		border: "#3E3423",
		input: "#332B1E",
		ring: "#7FB6EC",
		success: "#5FC78E",
		successForeground: "#0C2115",
		warning: "#E0A63F",
		warningForeground: "#241A05",
		info: "#7FB6EC",
		infoForeground: "#16283A",
		sidebar: "#201A12",
		sidebarForeground: "#F8F0E1",
		sidebarPrimary: "#7FB6EC",
		sidebarPrimaryForeground: "#16283A",
		sidebarAccent: "#2A2318",
		sidebarAccentForeground: "#D9CBAF",
		sidebarBorder: "#3E3423",
		sidebarRing: "#7FB6EC",
	},
} as const;

/**
 * Tintes pasteles decorativos de marca. SOLO decoración (ilustración, fondos
 * lúdicos): NUNCA para texto funcional, no tienen el contraste necesario.
 */
export const pastels = {
	light: {
		pastelSky: "#BEE0F7",
		pastelPeach: "#F9CF9C",
		pastelButter: "#FFE3A3",
		pastelMint: "#BDE8CC",
		pastelLilac: "#D9C9F2",
		pastelRose: "#F4C3CE",
	},
	dark: {
		pastelSky: "#27455F",
		pastelPeach: "#5C3E1E",
		pastelButter: "#574512",
		pastelMint: "#1F4A33",
		pastelLilac: "#3E3358",
		pastelRose: "#55293A",
	},
} as const;

/** Paleta para gráficos (índices 1–5). */
export const charts = {
	light: ["#2A6FC2", "#1F7A52", "#9A5F0B", "#C7382C", "#7C5CBF"],
	dark: ["#7FB6EC", "#5FC78E", "#E0A63F", "#E4685C", "#A78BFA"],
} as const;

export type ThemeMode = keyof typeof colors;
export type ColorToken = keyof typeof colors.light;
export type PastelToken = keyof typeof pastels.light;

/** Espaciado base 4px, con aire generoso (marca juguete). */
export const spacing = {
	xs: 4,
	sm: 8,
	md: 16,
	lg: 24,
	xl: 32,
	"2xl": 48,
	"3xl": 64,
} as const;

/** Radios de borde generosos (juguete, no corporativo). */
export const radii = {
	sm: 8,
	md: 14,
	lg: 20,
	xl: 28,
	full: 9999,
} as const;

/** Tipografía: Nunito (cuerpo) + Titan One (display, elegida por Sofi el 2026-10-19). */
export const typography = {
	fontFamily: {
		display: '"Titan One", "Nunito", system-ui, sans-serif',
		sans: '"Nunito", system-ui, sans-serif',
		mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
	},
	fontSize: {
		xs: 12,
		sm: 14,
		md: 16,
		lg: 20,
		xl: 24,
		"2xl": 32,
	},
	fontWeight: {
		regular: "400",
		medium: "500",
		semibold: "600",
		bold: "700",
	},
} as const;

export const theme = {
	colors,
	pastels,
	charts,
	spacing,
	radii,
	typography,
} as const;

export type Theme = typeof theme;
