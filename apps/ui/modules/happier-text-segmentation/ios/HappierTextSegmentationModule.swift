import ExpoModulesCore
import NaturalLanguage

public class HappierTextSegmentationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HappierTextSegmentation")

    Function("segmentWords") { (text: String) -> [String] in
      // Each call owns its tokenizer; NLTokenizer instances are not shared
      // across threads. Voice text policy stays in the JS normalizer.
      let tokenizer = NLTokenizer(unit: .word)
      tokenizer.string = text
      return tokenizer.tokens(for: text.startIndex..<text.endIndex).map { String(text[$0]) }
    }
  }
}
