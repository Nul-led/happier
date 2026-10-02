import 'react-native-svg';

declare module 'react-native-svg' {
    interface SvgProps {
        // Phosphor's published TSX leaves use this supported web SVG prop, omitted by the native declaration.
        className?: string;
    }
}
