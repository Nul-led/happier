//go:build darwin

// Darwin peer identity uses the two public local-socket primitives that own
// these facts: LOCAL_PEERPID returns pid_t and LOCAL_PEERCRED returns struct
// xucred. The helper proves both option shapes on a self-socketpair before it
// reads the inherited accepted connection. Any ambiguity fails closed — an
// unproven peer identity must never look like a success.
package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const (
	solLocal       = 0
	localPeercred  = 0x001
	localPeerpid   = 0x002
	darwinPidBytes = 4
	darwinCredMax  = 256
)

// readDarwinLocalOption performs one bounded getsockopt and returns exactly
// the bytes written by the kernel.
func readDarwinLocalOption(fd int, option int, capacity int) ([]byte, error) {
	buffer := make([]byte, capacity)
	size := uint32(len(buffer))
	_, _, errno := syscall.Syscall6(
		syscall.SYS_GETSOCKOPT,
		uintptr(fd),
		uintptr(solLocal),
		uintptr(option),
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(unsafe.Pointer(&size)),
		0,
	)
	if errno != 0 {
		return nil, errno
	}
	if size > uint32(len(buffer)) {
		return nil, fmt.Errorf("local socket option %d wrote %d bytes into a %d-byte buffer", option, size, len(buffer))
	}
	return buffer[:size], nil
}

// validateDarwinPeerOptions proves that the running kernel returns the
// documented pid_t/xucred shapes and this process's own identity on a socket
// pair. This catches unsupported or materially changed kernels before the
// inherited broker connection is trusted.
func validateDarwinPeerOptions(selfPid int, selfEuid uint32) error {
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		return fmt.Errorf("peer-option self-proof socketpair: %w", err)
	}
	defer func() {
		_ = syscall.Close(fds[0])
		_ = syscall.Close(fds[1])
	}()
	pidBytes, err := readDarwinLocalOption(fds[0], localPeerpid, darwinPidBytes)
	if err != nil {
		return fmt.Errorf("self-proof LOCAL_PEERPID: %w", err)
	}
	pid, err := decodeDarwinPeerPid(pidBytes)
	if err != nil {
		return fmt.Errorf("self-proof LOCAL_PEERPID: %w", err)
	}
	if pid != selfPid {
		return fmt.Errorf("self-proof LOCAL_PEERPID reported %d, not this process's %d", pid, selfPid)
	}
	credBytes, err := readDarwinLocalOption(fds[0], localPeercred, darwinCredMax)
	if err != nil {
		return fmt.Errorf("self-proof LOCAL_PEERCRED: %w", err)
	}
	uid, err := decodeDarwinPeerUid(credBytes)
	if err != nil {
		return fmt.Errorf("self-proof LOCAL_PEERCRED: %w", err)
	}
	if uid != selfEuid {
		return fmt.Errorf("self-proof LOCAL_PEERCRED reported uid %d, not this process's %d", uid, selfEuid)
	}
	return nil
}

func peerIdentityCommand(args []string) error {
	if len(args) != 0 {
		usage()
		os.Exit(exitUsage)
	}
	if err := validateDarwinPeerOptions(os.Getpid(), uint32(os.Geteuid())); err != nil {
		return err
	}
	pidBytes, err := readDarwinLocalOption(inheritedIpcDescriptor, localPeerpid, darwinPidBytes)
	if err != nil {
		return fmt.Errorf("LOCAL_PEERPID on inherited descriptor %d: %w", inheritedIpcDescriptor, err)
	}
	peerPid, err := decodeDarwinPeerPid(pidBytes)
	if err != nil {
		return fmt.Errorf("LOCAL_PEERPID on descriptor %d: %w", inheritedIpcDescriptor, err)
	}
	credBytes, err := readDarwinLocalOption(inheritedIpcDescriptor, localPeercred, darwinCredMax)
	if err != nil {
		return fmt.Errorf("LOCAL_PEERCRED on inherited descriptor %d: %w", inheritedIpcDescriptor, err)
	}
	peerUid, err := decodeDarwinPeerUid(credBytes)
	if err != nil {
		return fmt.Errorf("LOCAL_PEERCRED on descriptor %d: %w", inheritedIpcDescriptor, err)
	}
	return emit(map[string]any{"t": "peer-identity", "pid": int(peerPid), "uid": int(peerUid)})
}
