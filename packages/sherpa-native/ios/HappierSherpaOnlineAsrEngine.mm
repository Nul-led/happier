#import "HappierSherpaOnlineAsrEngine.h"
#import "HappierSherpaAsrStreamRegistry.h"
#import "HappierSherpaOnlineAsr.h"

#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <sherpa-onnx/c-api/c-api.h>

namespace {

// Both platforms consume the pinned upstream const-qualified handle contract.
using AsrStreams = happier_sherpa::AsrStreamRegistry<const SherpaOnnxOnlineRecognizer, const SherpaOnnxOnlineStream>;

AsrStreams &AsrJobs() {
  static AsrStreams registry;
  return registry;
}

std::string NsToStd(NSString *s) {
  if (!s) return std::string();
  const char *c = [s UTF8String];
  return std::string(c ? c : "");
}

bool Exists(const std::string &path) {
  return SherpaOnnxFileExists(path.c_str()) != 0;
}

void SetError(NSError * _Nullable * _Nullable error, NSInteger code, NSString *message) {
  if (error) {
    *error = [NSError errorWithDomain:@"HappierSherpaNative" code:code userInfo:@{NSLocalizedDescriptionKey: message}];
  }
}

std::shared_ptr<const SherpaOnnxOnlineRecognizer> CreateRecognizer(const std::string &assetsDir,
                                                                   NSError * _Nullable * _Nullable error) {
  const std::string tokensPath = assetsDir + "/tokens.txt";
  const std::string encoderPath = assetsDir + "/encoder.onnx";
  const std::string decoderPath = assetsDir + "/decoder.onnx";
  const std::string joinerPath = assetsDir + "/joiner.onnx";

  if (!Exists(tokensPath) || !Exists(encoderPath) || !Exists(decoderPath) || !Exists(joinerPath)) {
    SetError(error, 201, @"Missing required streaming ASR assets");
    return nullptr;
  }

  const auto config = happier_sherpa::OnlineTransducerConfig(
      tokensPath.c_str(), encoderPath.c_str(), decoderPath.c_str(), joinerPath.c_str());

  const SherpaOnnxOnlineRecognizer *recognizer = SherpaOnnxCreateOnlineRecognizer(&config);
  if (!recognizer) {
    SetError(error, 202, @"Failed to initialize sherpa online ASR recognizer");
    return nullptr;
  }

  return std::shared_ptr<const SherpaOnnxOnlineRecognizer>(recognizer, SherpaOnnxDestroyOnlineRecognizer);
}

/**
 * Lease the recognizer for `assetsDir`, building it on first use. The registry
 * owns the whole find/create/publish sequence: creation runs outside its lock,
 * because it loads a model and would block invalidation for seconds, and the
 * registry refuses the publication when a pack invalidation overtook that load.
 */
std::shared_ptr<const SherpaOnnxOnlineRecognizer> GetOrCreateRecognizer(const std::string &assetsDir,
                                                                        NSError * _Nullable * _Nullable error) {
  const auto recognizer = AsrJobs().leaseOrCreateRecognizer(assetsDir, [&] { return CreateRecognizer(assetsDir, error); });
  if (!recognizer && error && !*error) {
    // Creation succeeded but the pack it was built from was retired while it
    // loaded, so there is no creation error to report.
    SetError(error, 203, @"Model pack was invalidated while the ASR recognizer was loading");
  }
  return recognizer;
}

std::vector<float> Pcm16LeToMonoFloats(NSData *pcm16le, int32_t channels) {
  const int16_t *samples16 = reinterpret_cast<const int16_t *>(pcm16le.bytes);
  const size_t count16 = pcm16le.length / sizeof(int16_t);
  if (!samples16 || count16 == 0) return {};

  const int32_t ch = channels > 0 ? channels : 1;
  std::vector<float> mono;
  if (ch == 1) {
    mono.resize(count16);
    for (size_t i = 0; i < count16; i++) {
      mono[i] = static_cast<float>(samples16[i]) / 32768.0f;
    }
    return mono;
  }

  const size_t frames = count16 / static_cast<size_t>(ch);
  mono.resize(frames);
  for (size_t i = 0; i < frames; i++) {
    int32_t sum = 0;
    for (int32_t c = 0; c < ch; c++) {
      sum += samples16[i * static_cast<size_t>(ch) + static_cast<size_t>(c)];
    }
    mono[i] = (static_cast<float>(sum) / static_cast<float>(ch)) / 32768.0f;
  }
  return mono;
}

}  // namespace

@implementation HappierSherpaOnlineAsrEngine

