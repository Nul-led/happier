#pragma once

#include <stddef.h>
#include <sherpa-onnx/c-api/c-api.h>

// Pinned v1.12.25 C layouts for the 32-bit and 64-bit Android/iOS ABIs.
// Keep these independent of our configuration/bridge code so header drift fails
// the actual platform compilation before a malformed struct reaches sherpa.
static_assert(sizeof(void *) == 4 || sizeof(void *) == 8);
static_assert(sizeof(SherpaOnnxOnlineModelConfig) == (sizeof(void *) == 8 ? 136 : 68));
static_assert(sizeof(SherpaOnnxOnlineRecognizerConfig) == (sizeof(void *) == 8 ? 272 : 148));
static_assert(sizeof(SherpaOnnxOnlineRecognizerResult) == (sizeof(void *) == 8 ? 48 : 24));
static_assert(sizeof(SherpaOnnxOfflineTtsModelConfig) == (sizeof(void *) == 8 ? 352 : 196));
static_assert(sizeof(SherpaOnnxOfflineTtsConfig) == (sizeof(void *) == 8 ? 384 : 212));
static_assert(sizeof(SherpaOnnxGenerationConfig) == (sizeof(void *) == 8 ? 56 : 36));
static_assert(sizeof(SherpaOnnxGeneratedAudio) == (sizeof(void *) == 8 ? 16 : 12));
static_assert(sizeof(SherpaOnnxVadModelConfig) == (sizeof(void *) == 8 ? 88 : 64));
static_assert(offsetof(SherpaOnnxOnlineModelConfig, transducer) == 0);
static_assert(offsetof(SherpaOnnxOnlineModelConfig, tokens) == (sizeof(void *) == 8 ? 48 : 24));
static_assert(offsetof(SherpaOnnxOnlineModelConfig, provider) == (sizeof(void *) == 8 ? 64 : 32));
static_assert(offsetof(SherpaOnnxOnlineRecognizerConfig, model_config) == 8);
static_assert(offsetof(SherpaOnnxOnlineRecognizerConfig, decoding_method) == (sizeof(void *) == 8 ? 144 : 76));
static_assert(offsetof(SherpaOnnxOnlineRecognizerResult, count) == (sizeof(void *) == 8 ? 32 : 16));
static_assert(offsetof(SherpaOnnxOfflineTtsModelConfig, kokoro) == (sizeof(void *) == 8 ? 128 : 76));
static_assert(offsetof(SherpaOnnxOfflineTtsConfig, max_num_sentences) == (sizeof(void *) == 8 ? 360 : 200));
