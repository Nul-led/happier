const { withMainActivity } = require('@expo/config-plugins');

const KEY_EVENT_IMPORT_KOTLIN = 'import android.view.KeyEvent';
const BRIDGE_IMPORT_KOTLIN = 'import dev.happier.hardwarekeyboardshortcuts.HappierHardwareKeyboardShortcutsBridge';
const KEY_EVENT_IMPORT_JAVA = 'import android.view.KeyEvent;';
const BRIDGE_IMPORT_JAVA = 'import dev.happier.hardwarekeyboardshortcuts.HappierHardwareKeyboardShortcutsBridge;';
const KOTLIN_BRIDGE_CALL = 'HappierHardwareKeyboardShortcutsBridge.dispatchKeyEvent(event, currentFocus)';
const JAVA_BRIDGE_CALL = 'HappierHardwareKeyboardShortcutsBridge.dispatchKeyEvent(event, getCurrentFocus())';

function insertKotlinImport(contents, importLine) {
  if (contents.includes(importLine)) return contents;
  const packageMatch = contents.match(/^package\s+[^\n]+\n/m);
  if (!packageMatch) return `${importLine}\n${contents}`;
  const insertAt = packageMatch.index + packageMatch[0].length;
  return `${contents.slice(0, insertAt)}${importLine}\n${contents.slice(insertAt)}`;
}

function insertJavaImport(contents, importLine) {
  if (contents.includes(importLine)) return contents;
  const packageMatch = contents.match(/^package\s+[^;]+;\n/m);
  if (!packageMatch) return `${importLine}\n${contents}`;
  const insertAt = packageMatch.index + packageMatch[0].length;
  return `${contents.slice(0, insertAt)}${importLine}\n${contents.slice(insertAt)}`;
}

function hasKotlinBridgeGuardInsideDispatchKeyEvent(contents) {
  return /override\s+fun\s+dispatchKeyEvent\s*\(\s*event\s*:\s*KeyEvent\s*\)\s*:\s*Boolean\s*\{[\s\S]*?HappierHardwareKeyboardShortcutsBridge\.dispatchKeyEvent\(event,\s*currentFocus\)[\s\S]*?\n\s{2}\}/m
    .test(contents);
}

function hasJavaBridgeGuardInsideDispatchKeyEvent(contents) {
  return /public\s+boolean\s+dispatchKeyEvent\s*\(\s*KeyEvent\s+event\s*\)\s*\{[\s\S]*?HappierHardwareKeyboardShortcutsBridge\.dispatchKeyEvent\(event,\s*getCurrentFocus\(\)\)[\s\S]*?\n\s{2}\}/m
    .test(contents);
}

function upgradeKotlinLegacyBridgeGuard(contents) {
  return contents.replace(
    /(override\s+fun\s+dispatchKeyEvent\s*\(\s*event\s*:\s*KeyEvent\s*\)\s*:\s*Boolean\s*\{[\s\S]*?)HappierHardwareKeyboardShortcutsBridge\.dispatchKeyEvent\(event\)([\s\S]*?\n\s{2}\})/m,
    (_match, beforeCall, afterCall) => `${beforeCall}${KOTLIN_BRIDGE_CALL}${afterCall}`,
  );
}

function upgradeJavaLegacyBridgeGuard(contents) {
  return contents.replace(
    /(public\s+boolean\s+dispatchKeyEvent\s*\(\s*KeyEvent\s+event\s*\)\s*\{[\s\S]*?)HappierHardwareKeyboardShortcutsBridge\.dispatchKeyEvent\(event\)([\s\S]*?\n\s{2}\})/m,
    (_match, beforeCall, afterCall) => `${beforeCall}${JAVA_BRIDGE_CALL}${afterCall}`,
  );
}

