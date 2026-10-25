# Dictation pipeline reference

This describes the live ASR, writing controls, edit learning, and desktop-command implementation added on 2026-10-24.

## Recording and transcription

`RecordingMachine.markStreaming` opens a live transcription session after the microphone starts. `pushPcm` keeps a local audio copy and sends each new chunk to that session. The renderer receives preview text on `recording-machine:partial`. Preview events include the recording session ID, so a previous recording cannot update the current preview.

`markStopped` runs after the renderer drains its final audio chunks. It finishes the ASR session once. Refinement and delivery consume the complete result, never preview text.

| Selection | Capture behavior |
| --- | --- |
| OpenAI Realtime protocol | Live upload |
| Soniox protocol | Live upload |
| Qwen and FunASR models containing `realtime` | Live upload |
| ElevenLabs models containing `realtime` | Live upload |
| Volcengine `bigmodel`, `bigmodel_nostream`, and `bigmodel_async` | Live upload; intermediate results depend on the selected endpoint |
| Qwen batch models, REST transcription, and local Whisper | Transcribe after capture |

Model selection is preserved. Selecting a Qwen batch model does not select its realtime variant automatically.

The live transport bounds queued audio to 15 seconds. Connection confirmation has a 15-second deadline. Finishing starts a 45-second deadline that also covers draining a blocked upload queue. Cancellation closes the connection and prevents later delivery.

If live transcription fails, the coordinator retries the complete cached audio through the same selected provider and model. This retry is recorded as `batch-fallback`; it can use that provider's existing paced WebSocket adapter. It does not race another provider or resume a failed connection.

When live ASR succeeds and audio saving is disabled, the flow skips Opus encoding. When audio saving is enabled, encoding and persistence remain part of completion.

## ASR and history metadata

`src/shared/asr.ts` defines a discriminated union:

| `kind` | Meaning |
| --- | --- |
| `final` | A complete, nonempty ASR result |
| `empty` | A completed result with no recognized speech |
| `failed` | Transcription failed, with a classified reason and message |

The union carries Sayrel's session and request IDs, provider ID, selected model, capture path, and available timestamps. These IDs identify the application flow; they are not claimed to be provider-issued session IDs. The coordinator retains original ASR metadata when retrying only refinement.

History keeps separate text layers:

| Field | Contents |
| --- | --- |
| `modeMeta.transcript` and `modeMeta.asr.asrText` | Recognized text before LLM refinement |
| History `refinedText` | Delivered writing-model result, or the original transcript on refinement failure |
| `modeMeta.finalEditedText` | A bounded edit snapshot observed during the learning window |

An edit snapshot can be captured after a pause or Enter. It is not proof that the user sent that exact text. No input-box snapshot is collected for learning unless the learning setting is enabled.

The current adapters do not return dictionary-hit lists or uniform segment confidence and timing. The coordinator does not fabricate those fields.

Diagnostics record connection readiness, first nonempty preview, stop-to-final latency, refinement duration, and insertion duration. Empty results skip refinement and insertion and show a microphone retry message.

## Writing controls

Controls are in **Settings > Personalization**. Defaults are `polishLevel=light`, `writingStyle=neutral`, automatic punctuation enabled, and automatic language detection enabled.

| Cleanup level | Edit budget |
| --- | --- |
| `raw` | Preserve wording, repetitions, fillers, and correction narration; allow clear ASR spelling fixes and basic formatting |
| `light` | Remove meaningless fillers and accidental stutters, apply explicit corrections, and retain the speaker's vocabulary |
| `strong` | Rewrite speech into composed sentences and useful paragraphs or lists while retaining facts and intent |

`writingStyle` controls tone within that edit budget. It accepts `neutral`, `formal`, `casual`, and `concise`. Disabling automatic punctuation tells the writing model not to add punctuation; punctuation already present in ASR output is retained.

With automatic language detection disabled, recognition uses the selected transcription language, then the first preferred language, then English. Fixed language hints take precedence over the broader preferred-language list where supported by the adapter.

The prompt version is `dictation-2026-10-24.3`. Completed refinement metadata includes this version, the provider/model, the actual cleanup level, writing style, punctuation setting, whether the output changed, and duration. Failure metadata retains the request settings; skipping an unconfigured writing model records `reason=no-default-provider`. Older metadata without these fields remains readable. The existing deep-rewrite quality fixtures explicitly request `strong`; they do not silently test the new `light` default against deep-rewrite examples.

Strong cleanup no longer encourages parenthetical task annotations. Valid reasons become ordinary prose; superseded choices and editing narration are omitted. Literal or explicitly dictated parentheses remain intact. This changes the writing policy, not a post-processing regex that deletes bracketed text.

