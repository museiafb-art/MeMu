/**
 * MeMu — Design tokens (fuente única de verdad).
 *
 * REGLA DURA: cero colores/valores hardcodeados en el código. Todo lo visual
 * sale de acá. Para cambiar un color se cambia en este archivo y se regenera
 * el CSS con `pnpm --filter @memu/theme build`.
 *
 * - `colors.light` / `colors.dark`: paleta cálida pensada para una app familiar.
 *   Las claves siguen la convención shadcn (background, primary, muted, ...)
 *   para que el CSS generado las mapee directo a las utilidades de Tailwind v4
 *   (`bg-background`, `text-primary`, ...) y al theme de Uniwind en mobile.
 * - La identidad visual final está pendiente de definición con Sofi: esta es
 *   una paleta inicial neutra/cálida, no la marca definitiva.
 */

export const colors = {
	light: {
		background: "#FBF7EF",
		foreground: "#221A12",
		card: "#FFFFFF",
		cardForeground: "#221A12",
		popover: "#FFFFFF",
		popoverForeground: "#221A12",
		primary: "#BC5A1A",
		primaryForeground: "#FFF9F1",
		secondary: "#EFE6D3",
		secondaryForeground: "#4A3E2D",
		muted: "#EFE6D3",
		mutedForeground: "#77694F",
		accent: "#E4EFE3",
		accentForeground: "#2E5B3E",
		destructive: "#BE3A2B",
		destructiveForeground: "#FFF9F1",
		border: "#E2D5BC",
		input: "#E2D5BC",
		ring: "#BC5A1A",
		success: "#2E7D4F",
		successForeground: "#F4FBF6",
		warning: "#A86A12",
		warningForeground: "#FFF9F1",
		info: "#2D6CDF",
		infoForeground: "#F4F8FF",
		sidebar: "#F6F0E2",
		sidebarForeground: "#221A12",
		sidebarPrimary: "#BC5A1A",
		sidebarPrimaryForeground: "#FFF9F1",
		sidebarAccent: "#EFE6D3",
		sidebarAccentForeground: "#4A3E2D",
		sidebarBorder: "#E2D5BC",
		sidebarRing: "#BC5A1A",
	},
	dark: {
		background: "#161210",
		foreground: "#F4EDE0",
		card: "#211B15",
		cardForeground: "#F4EDE0",
		popover: "#211B15",
		popoverForeground: "#F4EDE0",
		primary: "#E08A3C",
		primaryForeground: "#231204",
		secondary: "#2D251C",
		secondaryForeground: "#D9CBAF",
		muted: "#2D251C",
		mutedForeground: "#A79B82",
		accent: "#1E3A2A",
		accentForeground: "#A5D8B4",
		destructive: "#E0685C",
		destructiveForeground: "#231204",
		border: "#3B3227",
		input: "#3B3227",
		ring: "#E08A3C",
		success: "#63B57F",
		successForeground: "#0C1A11",
		warning: "#D9A441",
		warningForeground: "#231204",
		info: "#7AA5EC",
		infoForeground: "#0C1526",
		sidebar: "#1E1813",
		sidebarForeground: "#F4EDE0",
		sidebarPrimary: "#E08A3C",
		sidebarPrimaryForeground: "#231204",
		sidebarAccent: "#2D251C",
		sidebarAccentForeground: "#D9CBAF",
		sidebarBorder: "#3B3227",
		sidebarRing: "#E08A3C",
	},
} as const;

/** Paleta para gráficos (índices 1–5). */
export const charts = {
	light: ["#BC5A1A", "#2E7D4F", "#2D6CDF", "#A86A12", "#7C5CBF"],
	dark: ["#E08A3C", "#63B57F", "#7AA5EC", "#D9A441", "#A78BFA"],
} as const;

export type ThemeMode = keyof typeof colors;
export type ColorToken = keyof typeof colors.light;

/** Espaciado base 4px. */
export const spacing = {
	xs: 4,
	sm: 8,
	md: 16,
	lg: 24,
	xl: 32,
	"2xl": 48,
	"3xl": 64,
} as const;

/** Radios de borde. */
export const radii = {
	sm: 6,
	md: 10,
	lg: 16,
	xl: 24,
	full: 9999,
} as const;

/** Tipografía del sistema (nada de fuentes externas en Fase 0). */
export const typography = {
	fontFamily: {
		sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
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
	charts,
	spacing,
	radii,
	typography,
} as const;

export type Theme = typeof theme;
