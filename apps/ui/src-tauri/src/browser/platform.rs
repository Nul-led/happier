use super::types::{
    DesktopBrowserAvailability, DesktopBrowserDisabledReason, DesktopBrowserPlatform,
    DesktopBrowserPrimitive, DesktopBrowserSupport,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DesktopBrowserRuntimeSupport {
    pub macos_custom_data_store_identifiers: bool,
}

pub(crate) fn resolve_current_desktop_browser_platform() -> DesktopBrowserPlatform {
    if cfg!(target_os = "macos") {
        return DesktopBrowserPlatform::MacOs;
    }
    if cfg!(target_os = "windows") {
        return DesktopBrowserPlatform::Windows;
    }
    if cfg!(target_os = "linux") {
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return DesktopBrowserPlatform::LinuxWayland;
        }
        if std::env::var_os("DISPLAY").is_some() {
            return DesktopBrowserPlatform::LinuxX11;
        }
        return DesktopBrowserPlatform::LinuxUnknown;
    }
    DesktopBrowserPlatform::Unsupported
}

pub(crate) fn resolve_current_desktop_browser_strategy() -> DesktopBrowserAvailability {
    resolve_desktop_browser_strategy(resolve_current_desktop_browser_platform())
}

pub(crate) fn resolve_desktop_browser_strategy(
    platform: DesktopBrowserPlatform,
) -> DesktopBrowserAvailability {
    resolve_desktop_browser_strategy_for_runtime(
        platform,
        resolve_current_desktop_browser_runtime_support(),
    )
}

pub(crate) fn resolve_desktop_browser_strategy_for_runtime(
    platform: DesktopBrowserPlatform,
    runtime_support: DesktopBrowserRuntimeSupport,
) -> DesktopBrowserAvailability {
    match platform {
        DesktopBrowserPlatform::MacOs
            if runtime_support.macos_custom_data_store_identifiers
                && child_embedding_supported_for(platform) =>
        {
            native_child_view_availability(platform, DesktopBrowserPrimitive::MacOsNsViewWebKit)
        }
        DesktopBrowserPlatform::MacOs => DesktopBrowserAvailability::unavailable(
            platform,
            DesktopBrowserPrimitive::MacOsNsViewWebKit,
            DesktopBrowserDisabledReason::NativeChildViewUnverified,
        ),
        DesktopBrowserPlatform::Windows => {
            native_child_view_availability(platform, DesktopBrowserPrimitive::WindowsHwndWebView2)
        }
        DesktopBrowserPlatform::LinuxX11 => {
            native_child_view_availability(
                platform,
                DesktopBrowserPrimitive::LinuxX11ChildEmbedding,
            )
        }
        DesktopBrowserPlatform::LinuxWayland => DesktopBrowserAvailability::unavailable(
            platform,
            DesktopBrowserPrimitive::LinuxWaylandGtkEmbedding,
            DesktopBrowserDisabledReason::LinuxWaylandGtkEmbeddingUnimplemented,
        ),
        DesktopBrowserPlatform::LinuxUnknown => DesktopBrowserAvailability::unavailable(
            platform,
            DesktopBrowserPrimitive::Disabled,
            DesktopBrowserDisabledReason::LinuxDisplayUnavailable,
        ),
        DesktopBrowserPlatform::Unsupported => DesktopBrowserAvailability::unavailable(
            platform,
            DesktopBrowserPrimitive::Disabled,
            DesktopBrowserDisabledReason::UnsupportedPlatform,
        ),
    }
}

fn native_child_view_availability(
    platform: DesktopBrowserPlatform,
    primitive: DesktopBrowserPrimitive,
) -> DesktopBrowserAvailability {
    DesktopBrowserAvailability::available(
        platform,
        primitive,
        DesktopBrowserSupport {
            navigation: true,
            // Reload/stop ride `desktop_browser_dispatch_navigation`, which derives a FIXED
            // `location.reload()` / `window.stop()` script from its kind and pushes it through
            // `WebView::evaluate_script`. That is the SAME primitive the in-page diagnostics eval
            // REPL and element picker already ship on every platform this function returns
            // available for (`page_info_diagnostics: true` below gates a strictly LARGER injection
            // surface — arbitrary caller-supplied script — than these two fixed ones). So the
            // pending "does Wry honour injection here" question these bits waited on is already
            // answered affirmatively by a shipped capability on the identical code path; keeping
            // them false only disabled two buttons whose seam works.
            reload: true,
            stop: true,
            go_back_forward: true,
            automation: true,
            page_info_diagnostics: true,
            native_devtools: native_devtools_supported(),
            capture: native_capture_supported(platform),
            ..DesktopBrowserSupport::default()
        },
    )
}

fn native_capture_supported(platform: DesktopBrowserPlatform) -> bool {
    matches!(platform, DesktopBrowserPlatform::MacOs)
}

/// Whether this shell links an implemented Wry child-embedding path (`build_as_child`) for a
/// platform. This is the single owner of that structural fact, and it answers only "can an
/// embedded child webview be constructed here" — never "has a product surface been QA'd here".
///
/// Derived from the vendored Wry implementation, one named fact per arm:
/// - macOS — `wkwebview::InnerWebView::new_as_child` adds the `WKWebView` as an `NSView` subview
///   of the parent window's content view.
/// - Windows — `webview2::InnerWebView::new_as_child` hosts the WebView2 controller on a child
///   `HWND` of the parent window.
/// - Linux/X11 — `webkitgtk::InnerWebView::new_as_child` reparents a native X11 container window
///   under the parent's `RawWindowHandle::Xlib`, which stacks above the host window's own
///   rendering.
/// - Linux/Wayland — that same constructor returns `wry::Error::UnsupportedWindowHandle` for a
///   `RawWindowHandle::Wayland` parent: Wayland has no X11-style native subwindow. Wry's supported
///   Wayland route is `WebViewBuilderExtUnix::build_gtk` against an app-owned `gtk::Fixed`, which
///   is a different host widget topology and is not built here.
/// - No display / non-desktop targets — there is no host window to embed into.
///
/// Product surfaces use this implementation fact independently of their manual-QA schedule.
pub(crate) fn child_embedding_supported_for(platform: DesktopBrowserPlatform) -> bool {
    match platform {
        DesktopBrowserPlatform::MacOs
        | DesktopBrowserPlatform::Windows
        | DesktopBrowserPlatform::LinuxX11 => true,
        DesktopBrowserPlatform::LinuxWayland
        | DesktopBrowserPlatform::LinuxUnknown
        | DesktopBrowserPlatform::Unsupported => false,
    }
}

fn resolve_current_desktop_browser_runtime_support() -> DesktopBrowserRuntimeSupport {
    DesktopBrowserRuntimeSupport {
        macos_custom_data_store_identifiers: macos_custom_data_store_identifiers_supported(),
    }
}

#[cfg(target_os = "macos")]
fn macos_custom_data_store_identifiers_supported() -> bool {
    use objc2_foundation::NSProcessInfo;

    let process_info = NSProcessInfo::processInfo();
    let version = process_info.operatingSystemVersion();
    version.majorVersion >= 14
}

#[cfg(not(target_os = "macos"))]
fn macos_custom_data_store_identifiers_supported() -> bool {
    false
}

pub(crate) fn native_devtools_supported() -> bool {
    cfg!(any(debug_assertions, feature = "devtools"))
}
