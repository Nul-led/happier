#pragma once

#include <string>
#include <stdexcept>
#include <sherpa-onnx/c-api/c-api.h>

namespace happier_sherpa {

struct KokoroFrontend {
  std::string lang;
  std::string lexicon;
};

// Own every string until the synchronous external CreateOfflineTts call returns.
// This config owner is shared by Android and iOS; the assets-directory cache
// continues to own engine lifetime and model-pack invalidation.
class KokoroConfig {
 public:
  explicit KokoroConfig(const std::string &assetsDir, const KokoroFrontend *frontend = nullptr)
      : model_(assetsDir + "/model.onnx"), voices_(assetsDir + "/voices.bin"),
        tokens_(assetsDir + "/tokens.txt"), dataDir_(assetsDir + "/espeak-ng-data"),
        lang_(frontend ? frontend->lang : "en"),
        lexicon_(frontend && !frontend->lexicon.empty() ? assetsDir + "/" + frontend->lexicon : "") {
    if (lang_.empty() && lexicon_.empty()) {
      throw std::invalid_argument("Kokoro requires a frontend language or lexicon");
    }
  }

  SherpaOnnxOfflineTtsConfig config() const {
    SherpaOnnxOfflineTtsConfig value{};
    value.model.num_threads = 2;
    value.model.provider = "cpu";
    value.max_num_sentences = 1;
    value.silence_scale = 0.2f;
    value.model.kokoro.model = model_.c_str();
    value.model.kokoro.voices = voices_.c_str();
    value.model.kokoro.tokens = tokens_.c_str();
    value.model.kokoro.data_dir = dataDir_.c_str();
    value.model.kokoro.length_scale = 1.0f;
    value.model.kokoro.lang = lang_.c_str();
    value.model.kokoro.lexicon = lexicon_.c_str();
    return value;
  }

 private:
  std::string model_, voices_, tokens_, dataDir_, lang_, lexicon_;
};

}  // namespace happier_sherpa
