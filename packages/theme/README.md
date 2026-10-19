# @memu/theme — Design tokens de MeMu

Fuente única de verdad para todo lo visual. **Regla dura: cero colores o
valores hardcodeados en el código** — todo sale de acá.

## Cómo funciona

1. Editás `src/tokens.ts` (paleta clara/oscura, charts, espaciados, radios, tipografía).
2. Corrés `pnpm --filter @memu/theme build` (o `pnpm build` en este paquete).
3. Se regeneran `src/web.css` (Tailwind v4, variables shadcn para la web) y
   `src/native.css` (override de las variables de heroui-native para Uniwind).

Nunca edites los CSS generados a mano: se pisan en cada build.

## Integración

- **Web**: `packages/ui/src/styles/globals.css` importa `@memu/theme/web.css`.
  Las utilidades (`bg-background`, `text-primary`, `bg-success`, ...) salen del
  bloque `@theme inline` de ese archivo.
- **Mobile**: `apps/native/global.css` importa `@memu/theme/native.css`
  **después** de `heroui-native/styles`, para que los tokens de MeMu ganen en
  cascada. El cambio claro/oscuro lo maneja Uniwind (`Uniwind.setTheme`).

## En código TypeScript

```ts
import { colors, spacing, radii } from "@memu/theme/tokens";

// colors.light.primary, colors.dark.background, spacing.md, radii.lg, ...
```

## Paleta

Identidad de marca **aprobada por Sofi el 2026-10-19**. Concepto: "La voz de
la familia, sin pantallas" — marca juguete estilo Bluey: formas redondeadas,
pasteles cálidos, contornos amables. Primario azul Bluey con cuerpo (`#2A6FC2`
en light), superficies crema, modo oscuro cálido en marrones.

- `colors`: tokens funcionales (convención shadcn). Todos los pares
  texto/fondo verificados ≥ 4.5:1 (EAA / WCAG AA).
- `pastels`: tintes decorativos de marca — **nunca para texto**.
- Tipografía: Nunito (cuerpo, gran legibilidad). Display font **pendiente de
  elección de Sofi** (Baloo 2 descartada el 2026-10-19; candidatas: Fredoka,
  Titan One, Chewy, Comfortaa) — `typography.fontFamily.display` usa Nunito
  provisoriamente. Detalle completo en
  `~/workspace/memu-brand/identidad-memu-propuesta.md`.

Para cambiar la marca se edita `src/tokens.ts` y se regenera: cambia la web y
la app a la vez.
