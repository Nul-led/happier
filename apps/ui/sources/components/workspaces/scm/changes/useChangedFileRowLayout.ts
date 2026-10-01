import { useSetting } from '@/sync/domains/state/storage';

/**
 * How a changed-file row reads, from the one user setting (`filesChangedFilesRowDensity`): the name
 * first everywhere, with its folder beneath (default) or after it on the same line (compact). Git's
 * changed files, Review's file list and its stream all read it here.
 */
export function useChangedFileRowLayout(): 'stacked' | 'compact' {
    return useSetting('filesChangedFilesRowDensity') === 'compact' ? 'compact' : 'stacked';
}
