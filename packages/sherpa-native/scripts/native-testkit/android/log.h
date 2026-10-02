#pragma once

// Android logging is an OS boundary; host syntax checks use real JNI headers
// and the pinned sherpa header, with only this unavailable platform API declared.
enum { ANDROID_LOG_ERROR = 6 };
extern "C" int __android_log_print(int priority, const char *tag, const char *format, ...);
