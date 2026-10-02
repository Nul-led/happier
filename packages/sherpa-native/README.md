# @happier-dev/sherpa-native

Expo native module for on-device Kokoro TTS and streaming transducer ASR (iOS/Android).

Native library acquisition is pinned by `sherpaOnnxVersion` in `package.json`.
Android vendors the complete, unchanged [upstream v1.12.25 C header](https://github.com/k2-fsa/sherpa-onnx/blob/v1.12.25/sherpa-onnx/c-api/c-api.h),
copyright Xiaomi Corporation, under Apache-2.0. Both platform builds enforce its
32-bit/64-bit configuration layouts with static assertions. An environment
version override must match this pin; changing the runtime requires updating the
header and ABI checks together.

Both native ASR adapters use the shared 16 kHz transducer configuration and
finish routine. Finish appends 0.3 seconds of silence at the accepted input rate before marking input
finished and draining ready chunks, following the pinned [upstream C recipe](https://github.com/k2-fsa/sherpa-onnx/blob/v1.12.25/c-api-examples/decode-file-c-api.c).
Cancellation remains visible between decode iterations. The daemon's separately
versioned JavaScript binding uses its own supported upstream recipe.

Release validation: on physical iOS and Android, load the installed Zipformer
pack, create the recognizer, transcribe short utterances ending in consonants,
finish immediately after the final accepted frame, and verify the last word.
Repeat with silence and cancellation during the drain, then restart recognition.
Host ABI/cancellation tests do not establish acoustic or device inference results.

`initialize`, `listVoices`, and `synthesizeToWavFile` accept the manifest-resolved
`frontend: { lang, lexicon }`. The lexicon names an installed file relative to
`assetsDir`; the shared native configuration expands that path before creating
the engine. An empty language requires a lexicon. Older bundles that omit
`frontend` retain the English (`en`) frontend with no lexicon.
