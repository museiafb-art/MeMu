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

Inicial neutra/cálida para una app familiar. La identidad visual definitiva
está pendiente de definición con Sofi: cuando esté, se cambia acá y se
regenera.
