import * as React from 'react';
import { Platform, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { HappierStoredImage } from '@happier-dev/plugin-ui/presentation';
import { WebIframeEngine } from '@/components/browser/frame/engines/WebIframeEngine';

export type FileUriPreviewProps = Readonly<{
    uri: string;
    mime: string;
    title: string;
    fallback: React.ReactNode;
    onOpenImage?: () => void;
}>;

/** Local-file composition of the existing image and URI engines. HTML is never rendered. */
export function FileUriPreview(props: FileUriPreviewProps): React.ReactElement {
    const { theme } = useUnistyles();
    if (props.mime.startsWith('image/')) return <HappierStoredImage
        identity={props.uri} status="loaded" uri={props.uri} accessibilityLabel={props.title}
        borderColor={theme.colors.border.default} backgroundColor={theme.colors.surface.elevated}
        placeholder={props.fallback} onPress={props.onOpenImage} imageTestID="file:imagePreview" />;
    if (Platform.OS === 'web' && props.mime === 'application/pdf') return <View style={{ height: 560, minHeight: 0 }}>
        <WebIframeEngine url={props.uri} title={props.title} sandbox="" referrerPolicy="no-referrer" testID="file:pdfPreview" />
    </View>;
    // Native PDF embedding is not assumed: the caller offers the OS open/share action.
    return <>{props.fallback}</>;
}
