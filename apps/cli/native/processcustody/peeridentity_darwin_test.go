//go:build darwin

package main

// Live Darwin coverage for the two kernel-owned facts used by the broker:
// LOCAL_PEERPID must identify the distinct process that connected, while
// LOCAL_PEERCRED must identify its effective uid. This is deliberately a
// black-box helper invocation over the inherited accepted descriptor.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

var darwinHelperBinaryPath string
var darwinDialerBinaryPath string

func TestMain(m *testing.M) {
	tempDir, err := os.MkdirTemp("", "processcustody-peeridentity-*")
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer os.RemoveAll(tempDir)
	darwinHelperBinaryPath = filepath.Join(tempDir, "happier-process-custody")
	build := exec.Command("go", "build", "-o", darwinHelperBinaryPath, ".")
	build.Stdout = os.Stderr
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	darwinDialerBinaryPath = filepath.Join(tempDir, "dialunix")
	dialerBuild := exec.Command("go", "build", "-o", darwinDialerBinaryPath, "./testdata/dialunix")
	dialerBuild.Stdout = os.Stderr
	dialerBuild.Stderr = os.Stderr
	if err := dialerBuild.Run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(m.Run())
}

type darwinPeerIdentityOutput struct {
	V   int    `json:"v"`
	T   string `json:"t"`
	Pid int    `json:"pid"`
	Uid *int   `json:"uid"`
}

func runDarwinPeerIdentity(t *testing.T, extraFiles []*os.File) (string, int) {
	t.Helper()
	cmd := exec.Command(darwinHelperBinaryPath, "peer-identity")
	cmd.ExtraFiles = extraFiles
	stdout, err := cmd.Output()
	if err == nil {
		return string(stdout), 0
	}
	var exitError *exec.ExitError
	if !errors.As(err, &exitError) {
		t.Fatalf("helper did not run to exit: %v", err)
	}
	return string(stdout), exitError.ExitCode()
}

func TestDarwinPeerIdentityProvesTheConnectingProcess(t *testing.T) {
	listener, err := net.Listen("unix", filepath.Join(t.TempDir(), "broker.sock"))
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	peer := exec.Command(darwinDialerBinaryPath, listener.Addr().String())
	if err := peer.Start(); err != nil {
		t.Fatalf("start peer: %v", err)
	}
	t.Cleanup(func() {
		_ = peer.Process.Kill()
		_ = peer.Wait()
	})

	accept := make(chan net.Conn, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr == nil {
			accept <- connection
		}
	}()
	var connection net.Conn
	select {
	case connection = <-accept:
	case <-time.After(5 * time.Second):
		t.Fatal("broker never accepted the peer connection")
	}
	t.Cleanup(func() { _ = connection.Close() })
	acceptedFile, err := connection.(*net.UnixConn).File()
	if err != nil {
		t.Fatalf("accepted descriptor: %v", err)
	}
	defer acceptedFile.Close()

	stdout, exitCode := runDarwinPeerIdentity(t, []*os.File{acceptedFile})
	if exitCode != 0 {
		t.Fatalf("peer-identity exited %d: %s", exitCode, stdout)
	}
	var observed darwinPeerIdentityOutput
	if err := json.Unmarshal([]byte(stdout), &observed); err != nil {
		t.Fatalf("helper stdout is not JSON: %q (%v)", stdout, err)
	}
	if observed.V != 1 || observed.T != "peer-identity" {
		t.Fatalf("unexpected envelope: %+v", observed)
	}
	if observed.Pid != peer.Process.Pid {
		t.Fatalf("LOCAL_PEERPID reported %d, want connecting process %d", observed.Pid, peer.Process.Pid)
	}
	if observed.Uid == nil || *observed.Uid != os.Getuid() {
		t.Fatalf("LOCAL_PEERCRED uid %v, want %d", observed.Uid, os.Getuid())
	}
}

func TestDarwinPeerIdentityFailsClosedWithoutAnInheritedSocket(t *testing.T) {
	stdout, exitCode := runDarwinPeerIdentity(t, nil)
	if exitCode == 0 || stdout != "" {
		t.Fatalf("missing socket produced exit=%d stdout=%q", exitCode, stdout)
	}
}