function addKotlinDispatchKeyEvent(contents) {
  let next = upgradeKotlinLegacyBridgeGuard(contents);
  if (hasKotlinBridgeGuardInsideDispatchKeyEvent(next)) return next;
  next = insertKotlinImport(next, KEY_EVENT_IMPORT_KOTLIN);
  next = insertKotlinImport(next, BRIDGE_IMPORT_KOTLIN);

  const existingOverride = next.match(/override\s+fun\s+dispatchKeyEvent\s*\(\s*event\s*:\s*KeyEvent\s*\)\s*:\s*Boolean\s*\{/m);
  if (existingOverride?.index !== undefined) {
    const insertAt = existingOverride.index + existingOverride[0].length;
    return `${next.slice(0, insertAt)}
    if (HappierHardwareKeyboardShortcutsBridge.dispatchKeyEvent(event, currentFocus)) {
      return true
    }${next.slice(insertAt)}`;
  }
  if (/fun\s+dispatchKeyEvent\s*\(/.test(next)) {
    throw new Error('Unable to patch Kotlin MainActivity with Happier hardware keyboard dispatchKeyEvent bridge.');
  }

  const method = [
    '',
    '  override fun dispatchKeyEvent(event: KeyEvent): Boolean {',
    `    if (${KOTLIN_BRIDGE_CALL}) {`,
    '      return true',
    '    }',
    '    return super.dispatchKeyEvent(event)',
    '  }',
    '',
  ].join('\n');

  const classMatch = next.match(/class\s+MainActivity[^\{]*\{/m);
  if (!classMatch) {
    throw new Error('Unable to patch Kotlin MainActivity with Happier hardware keyboard dispatchKeyEvent bridge.');
  }
  const insertAt = classMatch.index + classMatch[0].length;
  return `${next.slice(0, insertAt)}${method}${next.slice(insertAt)}`;
}

function addJavaDispatchKeyEvent(contents) {
  let next = upgradeJavaLegacyBridgeGuard(contents);
  if (hasJavaBridgeGuardInsideDispatchKeyEvent(next)) return next;
  next = insertJavaImport(next, KEY_EVENT_IMPORT_JAVA);
  next = insertJavaImport(next, BRIDGE_IMPORT_JAVA);

  const existingOverride = next.match(/public\s+boolean\s+dispatchKeyEvent\s*\(\s*KeyEvent\s+event\s*\)\s*\{/m);
  if (existingOverride?.index !== undefined) {
    const insertAt = existingOverride.index + existingOverride[0].length;
    return `${next.slice(0, insertAt)}
    if (HappierHardwareKeyboardShortcutsBridge.dispatchKeyEvent(event, getCurrentFocus())) {
      return true;
    }${next.slice(insertAt)}`;
  }
  if (/\bboolean\s+dispatchKeyEvent\s*\(/.test(next)) {
    throw new Error('Unable to patch Java MainActivity with Happier hardware keyboard dispatchKeyEvent bridge.');
  }

  const method = [
    '',
    '  @Override',
    '  public boolean dispatchKeyEvent(KeyEvent event) {',
    `    if (${JAVA_BRIDGE_CALL}) {`,
    '      return true;',
    '    }',
    '    return super.dispatchKeyEvent(event);',
    '  }',
    '',
  ].join('\n');

  const classMatch = next.match(/class\s+MainActivity[^\{]*\{/m);
  if (!classMatch) {
    throw new Error('Unable to patch Java MainActivity with Happier hardware keyboard dispatchKeyEvent bridge.');
  }
  const insertAt = classMatch.index + classMatch[0].length;
  return `${next.slice(0, insertAt)}${method}${next.slice(insertAt)}`;
}

const withHappierHardwareKeyboardShortcuts = (config) => withMainActivity(config, (mainActivityConfig) => {
  const language = mainActivityConfig.modResults.language;
  const contents = mainActivityConfig.modResults.contents;
  mainActivityConfig.modResults.contents = language === 'java'
    ? addJavaDispatchKeyEvent(contents)
    : addKotlinDispatchKeyEvent(contents);
  return mainActivityConfig;
});

withHappierHardwareKeyboardShortcuts.addKotlinDispatchKeyEvent = addKotlinDispatchKeyEvent;
withHappierHardwareKeyboardShortcuts.addJavaDispatchKeyEvent = addJavaDispatchKeyEvent;

module.exports = withHappierHardwareKeyboardShortcuts;
