//go:build linux || darwin

package main

import (
	"syscall"
	"testing"
)

func TestRestoreUnixNonblockingRestoresInheritedSocketMode(t *testing.T) {
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		t.Fatalf("socketpair: %v", err)
	}
	defer syscall.Close(fds[0])
	defer syscall.Close(fds[1])
	if err := syscall.SetNonblock(fds[0], false); err != nil {
		t.Fatalf("make inherited descriptor blocking: %v", err)
	}
	if err := restoreUnixNonblocking(fds[0]); err != nil {
		t.Fatalf("restore inherited descriptor: %v", err)
	}
	flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fds[0]), syscall.F_GETFL, 0)
	if errno != 0 {
		t.Fatalf("read inherited descriptor flags: %v", errno)
	}
	if flags&syscall.O_NONBLOCK == 0 {
		t.Fatal("inherited accepted descriptor remained in blocking mode")
	}
}
