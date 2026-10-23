# Typeless microphone dialog reference

The settings microphone picker uses Sayrel's colors and the layout, meter and transitions from the local Typeless artifact. It previews the selected input locally and saves the device choice immediately. Preview audio does not enter transcription or history.

`scripts/typeless-reference.mjs` prepares readable sources and hashes in `.build/typeless-floating/`. The original `2XHPuyUf.js` SHA-256 is `de7a2ff34002660d27fb09fc9f5098424efd0ca255dc7efa1c8747c44bc7eac2`. REA static evidence `ev_01bdd5fbc1d75fd9a851db48f1871777ff391db076ebd49624287f012b537744` selects that bundle. Its semantic coverage is partial and does not establish execution or coverage of imported chunks.

| Reference | Generated location | Implemented behavior |
| --- | --- | --- |
| `dn`, `da` | `microphone.js:643–823`, `microphone.js:973–1192` | 448px modal, 16px radius, 24px header inset, 18/22px title, 14/22px description, 16/24/24px body padding, 368px scrolling body. Device rows use 12/16px padding, 8px gap, 10px radius, 14/16px name and 12/14px description. |
| `uo` | `microphone.js:828–905` | Six 6×22px bars, 4px gaps, 999px radius. The bars keep their height. Volume below .12 lights none; otherwise the first `ceil(volume × 6)` bars light. Color transition lasts 150ms with ease-in-out. |
| `Rf`, invoked with sensitivity 20 by `da` | `shared.js:8974–9043`, `microphone.js:1004–1007` | FFT 1024, smoothing .8, 100ms startup, 30ms samples, RMS converted from −50 to 0dB, sensitivity 20, attack .5, release .1 and a .001 silence cutoff. Floating mode indicators retain sensitivity 2 through the same shared hook. |
| `dn` and local MUI primitives | `microphone.js:689–693` | Modal fades over 200ms. The backdrop uses MUI's 225ms enter and 195ms exit timing. Device buttons use MUI ButtonBase for the reference click ripple. |

The installed Typeless 2.8.3 `BiP8Ve7n.js` (SHA-256 `200b3526d35e50bf40809d6d4e981c8f7339fa132a76e905a142a0bf17f403af`) retains these dialog dimensions, sensitivity, bar dimensions and color transition. Native input selection, permission handling and audio processing continue to use Sayrel's existing services. The startup login-item logic is unchanged.

`npm run verify:microphone` compares the original meter functions against the project, then renders the extracted `dn`, `da` and `uo` with local React/MUI and inert audio/device boundaries. The real app uses synthetic Web Audio input in a temporary profile. Checks cover Chinese and English layout, silence, input switching, microphone denial, active-recording guard, a stream arriving after dismissal, no devices, and track/context cleanup. Network requests are blocked. No physical microphone or macOS permission changes are used. Screenshots and the comparison report are generated in `docs/ui-evidence/microphone/`.

## Settings preview lifecycle (#6)

`src/renderer/shared/audio/microphonePreview.ts` owns device opening, Web Audio readiness and resource release. `startMicrophonePreview` accepts the entry's audio constraints and returns `ready` and `stop`. Readiness supplies an analyser only after the context resumes; cancellation before readiness returns `null`. Stopping releases acquired tracks and the context immediately, also collecting any stream that arrives later. Initialization failures release resources before reporting the error. Repeated cleanup shares the same release operation.

The settings picker retains its recording-state guard, device discovery, native descriptions, disappearance fallback and immediate persistence. Its constraints remain `noiseSuppression: true` plus the selected exact device ID, with video disabled. The existing `useMicrophoneVolume` hook still supplies sensitivity 20 and the reference display timing. The preview opens no PCM worklet and calls no transcription, model or history-writing endpoint. Onboarding migration is tracked separately in #7.

The offline Electron check now also exercises constructor, analyser, source and resume failures; device-open failure and retry; cancellation while opening or resuming; switching while an older open is pending; device disappearance; and exactly-once track release after failure and subsequent dismissal. It uses synthetic streams with real AudioContexts, and checks the visible meter and selected device along with released tracks and closed contexts. The first added regression failed against the previous implementation because analyser initialization failure left a live stream and context while the dialog stayed open.

Validation on 2026-10-23: `verify:microphone`, `typecheck` and the production build passed. The full run passed 14 of the 15 `verify:*` scripts. The existing `verify:regressions` loader failure remains at `scripts/diagnostics/retention.cjs:17` (`Cannot find module '../../shared/usage'`); its subsequent native-callback, Opus and packaged-database checks were run separately and passed. Standards and spec reviews each reported zero actionable findings. Generated Chinese/English microphone screenshots were inspected; this was offline synthetic-input verification, not a physical-device check.
