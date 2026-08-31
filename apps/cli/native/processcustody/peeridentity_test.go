package main

// Host-runnable unit tests for the pure pieces of the peer-identity boundary.
// The Windows stdio handle table decoder is byte-level logic, so it is proven
// here without a Windows host; the live OS primitives are covered by the
// per-platform live tests.

import (
	"encoding/binary"
	"testing"
)

func TestDecodeWindowsStdioHandleTableReadsTheRequestedEntry(t *testing.T) {
	// libuv child_stdio_buffer: 4-byte count, one CRT flags byte per fd,
	// then the unaligned HANDLE array.
	table := make([]byte, 4+4+4*8)
	binary.LittleEndian.PutUint32(table[0:4], 4)
	copy(table[4:8], []byte{0x09, 0x41, 0x01, 0x09}) // FOPEN|FPIPE, FOPEN|FDEV, FOPEN, FOPEN|FPIPE
	for entry := 0; entry < 4; entry += 1 {
		binary.LittleEndian.PutUint64(table[8+entry*8:], uint64(0x1000+entry))
	}

	handle, class, err := decodeWindowsStdioHandleTable(table, 3)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if handle != 0x1003 || class != 0x09 {
		t.Fatalf("unexpected entry: handle=0x%X class=%d", handle, class)
	}
	if _, class, _ = decodeWindowsStdioHandleTable(table, 1); class != 0x41 {
		t.Fatalf("flags byte of entry 1 is %d, want 0x41", class)
	}
	if _, class, _ = decodeWindowsStdioHandleTable(table, 2); class != 0x01 {
		t.Fatalf("flags byte of entry 2 is %d, want 0x01", class)
	}
}

func TestDecodeWindowsStdioHandleTableFailsClosed(t *testing.T) {
	if _, _, err := decodeWindowsStdioHandleTable(nil, 0); err == nil {
		t.Fatalf("an absent table must fail")
	}
	if _, _, err := decodeWindowsStdioHandleTable(make([]byte, 7), 0); err == nil {
		t.Fatalf("a truncated header must fail")
	}
	if _, _, err := decodeWindowsStdioHandleTable(make([]byte, 8), 0); err == nil {
		t.Fatalf("a zero-entry table must fail")
	}
	full := make([]byte, 4+2+2*8)
	binary.LittleEndian.PutUint32(full[0:4], 2)
	if _, _, err := decodeWindowsStdioHandleTable(full, 2); err == nil {
		t.Fatalf("an out-of-range index must fail")
	}
	if _, _, err := decodeWindowsStdioHandleTable(full, -1); err == nil {
		t.Fatalf("a negative index must fail")
	}
	// A table claiming more entries than its bytes hold must fail even though
	// the requested entry's offset would still be inside the buffer.
	overclaimed := make([]byte, 4+2+2*8)
	binary.LittleEndian.PutUint32(overclaimed[0:4], 1<<24)
	if _, _, err := decodeWindowsStdioHandleTable(overclaimed, 0); err == nil {
		t.Fatalf("an overclaimed entry count must fail")
	}
	// A null handle entry is not an inspectable descriptor.
	nullEntry := make([]byte, 4+1+1*8)
	binary.LittleEndian.PutUint32(nullEntry[0:4], 1)
	nullEntry[4] = 0x09
	if _, _, err := decodeWindowsStdioHandleTable(nullEntry, 0); err == nil {
		t.Fatalf("a null handle must fail")
	}
	invalidEntry := make([]byte, 4+1+1*8)
	binary.LittleEndian.PutUint32(invalidEntry[0:4], 1)
	invalidEntry[4] = 0x09
	binary.LittleEndian.PutUint64(invalidEntry[5:], ^uint64(0))
	if _, _, err := decodeWindowsStdioHandleTable(invalidEntry, 0); err == nil {
		t.Fatalf("libuv's INVALID_HANDLE_VALUE sentinel must fail")
	}
}

func TestDecodeDarwinPeerPidUsesTheLocalPeerPidShape(t *testing.T) {
	buffer := make([]byte, 4)
	binary.LittleEndian.PutUint32(buffer, 4242)
	pid, err := decodeDarwinPeerPid(buffer)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if pid != 4242 {
		t.Fatalf("decoded pid %d, want 4242", pid)
	}

	for _, malformed := range [][]byte{nil, make([]byte, 3), make([]byte, 5), make([]byte, 4)} {
		if _, err := decodeDarwinPeerPid(malformed); err == nil {
			t.Fatalf("malformed LOCAL_PEERPID result of %d bytes must fail", len(malformed))
		}
	}
}

func TestDecodeDarwinPeerUidUsesTheXucredHeader(t *testing.T) {
	buffer := make([]byte, 12)
	binary.LittleEndian.PutUint32(buffer[0:4], 0) // XUCRED_VERSION
	binary.LittleEndian.PutUint32(buffer[4:8], 501)
	uid, err := decodeDarwinPeerUid(buffer)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if uid != 501 {
		t.Fatalf("decoded uid %d, want 501", uid)
	}

	if _, err := decodeDarwinPeerUid(make([]byte, 7)); err == nil {
		t.Fatalf("a truncated xucred header must fail")
	}
	wrongVersion := make([]byte, 8)
	binary.LittleEndian.PutUint32(wrongVersion[0:4], 1)
	if _, err := decodeDarwinPeerUid(wrongVersion); err == nil {
		t.Fatalf("an unknown xucred version must fail")
	}
}
