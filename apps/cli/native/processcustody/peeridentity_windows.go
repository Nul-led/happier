//go:build windows

// Windows named-pipe peer identity. The client process id comes from the real
// primitive GetNamedPipeClientProcessId on the inherited pipe handle. The
// same-user authority must come from a user-only ACL owned by the broker
// listener; this command reports no uid fact and cannot replace that ACL. The
// handle is located from the STARTUPINFO stdio handle table the parent's CreateProcessW provided, or
// from an explicit --pipe-handle=<value> for launchers that already know the
// duplicated handle value; a path is never accepted in argv.
package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"unsafe"
)

var (
	procGetNamedPipeClientProcessId = kernel32.NewProc("GetNamedPipeClientProcessId")
	procGetStartupInfoW             = kernel32.NewProc("GetStartupInfoW")
)

// namedPipeClientPid asks the kernel for the client process of one pipe
// handle. A zero pid is refused rather than reported.
func namedPipeClientPid(handle uintptr) (int, error) {
	var clientPid uint32
	result, _, callErr := procGetNamedPipeClientProcessId.Call(handle, uintptr(unsafe.Pointer(&clientPid)))
	if result == 0 {
		return 0, fmt.Errorf("GetNamedPipeClientProcessId failed: %v", callErr)
	}
	if clientPid == 0 {
		return 0, fmt.Errorf("GetNamedPipeClientProcessId reported no client pid")
	}
	return int(clientPid), nil
}

// inheritedPipeHandle resolves descriptor 3's handle: either the explicit
// named argument or the child stdio handle table the parent passed through
// CreateProcessW (read back via GetStartupInfoW).
func inheritedPipeHandle(args []string) (uintptr, error) {
	explicit := uint64(0)
	sawExplicit := false
	for _, arg := range args {
		if !strings.HasPrefix(arg, "--pipe-handle=") {
			usage()
			os.Exit(exitUsage)
		}
		if sawExplicit {
			usage()
			os.Exit(exitUsage)
		}
		parsed, parseErr := strconv.ParseUint(strings.TrimPrefix(arg, "--pipe-handle="), 10, 64)
		if parseErr != nil {
			usage()
			os.Exit(exitUsage)
		}
		sawExplicit = true
		explicit = parsed
	}
	if sawExplicit {
		return uintptr(explicit), nil
	}
	// Go's syscall.StartupInfo hides the reserved CRT fields, so read the
	// stdio handle table through the full Win32 struct (the same shape the
	// custody commands use for CreateProcessW).
	var startupInfo startupInfoW
	startupInfo.Cb = uint32(unsafe.Sizeof(startupInfo))
	procGetStartupInfoW.Call(uintptr(unsafe.Pointer(&startupInfo)))
	if startupInfo.CbReserved2 == 0 || startupInfo.LpReserved2 == nil {
		return 0, fmt.Errorf("no inherited stdio handle table (cbReserved2=%d)", startupInfo.CbReserved2)
	}
	table := unsafe.Slice(startupInfo.LpReserved2, int(startupInfo.CbReserved2))
	handle, flags, err := decodeWindowsStdioHandleTable(table, inheritedIpcDescriptor)
	if err != nil {
		return 0, err
	}
	if flags&windowsCrtFlagOpen == 0 || flags&windowsCrtFlagPipe == 0 {
		return 0, fmt.Errorf("inherited descriptor %d is not an open pipe handle (CRT flags 0x%02x)", inheritedIpcDescriptor, flags)
	}
	return handle, nil
}

func peerIdentityCommand(args []string) error {
	handle, err := inheritedPipeHandle(args)
	if err != nil {
		return err
	}
	pid, err := namedPipeClientPid(handle)
	if err != nil {
		return err
	}
	// uid is deliberately null on Windows: GetNamedPipeClientProcessId has no
	// user fact, so a caller must separately require a user-only pipe ACL.
	return emit(map[string]any{"t": "peer-identity", "pid": pid, "uid": nil})
}
