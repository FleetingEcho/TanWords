# UX & Code Conventions (binding for all feature work)

This doc is **contract law** for new screens. Screens that ignore it get rewritten.

## Non-negotiables

1. **Docs rule (AGENTS.md)**: consult `https://docs.expo.dev/versions/v57.0.0/` (append `.md` to URLs) before using any Expo API. DO NOT assume pre-SDK-54 behavior. Do not invent APIs.
2. **Build exclusively from `@/components/ui`** primitives: `Screen`, `ScreenHeader`, `Card`, `SectionHeader`, `ListRow`, `Divider`, `Badge`, `Button`, `EmptyState`, `StatTile`, `SearchBar`, `SegmentedTabs`, `Skeleton`, `LoadingView`, `tapHaptic`. If you need a component that doesn't exist, create it under your own feature folder — **never modify `src/components/ui.tsx`**.
3. **Semantic colors only** — `bg-background`, `bg-card`, `bg-muted`, `bg-accent`, `bg-primary`, `text-foreground`, `text-muted-foreground`, `text-primary-foreground`, `border-border`, etc. NEVER hex/rgb/hsl literals in screens (dark mode breaks). For icon `color` props and `style={{}}` colors, use `usePalette()` from `@/lib/theme`.
4. **NativeWind v4 syntax**: `className` must be a **static string** — Pressable press-state belongs in the `style` callback (`style={({pressed}) => pressed ? {opacity:0.85} : undefined}`), never a `className` function.
5. **Chinese-first i18n**: every user-facing string goes through `useT()`. Add keys to your OWN area's dict module (see File ownership below). Never edit `src/i18n/*/common.ts`, `dashboard.ts`, `types.ts`, `translations.ts`, or `index.ts`. zh is the source of truth; mirror every new key in the en dict.
6. **Data via `@/db/*` modules** — call the ported `db_*` functions (they use `getDb()` internally). No raw SQL in screens. If a needed command has no mobile port yet, port that function from the Rust source into your owned db file, keeping the same SQL.
7. **Navigation**: `expo-router` — `useRouter()`, `router.push("/word/hello")`, `router.back()`. Dynamic segments read via `useLocalSearchParams()`. Tab routes are addressable as `/reading`, `/learn`, `/feeds`, `/docs`, `/more`.
8. **Haptics**: every meaningful tap goes through a ui.tsx pressable (they call `tapHaptic()`); for success/progress feel use `expo-haptics` notification/impact sparingly.

## UX quality bar (mobile!)

- Touch targets ≥ 44px high; list rows use `ListRow` (52px) or comparable.
- **Loading**: first load → `Skeleton` placeholders shaped like the content (never a bare centered spinner except via `LoadingView` for whole-screen waits).
- **Pull-to-refresh** on every feed-like screen: `<RefreshControl tintColor={p.primary} />` (theme-aware), wired to the same `load()` as initial.
- **Empty**: every list/state gets `EmptyState` with icon + title + hint + CTA when applicable.
- **Refresh on focus** when data can change elsewhere: `useFocusEffect(useCallback(load))`.
- **Lists**: vocabulary/feed/doc lists use `FlashList` (`@shopify/flash-list`) with `keyExtractor` + stable row components wrapped in `React.memo`. Never `.map` long lists inside ScrollView.
- **Errors**: DB/network failures never crash the screen — catch, log, show inline error text in the area that failed; keep the rest of the screen usable. AllSettled for parallel loads.
- **Text**: title 28px bold (ScreenHeader), section headers 17px semibold, body 15px, captions 13px, meta 12px. `text-muted-foreground` for anything secondary.
- **Sheet-style flows** (accept/reject, filters): use RN `Modal` with `presentationStyle` default + a bottom-anchored card (rounded-3xl top, SafeArea bottom, backdrop `bg-black/40` dim, tap backdrop to dismiss). Keep gestures simple — no external sheet libs.
- Safe areas: screens use `Screen` (SafeAreaView top edge by default).

## Code style

- TypeScript strict. `bunx tsc --noEmit` must exit 0 when you're done.
- Small focused files; colocate feature components under your feature folder.
- Comments: brief "why" notes where porting non-obvious desktop behavior; cite the desktop source path for ported functions (existing convention).

## Desktop parity (port faithfully, adapt layout)

The desktop renderer under `/home/zteng/work/Tools/TanWords/app/src/` is the **spec**:
copy prompts, SQL, state semantics, and labels 1:1; adapt only layout/interaction
(hover→long-press, modal→pushed route or bottom sheet, sidebar→tabs).
Desktop Rust sources under `app/core/src/` are the spec for db behavior — port
file-by-file, keep function names (`db_*`) and SQL identical.

## File ownership (parallel work safety)

Touch ONLY the files your task assigns. Locked/shared (do not edit):
`app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`,
`src/components/ui.tsx`, `src/lib/theme.ts`, `tailwind.config.js`, `app.json`,
`package.json`, `bun.lock`, `src/i18n/*/common.ts`, `src/i18n/*/dashboard.ts`,
`src/i18n/{zh,en}/index.ts`, `src/i18n/translations.ts`, `src/i18n/types.ts`,
existing `src/db/*` you weren't assigned (reading is fine, edits are not),
`src/store/*` (same), `PLAN.md`, `docs/UX-CONVENTIONS.md`.

If a shared file genuinely blocks you, note it in your final report instead of editing it.
