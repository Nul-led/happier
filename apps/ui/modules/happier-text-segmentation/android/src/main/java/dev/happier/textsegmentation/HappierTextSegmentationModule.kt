package dev.happier.textsegmentation

import android.icu.text.BreakIterator
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class HappierTextSegmentationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HappierTextSegmentation")

    // ICU's dictionary-backed word boundaries cover unspaced CJK and Thai.
    // Meaningful-text filtering and all voice policy remain in the JS owner.
    Function("segmentWords") { text: String ->
      val iterator = BreakIterator.getWordInstance(Locale.ROOT)
      iterator.setText(text)
      val segments = mutableListOf<String>()
      var start = iterator.first()
      var end = iterator.next()
      while (end != BreakIterator.DONE) {
        segments.add(text.substring(start, end))
        start = end
        end = iterator.next()
      }
      segments
    }
  }
}
