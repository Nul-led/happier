//go:build linux

// Linux peer identity through the real kernel primitive: SO_PEERCRED on the
// inherited accepted connection returns the connected process's pid, uid and
// gid from the kernel, not from /proc or any heuristic. The helper reads the
// fixed extra descriptor only and never touches the byte stream, so the
// parent's socket stays fully functional.
package main

import (
	"fmt"
	"os"
	"syscall"
)

func peerIdentityCommand(args []string) error {
	if len(args) != 0 {
		usage()
		os.Exit(exitUsage)
	}
	ucred, err := syscall.GetsockoptUcred(inheritedIpcDescriptor, syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	if err != nil {
		return fmt.Errorf("SO_PEERCRED on inherited descriptor %d: %w", inheritedIpcDescriptor, err)
	}
	if ucred == nil || ucred.Pid <= 0 {
		return fmt.Errorf("SO_PEERCRED on descriptor %d reported no peer pid", inheritedIpcDescriptor)
	}
	return emitUnixPeerIdentity(map[string]any{"t": "peer-identity", "pid": int(ucred.Pid), "uid": int(ucred.Uid)})
}
