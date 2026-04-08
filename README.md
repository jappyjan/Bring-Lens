# Bring Lens

A [Bring!](https://www.getbring.com/) shopping list client for **Even Realities G2** smart glasses, built on top of the [`even-toolkit`](https://github.com/fabioglimb/even-toolkit) SDK wrapper.

It runs as a single Vite + React 19 app with two faces:

- **Phone / settings side** — a regular web UI where you sign in to Bring!, pick which list the glasses should display, choose between full and minimal view modes, and (optionally) configure a Soniox API key for voice-add.
- **Glasses side** — a headless React component (`BringGlasses.tsx`) that drives the G2 display via `useGlasses`. It mirrors the same React contexts the phone UI uses, so any change made on either side is reflected on the other within one polling tick.

## Features

- **Bring! account login** with credentials stored via the Even Realities SDK's local key-value store (`EvenHubBridge.setLocalStorage` / `getLocalStorage`).
- **Live shopping list** displayed on the glasses, polled from Bring! every 15 seconds.
- **Check items off from the glasses** with a tap (`SELECT_HIGHLIGHTED` → `TO_RECENTLY` against the Bring! v2 batch endpoint).
- **Add items by voice** via the toolkit's `useSTT` hook (Soniox provider, auto-detects glasses microphone).
- **Two glasses views:**
  - **Full** — header + scrollable list, intended for prep at home.
  - **Minimal** — 4 dim items in the corner of your view, intended for in-store browsing without occluding the real world.
- **Switch the active list from the glasses** via the "→ Change list" row.
- **Optimistic updates** — taps and adds reflect on the glasses immediately and roll back on API errors.

## Architecture

```
src/
├─ main.tsx                       Vite entry point
├─ App.tsx                        Routes + headless <BringGlasses />
├─ styles/app.css                 Theme + layout (uses even-toolkit/web tokens)
│
├─ lib/
│  ├─ bring-client.ts             Bring! API client (login, lists, items, batch update)
│  ├─ storage.ts                  EvenHubBridge-backed key/value store w/ browser fallback
│  └─ uuid.ts                     RFC4122 v4 UUID for client-side item IDs
│
├─ contexts/
│  ├─ AuthContext.tsx             Sign-in state, token refresh, persistence
│  ├─ SettingsContext.tsx         Default list, view mode, Soniox key, locale
│  └─ BringContext.tsx            Lists, active list, items, mutations, polling
│
├─ layouts/Shell.tsx              Phone-side top bar + outlet
├─ screens/
│  ├─ Login.tsx                   Email/password form
│  ├─ Home.tsx                    Phone-side list view
│  └─ Settings.tsx                Default list, view, voice key, sign out
│
└─ glass/
   ├─ BringGlasses.tsx            Headless component that wires useGlasses + STT
   ├─ selectors.ts                createGlassScreenRouter setup
   ├─ shared.ts                   BringSnapshot and BringActions types
   ├─ splash.ts                   Pixel-art shopping bag splash screen
   └─ screens/
      ├─ items-full.ts            Full scrollable list view
      ├─ items-minimal.ts         Tiny corner-of-eye list view
      ├─ list-select.ts           Pick the active Bring! list
      └─ signed-out.ts            "Open the phone app to sign in" placeholder
```

### Data flow

```
                 ┌──────────────────────┐
                 │   Even Realities G2  │
                 └────────┬─────────────┘
                          │ BLE / SDK
                          ▼
        ┌──────────────────────────────────┐
        │  EvenHubBridge (even-toolkit)    │
        └──────┬─────────────────┬─────────┘
               │ display          │ key/value store
               ▼                  ▼
   useGlasses ◀──── snapshot ──── BringContext / SettingsContext / AuthContext
       │                                       │
       │ actions                               │ HTTPS
       ▼                                       ▼
   GlassScreen                            api.getbring.com
   (items-full,
    items-minimal,
    list-select,
    signed-out)
```

The phone UI (`<Routes>` in `App.tsx`) and the glasses driver (`<BringGlasses />`) both consume the same React contexts, so:

- A check-off on the glasses calls `BringContext.completeItem` → updates state → next phone render shows it crossed out.
- A "Change list" tap on the glasses navigates to `/glasses/lists` (handled by `list-select.ts`); selecting a list calls `BringContext.setActiveListUuid` and navigates back to `/`, which both views observe.
- A new Soniox API key entered in the phone Settings screen flows through `SettingsContext` and the next snapshot tick re-enables the "+ Add by voice" row on the glasses.

### Bring! API

Bring! has no official public API. The client in `src/lib/bring-client.ts` is built against the same v2 endpoints used by the [`miaucl/bring-api`](https://github.com/miaucl/bring-api) Python library (the reference implementation used by the Home Assistant integration). It supports:

| Method                                            | Endpoint                                      |
| ------------------------------------------------- | --------------------------------------------- |
| `login(email, password, country)`                 | `POST /rest/v2/bringauth`                     |
| `refreshAccessToken(auth)`                        | `POST /rest/v2/bringauth/token`               |
| `getLists(auth)`                                  | `GET  /rest/bringusers/{uuid}/lists`          |
| `getListItems(auth, listUuid)`                    | `GET  /rest/v2/bringlists/{listUuid}`         |
| `addItem` / `completeItem` / `uncompleteItem` / `removeItem` | `PUT /rest/v2/bringlists/{listUuid}/items` (batched) |

All requests carry the hard-coded `X-BRING-API-KEY` baked into the Bring Android client (the same one every community library uses) plus `X-BRING-CLIENT: android`, `X-BRING-APPLICATION: bring`, and the user's `X-BRING-COUNTRY`.

### Credential storage

`src/lib/storage.ts` is a small async key/value wrapper that:

1. Lazily constructs an `EvenHubBridge` (from `even-toolkit/bridge`) and calls `init()`.
2. Forwards `getItem` / `setItem` to the bridge's `getLocalStorage` / `setLocalStorage`, which is the SDK's secure, glasses-scoped store.
3. Falls back transparently to `window.localStorage` when no glasses are connected (e.g. during browser-only development).

The Bring! auth blob (`accessToken`, `refreshToken`, `expiresAt`, `uuid`, `publicUuid`) and the app settings (default list, view mode, Soniox key) all live in this store.

### Glasses screens

Each screen is a pure `GlassScreen<BringSnapshot, BringActions>` object with a `display(snapshot, nav)` and an `action(action, nav, snapshot, ctx)` method, exactly as in the toolkit's reference apps. The router in `selectors.ts` composes them into `toDisplayData` / `onGlassAction` and the headless `<BringGlasses />` component plugs them into `useGlasses`.

Glasses gestures map to a tiny action vocabulary:

- `HIGHLIGHT_MOVE { up | down }` — scroll the highlight.
- `SELECT_HIGHLIGHTED` — tap; behaviour depends on the highlighted row.
- `GO_BACK` — context-dependent: cancels voice input, returns to list select, etc.

## Running

```bash
npm install
npm run dev
```

This starts Vite on port 5173. Open it in a browser for the phone UI; pair your G2 glasses through the Even Realities companion and the headless `BringGlasses` component will start driving the display.

```bash
npm run build      # type-check and build for production
npm run typecheck  # type-check only
```

## Configuration

All runtime configuration lives inside the app:

1. **Sign in to Bring!** on `/login`.
2. **Pick a default list** in **Settings**.
3. **Optional:** paste a [Soniox](https://soniox.com) API key into Settings → Voice input to enable voice-add on the glasses.

There are no environment variables and nothing to deploy server-side.

## License

MIT
