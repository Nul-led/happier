//go:build linux || darwin

package main

import (
	"fmt"
	"syscall"
)

// restoreUnixNonblocking restores the inherited broker connection to the
// non-blocking mode required by Node/libuv before publishing a successful
// identity. Passing the accepted connection through the child-process stdio
// boundary can make the inherited connection blocking; leaving it that way can
// deadlock a full-duplex broker stream once either socket buffer fills.
func restoreUnixNonblocking(fd int) error {
	if err := syscall.SetNonblock(fd, true); err != nil {
		return fmt.Errorf("restore non-blocking inherited descriptor %d: %w", fd, err)
	}
	return nil
}

func emitUnixPeerIdentity(payload map[string]any) error {
	if err := restoreUnixNonblocking(inheritedIpcDescriptor); err != nil {
		return err
	}
	return emit(payload)
}
