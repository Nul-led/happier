package main

// Platform-neutral pure helpers behind the `peer-identity` command: the OS
// peer-identity boundary for locally inherited IPC connections (see the
// per-platform peeridentity_*.go files for the actual OS primitives).

import (
	"encoding/binary"
	"fmt"
)

// inheritedIpcDescriptor is the fixed extra descriptor/handle index the parent
// uses when spawning this helper (stdio index 3). It is deliberately not
// configurable: the parent never passes a connection path in argv.
const inheritedIpcDescriptor = 3

// CRT flags written by libuv for an inherited open pipe in its child stdio
// table. These are not Win32 FILE_TYPE_* values.
const (
	windowsCrtFlagOpen = 0x01
	windowsCrtFlagPipe = 0x08
)

// decodeWindowsStdioHandleTable decodes the CRT child stdio handle table that
// Windows passes through STARTUPINFO cbReserved2/lpReserved2 (produced by
// libuv/uv_spawn and readable in the child via GetStartupInfoW). Layout:
// u32 entryCount, entryCount CRT flag bytes, then entryCount 8-byte handles.
// libuv intentionally does not align the handle array. The decode never guesses: a
// truncated, oversized, out-of-range, or null-handle table is an error, and
// the entry's CRT flags byte is returned so the caller can refuse non-pipes.
func decodeWindowsStdioHandleTable(buffer []byte, index int) (uintptr, byte, error) {
	if index < 0 {
		return 0, 0, fmt.Errorf("stdio handle index %d is negative", index)
	}
	if len(buffer) < 4 {
		return 0, 0, fmt.Errorf("stdio handle table is %d bytes; the header does not fit", len(buffer))
	}
	count := int(binary.LittleEndian.Uint32(buffer[0:4]))
	if count <= 0 || index >= count {
		return 0, 0, fmt.Errorf("stdio handle index %d is outside the table's %d entries", index, count)
	}
	if count > 256 {
		return 0, 0, fmt.Errorf("stdio handle table claims an unsupported %d entries", count)
	}
	handlesAt := 4 + count
	end := handlesAt + count*8
	if end <= 0 || len(buffer) < end {
		return 0, 0, fmt.Errorf("stdio handle table claims %d entries but holds %d bytes", count, len(buffer))
	}
	handle := binary.LittleEndian.Uint64(buffer[handlesAt+index*8:])
	if handle == 0 || handle == ^uint64(0) {
		return 0, 0, fmt.Errorf("stdio handle table entry %d is invalid", index)
	}
	return uintptr(handle), buffer[4+index], nil
}

// decodeDarwinPeerPid decodes the complete pid_t returned by Darwin's
// LOCAL_PEERPID socket option. LOCAL_PEERPID is a four-byte signed pid, not a
// credential structure; accepting any other shape would make the option
// number/layout ambiguity security-relevant.
func decodeDarwinPeerPid(buffer []byte) (int, error) {
	if len(buffer) != 4 {
		return 0, fmt.Errorf("LOCAL_PEERPID returned %d bytes, want 4", len(buffer))
	}
	pid := int32(binary.LittleEndian.Uint32(buffer))
	if pid <= 0 {
		return 0, fmt.Errorf("LOCAL_PEERPID reported pid %d", pid)
	}
	return int(pid), nil
}

// decodeDarwinPeerUid decodes the stable public header of struct xucred
// returned by Darwin's LOCAL_PEERCRED socket option: cr_version then cr_uid.
// The remaining advisory group fields are deliberately ignored, but the
// documented XUCRED_VERSION must match before the uid can be trusted.
func decodeDarwinPeerUid(buffer []byte) (uint32, error) {
	if len(buffer) < 8 {
		return 0, fmt.Errorf("LOCAL_PEERCRED returned %d bytes; xucred header does not fit", len(buffer))
	}
	const xucredVersion = 0
	version := binary.LittleEndian.Uint32(buffer[0:4])
	if version != xucredVersion {
		return 0, fmt.Errorf("LOCAL_PEERCRED returned xucred version %d, want %d", version, xucredVersion)
	}
	return binary.LittleEndian.Uint32(buffer[4:8]), nil
}
