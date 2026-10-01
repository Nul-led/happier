import React from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { themeIcons, type SetiTheme } from '@peoplesgrocers/seti-ui-file-icons';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';

interface FileIconProps {
    fileName: string;
    size?: number;
    testID?: string;
    /**
     * `tile` (default): the type's own filled mark. `line`: the one file glyph in the type's tint — the
     * quieter mark a dense tree uses (session tabs lab F1), so names read before marks.
     */
    appearance?: 'tile' | 'line';
}

const lightColorTheme: SetiTheme = {
    blue: '#268bd2',
    grey: '#6b7280',
    'grey-light': '#9ca3af',
    green: '#059669',
    orange: '#d97706',
    pink: '#db2777',
    purple: '#7c3aed',
    red: '#dc2626',
    white: '#374151',
    yellow: '#eab308',
    ignore: '#9ca3af',
};

const darkColorTheme: SetiTheme = {
    blue: '#268bd2',
    grey: '#eee',
    'grey-light': '#839496',
    green: '#4bae4f',
    orange: '#cb4b16',
    pink: '#d33682',
    purple: '#6c71c4',
    red: '#dc322f',
    white: '#fdf6e3',
    yellow: '#ffcb29',
    ignore: '#586e75',
};

export const FileIcon: React.FC<FileIconProps> = ({ 
    fileName, 
    size = 24, 
    testID,
    appearance = 'tile',
}) => {
    const { theme } = useUnistyles();
    
    const colorTheme = theme.dark ? darkColorTheme : lightColorTheme;
    const themedGetIcon = themeIcons(colorTheme);
    
    const iconData = themedGetIcon(fileName);

    if (appearance === 'line') {
        return (
            <View testID={testID} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="file" size={size} color={iconData.color} />
            </View>
        );
    }
    
    return (
        <View testID={testID} style={{ width: size, height: size }}>
            <SvgXml
                xml={iconData.svg}
                width={size}
                height={size}
                fill={iconData.color}
            />
        </View>
    );
};

export default FileIcon;
