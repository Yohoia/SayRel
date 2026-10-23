# Typeless floating control reference

This change restores the local Typeless **2.8.2** floating control and reply-card layout. Sayrel's blue/paper palette and existing logo replace the reference's colors and branding. Latin text uses the reference's SF Pro; localized Chinese strings retain the app's MiSans fallback. The reference directory stays read-only.

Run `node scripts/typeless-reference.mjs` to generate readable evidence and source SHA-256 hashes in `.build/typeless-floating/`. Babel parses the original files. For the main bundle, only its two string-table functions and table rotation run in an empty VM with a timeout; no application bootstrap, imports, native library, network or account code executes.

REA static evidence: `ev_e3f2a9c7a918c69d095cda502b4b75d145fb23964e6b1687640bc7dae7f09875`. This evidence selects the floating renderer; it does not establish runtime execution or complete coverage of imported chunks. The following source inspection and local tests cover the implemented paths.

| Reference | Generated source | Restored behavior |
| --- | --- | --- |
| `DFvLNtQv.mjs`, `ma` | `floating.js:6319–6468` | Capsule radius 99px; recording/hover 70×34; hands-free 116×34; countdown adds 40px; microphone startup 54×12; original shadows and easing. |
| `DFvLNtQv.mjs`, `Ia`, `je`, `Ta` | `floating.js:6550–6970` | Thinking uses **92×34px**; progress reaches 80/90/95/97/98/99% at 1/2/3/4/5/10s. Completion fills to 100%, holds 350ms, then fades. Both buttons collapse when recording ends, leaving the text centered. |
| `DFvLNtQv.mjs`, mode glow | `floating.js:6704–6737` | Clipped 116×32 radial glow, top −25px, blur 7px; same behavior for translation and Ask anything. |
| `DWYvEY4x.js`, `Xr`, `Kn`, `Is` | `shared.js:126–617` | Audio-reactive masked gradient; translation panel above the capsule; 8/6/12px panel/trigger/menu radii; hover menu, reversed preferred-language order, language change and settings entry. |
| `DWYvEY4x.js`, `Rf`, `wo` | `shared.js:1927–1970`, `8974–9043` | Ask anything indicator; volume meter FFT 1024, smoothing .8, sensitivity 2, 100ms startup and 30ms updates; attack .5 and release .1. |
| Main `cg` | `main.js:5093–5243` | 750×500 transparent non-focusable panel; centered on the pointer's display; 100ms pointer checks, explicit click regions, click-through elsewhere; idle collapses to 1×1. |
| Main `Ef` | `main.js:9706–9908` | 800px reply window; bottom 20px above work area; original initial-height rule, 80ms bounds debounce, 2px tolerance and display following. |
| `BYNd6ENk.js`, `ue`, `ce`, `se` | `card-component.js:10–21`, `324–465`, `535–1020` | Reply 744px wide, 16px outer radius/padding/gap, 20px logo row, 400–700px height; 12px answer radius, 51px header, 17px text/28px line height. Prompt collapses at 44px, with original fade/more placement. |
| `DTGF8R6e.mjs`, `z` | `card.js:1–151` | Hidden natural-height measurement, 24/8/64px surrounding padding, reveal 150ms after reporting bounds with 300ms fallback, resize on new content, Escape to close. |

`ma` derives hands-free from the **active recording state**, not a context flag retained after recording. `finishing` and `recording_active` are sibling states. Consequently its declared `hands-free-dictating` branch is unreachable: processing must collapse both buttons even when the preceding recording was hands-free. Retaining the cancel button in a 92px capsule compresses the Thinking label. The installed Typeless 2.8.3 bundles (`juYOhWy9.mjs`, `1uHho0F_.js`) retain the same state mapping, Thinking dimensions and menu sizing rule.

Translation labels use the existing locale dictionary, matching the reference (for example, “简体中文（中国大陆）” rather than the system's shorter “中文（中国）”). The menu fits its longest label and is at least the trigger width plus 10px. Its left edge is 5px before the trigger; its bottom edge is 5px below it, keeping the selected final row aligned with the trigger. Hidden and visible panel measurements use the same button structure; a ResizeObserver updates the width when the font loads.

The app retains its recorder/provider pipeline and permission-recovery actions. The existing translation/Ask anything modes use the restored UI. Provider output renders Markdown with plain-text copying. The provider protocol currently has no web-search progress or grounding metadata; this change does not invent the reference's “Searching the web” state or citations. Those require real provider events/data before they can be displayed.

## Verification

`npm run verify:typeless` prepares reference evidence, compares original pure style/progress/native layout functions with project code, builds the isolated renderer, and exercises the UI with network blocked and synthetic audio. It also renders the extracted original `Ia`, `$i`, `Kn` and `Is` components with local React/MUI and the same fonts. Authentication, audio, stores and IPC are inert fixtures. Checks compare actual Thinking text position/button widths and five translation-menu layouts (short/long language names, English/Chinese interface, Add language). No real microphone, permissions, account or provider is used. Evidence is generated under `docs/ui-evidence/typeless-floating/` (ignored).

`npm run verify:floating` covers error recovery, real HubWindow navigation, countdowns, processing and cancel/finish actions. `npm run verify:voice` covers Fn upgrades, Fn+Shift, Fn+Space and ordered microphone drain. `npm run typecheck` and `npm run build` validate the production build.