History distinguishes skipped refinement, provider failure, completed unchanged text, and changed text. **View details** shows the original transcript and writing result, with the available model, cleanup level, and prompt version. These states describe execution, not writing quality.

**Refine again with current settings** uses the saved original transcript and current writing settings, without ASR or saved audio. It applies only to normal dictations, opens the result in a card, and never automatically reinserts it. If the request fails or is cancelled, the previous result stays intact. Deleting the history entry during a request prevents it from being recreated by the late result. The floating-bar refinement retry also reads current writing controls, rather than retaining the original cleanup level.

Prompt-contract tests establish request construction and constraints. A limited real-model comparison of synthetic cases was run on 2026-10-24; see `docs/research/refinement-evaluation-2026-10-24.md` for outputs, observed failures and sampling limits. Passing the minimum checks is not proof of fluent writing or general quality.

## Insertion verification

A native return code of zero means dispatch, not confirmed delivery. The main process reads bounded local snapshots before and after one paste, and verifies the exact replacement in the same target. Secure input and marked IME text block dispatch. Unreadable input, target changes, mismatched text and uncertain native errors produce an `unknown` result card, not an automatic second paste. Explicit pre-dispatch unavailability can fall back to manual clipboard delivery.

`modeMeta.insertion` and result cards retain only the delivery verdict, never the temporary field snapshots. The native helper restores all clipboard items/formats only while its `changeCount` still matches, so later copies are not overwritten. Verification does not require dictionary learning or enable context upload. AX-unreadable editors may receive text but still show an unverified result; check the target before copying it again.

## Learning from edits

`dictionaryLearning` defaults to false. When enabled, successful normal dictation captures a local input snapshot immediately before insertion. The native snapshot includes a stable target identity, UTF-16 caret and selection positions, and bounded field text. Secure fields and marked IME text are rejected.

After insertion, tracking first verifies that the delivered text appears in the same field. It samples after 250 ms, then once per second, for at most 15 seconds. A stable edit or Enter can trigger extraction. Focus changes, a new recording, cancellation, or disabling learning stop tracking.

The extractor requires unchanged text before and after the dictated region. It rejects ambiguous boundaries and regions exceeding 1,000 characters. It proposes short replacements, ignores large rewrites, and filters numeric or address-like candidates. Ordinary prose changes can still resemble terms, so users confirm suggestions in **Dictionary** before they are added.

Candidate extraction is local and does not call a model or upload input-box text. Suggestions expire after ten minutes, are bounded to 50 entries, and are deduplicated against the dictionary and other pending suggestions. Request deduplication retains the most recent 100 processed IDs.

Confirmed candidates use `source=auto`. A five-second undo window removes only the unchanged learned entry. Translation, clipboard-only delivery, practice, and history or refinement retries do not start learning. Native helpers without the new snapshot fields simply cannot start tracking.

## Desktop-command first release

`desktopCommandsEnabled` defaults to false. Enabling it exposes a separate configurable shortcut and `desktop_command` recording mode. Existing `voice_command` text-editing behavior is retained.

The command parser accepts one explicit English or Chinese action. It uses an allowlist rather than an LLM planner:

- Open Safari, Finder, Notes, Calendar, or Calculator on macOS.
- Display the text selected when recording started, up to 1,000 characters.
- Display the app focused when recording started.

For example, `Open Notes`, `打开备忘录`, and `读取选中文本` are supported. Compound, negated, ambiguous, file-writing, and sending requests do not produce executable plans. Read-only actions require readable focused-app context.

A complete ASR result creates a confirmation card. The card's ID must match the pending plan, and approval must come from the current card window. Plans expire after two minutes and are consumed before execution, preventing duplicate approvals. New recordings, cancellation, and disabling the feature invalidate pending plans.

Opening apps uses `/usr/bin/open -b` with a fixed bundle ID and no shell. Cancellation aborts a running launcher process; it cannot undo an application that has already opened. History records the source ASR request, parsed action, approval and outcome events when history is enabled.

This release does not implement general desktop planning, file editing, mail, calendar mutations, or Voiskey's full Jev capability set.

## Verification commands

```sh
npm run typecheck
npm run verify:dictation
npm run verify:dictation:ui
npm run verify:voice
npm run verify:settings
npm run verify:providers
npm run build
bash scripts/build-native.sh InputHelper
```

Transport tests use local WebSocket servers. Edit-learning and command tests isolate native and OS boundaries. UI checks use a temporary Electron profile, synthetic data, and blocked external network requests. Their screenshots are written to `.build/dictation-review/` and `.build/refinement-review/`. They do not capture a physical microphone, inspect real user input, call cloud models, or launch real applications.

Live provider compatibility, real ASR accuracy, prompt quality, and native input support in individual host apps need real-world acceptance testing after restarting the app with the rebuilt InputHelper.
