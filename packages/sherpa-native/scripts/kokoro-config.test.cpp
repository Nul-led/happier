#include <cassert>
#include <cstring>
#include <stdexcept>
#include "HappierSherpaKokoroConfig.h"

// Sherpa is the external inference boundary. Inspect its real C configuration
// without loading model bytes or substituting the internal configuration owner.
static void AssertFrontend(const SherpaOnnxOfflineTtsConfig &config,
                           const char *lang, const char *lexicon) {
  assert(config.model.kokoro.lang != nullptr);
  assert(config.model.kokoro.lexicon != nullptr);
  assert(std::strcmp(config.model.kokoro.lang, lang) == 0);
  assert(std::strcmp(config.model.kokoro.lexicon, lexicon) == 0);
}

int main() {
  happier_sherpa::KokoroConfig legacy("/packs/legacy");
  AssertFrontend(legacy.config(), "en", "");

  happier_sherpa::KokoroFrontend multilingual{"", "lexicon-en-us.txt"};
  happier_sherpa::KokoroConfig configured("/packs/v1.1", &multilingual);
  AssertFrontend(configured.config(), "", "/packs/v1.1/lexicon-en-us.txt");

  happier_sherpa::KokoroFrontend english{"en", ""};
  happier_sherpa::KokoroConfig explicitEnglish("/packs/en", &english);
  AssertFrontend(explicitEnglish.config(), "en", "");

  bool rejected = false;
  try {
    happier_sherpa::KokoroFrontend empty{"", ""};
    happier_sherpa::KokoroConfig invalid("/packs/invalid", &empty);
  } catch (const std::invalid_argument &) { rejected = true; }
  assert(rejected);
}
