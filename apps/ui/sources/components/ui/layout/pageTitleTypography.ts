import { HAPPIER_PAGE_TEXT } from '@happier-dev/plugin-ui/presentation';
import { Typography } from '@/constants/Typography';

/**
 * The page/screen title step: the large, tightly tracked title a full page
 * opens with. `PageHeader` renders it, and plugin surfaces receive it as their
 * `heading` type role (`pluginUiThemeProjection.ts`), so a plugin page heading
 * and a host page title are one size.
 */
// The return type is inferred on purpose: an explicit `TextStyle` widens the object, and spreading it
// into a unistyles `StyleSheet.create` callback then fails to type-check.
export function pageTitleTypography() {
    return {
        ...Typography.default('bold'),
        // The step's metrics are the shared page type scale (`HAPPIER_PAGE_TEXT`), which a plugin
        // page title draws with too.
        fontSize: HAPPIER_PAGE_TEXT.pageTitle.fontSize,
        lineHeight: HAPPIER_PAGE_TEXT.pageTitle.lineHeight,
        letterSpacing: HAPPIER_PAGE_TEXT.pageTitle.letterSpacing ?? 0,
    };
}