+ (BOOL)createStreamForJob:(NSString *)jobId
                 assetsDir:(NSString *)assetsDir
                     error:(NSError * _Nullable * _Nullable)error {
  const std::string jobKey = NsToStd(jobId);
  const std::string dir = NsToStd(assetsDir);
  if (jobKey.empty()) {
    SetError(error, 205, @"jobId is required");
    return NO;
  }
  if (dir.empty()) {
    SetError(error, 200, @"assetsDir is empty");
    return NO;
  }

  auto recognizer = GetOrCreateRecognizer(dir, error);
  if (!recognizer) {
    return NO;
  }

  const SherpaOnnxOnlineStream *stream = SherpaOnnxCreateOnlineStream(recognizer.get());
  if (!stream) {
    SetError(error, 204, @"Failed to create ASR stream");
    return NO;
  }

  const auto job = AsrJobs().beginJob(
      jobKey, dir, std::move(recognizer),
      std::shared_ptr<const SherpaOnnxOnlineStream>(stream, SherpaOnnxDestroyOnlineStream));
  if (!job) {
    SetError(error, 204, @"Failed to create ASR stream");
    return NO;
  }
  return YES;
}

+ (NSDictionary *)pushPcm16Data:(NSData *)pcm16le
                         forJob:(NSString *)jobId
                     sampleRate:(int32_t)sampleRate
                       channels:(int32_t)channels
                          error:(NSError * _Nullable * _Nullable)error {
  // Holding the job keeps the stream and its recognizer alive for this whole
  // decode, so a cancel racing this call can only mark it.
  const auto job = AsrJobs().findJob(NsToStd(jobId));
  if (!job) {
    SetError(error, 210, @"ASR stream not initialized");
    return @{};
  }
  // A cancelled or draining job is still registered, but its stream no longer
  // takes audio; report an empty decode rather than feeding a closed stream.
  if (job->cancelled() || job->finishing()) {
    return @{@"text": @"", @"isEndpoint": @NO};
  }

  const std::vector<float> mono = Pcm16LeToMonoFloats(pcm16le, channels);
  if (mono.empty()) {
    return @{@"text": @"", @"isEndpoint": @NO};
  }

  const int32_t inputSampleRate = sampleRate > 0 ? sampleRate : 16000;
  job->recordInputSampleRate(inputSampleRate);
  SherpaOnnxOnlineStreamAcceptWaveform(job->stream(), inputSampleRate, mono.data(),
                                       static_cast<int32_t>(mono.size()));

  while (!job->cancelled() && SherpaOnnxIsOnlineStreamReady(job->recognizer(), job->stream())) {
    SherpaOnnxDecodeOnlineStream(job->recognizer(), job->stream());
  }
  if (job->cancelled()) {
    return @{@"text": @"", @"isEndpoint": @NO};
  }

  const SherpaOnnxOnlineRecognizerResult *result = SherpaOnnxGetOnlineStreamResult(job->recognizer(), job->stream());
  std::string text;
  if (result && result->text) {
    text = std::string(result->text);
  }
  if (result) {
    SherpaOnnxDestroyOnlineRecognizerResult(result);
  }

  const bool endpoint = SherpaOnnxOnlineStreamIsEndpoint(job->recognizer(), job->stream()) != 0;

  return @{
    @"text": [NSString stringWithUTF8String:text.c_str()],
    @"isEndpoint": endpoint ? @YES : @NO,
  };
}

+ (NSDictionary *)finishJob:(NSString *)jobId {
  // Claiming the tail decode keeps the job registered, so a cancel or a pack
  // invalidation arriving while it drains still reaches it. This scope holds the
  // only remaining reference once it is retired, so the stream dies with it.
  const std::string jobKey = NsToStd(jobId);
  const auto job = AsrJobs().beginFinish(jobKey);
  // Nothing live under this id: it was cancelled, its pack was invalidated, or
  // another caller is already draining it. There is no transcript to report, and
  // reporting one as empty text is what let the JS controller promote its last
  // interim partial to a final.
  if (!job) {
    return @{@"status": @"missing"};
  }

  if (job->cancelled()) {
    AsrJobs().endFinish(jobKey, job);
    return @{@"status": @"cancelled"};
  }

  if (!happier_sherpa::FinishOnlineTransducer(
          job->recognizer(), job->stream(), [&] { return job->cancelled(); }, job->inputSampleRate())) {
    AsrJobs().endFinish(jobKey, job);
    return @{@"status": @"cancelled"};
  }

  std::string text;
  const SherpaOnnxOnlineRecognizerResult *result =
      SherpaOnnxGetOnlineStreamResult(job->recognizer(), job->stream());
  if (result && result->text) {
    text = std::string(result->text);
  }
  if (result) {
    SherpaOnnxDestroyOnlineRecognizerResult(result);
  }

  AsrJobs().endFinish(jobKey, job);
  // A finalized empty utterance -- silence -- is a successful empty transcript.
  return @{@"status": @"finalized", @"text": [NSString stringWithUTF8String:text.c_str()]};
}

+ (void)cancelJob:(NSString *)jobId {
  AsrJobs().cancelJob(NsToStd(jobId));
}

+ (NSUInteger)releaseAssetsDir:(NSString *)assetsDir {
  const std::string dir = NsToStd(assetsDir);
  if (dir.empty()) return 0;
  return static_cast<NSUInteger>(AsrJobs().releaseAssetsDir(dir));
}

+ (NSUInteger)releaseAll {
  return static_cast<NSUInteger>(AsrJobs().releaseAll());
}

@end
