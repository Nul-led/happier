//go:build linux

package main

// Live Linux tests for the `peer-identity` command. The helper must prove the
// OS peer identity of the process on the other end of the inherited accepted
// IPC connection (fixed extra descriptor 3) with the real SO_PEERCRED
// primitive. The tests are black-box: they build the real binary and drive it
// exactly the way the TypeScript invocation owner does.

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

var helperBinaryPath string
var dialerBinaryPath string

func TestMain(m *testing.M) {
	tempDir, err := os.MkdirTemp("", "processcustody-peeridentity-*")
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer os.RemoveAll(tempDir)
	binaryPath := filepath.Join(tempDir, "happier-process-custody")
	build := exec.Command("go", "build", "-o", binaryPath, ".")
	build.Stdout = os.Stderr
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	helperBinaryPath = binaryPath
	dialerPath := filepath.Join(tempDir, "dialunix")
	dialerBuild := exec.Command("go", "build", "-o", dialerPath, "./testdata/dialunix")
	dialerBuild.Stdout = os.Stderr
	dialerBuild.Stderr = os.Stderr
	if err := dialerBuild.Run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	dialerBinaryPath = dialerPath
	os.Exit(m.Run())
}

type peerIdentityOutput struct {
	V   int    `json:"v"`
	T   string `json:"t"`
	Pid int    `json:"pid"`
	Uid *int   `json:"uid"`
}

func runPeerIdentity(t *testing.T, extraFiles []*os.File, args ...string) (string, int) {
	t.Helper()
	cmd := exec.Command(helperBinaryPath, args...)
	cmd.ExtraFiles = extraFiles
	stdout, err := cmd.Output()
	exitCode := 0
	if err != nil {
		var exitError *exec.ExitError
		if !errors.As(err, &exitError) {
			t.Fatalf("helper did not run to exit: %v", err)
		}
		exitCode = exitError.ExitCode()
	}
	return string(stdout), exitCode
}

func dialAndAccept(t *testing.T, directory string) (server net.Listener, client net.Conn, accepted net.Conn) {
	t.Helper()
	listener, err := net.Listen("unix", filepath.Join(directory, "broker.sock"))
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	dialed, err := net.Dial("unix", listener.Addr().String())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = dialed.Close() })
	listener.(*net.UnixListener).SetUnlinkOnClose(true)
	acceptCh := make(chan net.Conn, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		acceptCh <- conn
	}()
	select {
	case conn := <-acceptCh:
		return listener, dialed, conn
	case <-time.After(5 * time.Second):
		t.Fatalf("server never accepted the connection")
		return nil, nil, nil
	}
}

func TestPeerIdentityProvesTheExactPeerPidAndUid(t *testing.T) {
	_, client, accepted := dialAndAccept(t, t.TempDir())
	defer func() { _ = client.Close() }()
	acceptedFile, err := accepted.(*net.UnixConn).File()
	if err != nil {
		t.Fatalf("accepted fd: %v", err)
	}
	defer func() { _ = acceptedFile.Close() }()

	stdout, exitCode := runPeerIdentity(t, []*os.File{acceptedFile}, "peer-identity")
	if exitCode != 0 {
		t.Fatalf("peer-identity exited %d (stderr output on test failure): %s", exitCode, stdout)
	}
	var observed peerIdentityOutput
	if err := json.Unmarshal([]byte(stdout), &observed); err != nil {
		t.Fatalf("helper stdout is not the strict JSON line: %q (%v)", stdout, err)
	}
	if observed.V != 1 || observed.T != "peer-identity" {
		t.Fatalf("unexpected envelope: %+v", observed)
	}
	if observed.Pid != os.Getpid() {
		t.Fatalf("SO_PEERCRED pid %d does not equal the real peer pid %d", observed.Pid, os.Getpid())
	}
	if observed.Uid == nil || *observed.Uid != os.Getuid() {
		t.Fatalf("SO_PEERCRED uid %v does not equal the process uid %d", observed.Uid, os.Getuid())
	}
}

func TestPeerIdentityReportsTheOtherEndProcessNotTheCaller(t *testing.T) {
	listener, err := net.Listen("unix", filepath.Join(t.TempDir(), "broker.sock"))
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	// The peer end must be created AND connected by a DIFFERENT live process:
	// SO_PEERCRED binds the credentials of the process that connected. The
	// test dialer dials from its own pid and holds the connection open, and
	// the accepted connection below is exactly that dialer's connection.
	child := exec.Command(dialerBinaryPath, listener.Addr().String())
	if err := child.Start(); err != nil {
		t.Fatalf("start peer child: %v", err)
	}
	t.Cleanup(func() {
		_ = child.Process.Kill()
		_ = child.Wait()
	})
	accepted, err := listener.Accept()
	if err != nil {
		t.Fatalf("accept dialer connection: %v", err)
	}
	acceptedFile, err := accepted.(*net.UnixConn).File()
	if err != nil {
		t.Fatalf("accepted fd: %v", err)
	}
	defer func() { _ = acceptedFile.Close() }()

	stdout, exitCode := runPeerIdentity(t, []*os.File{acceptedFile}, "peer-identity")
	if exitCode != 0 {
		t.Fatalf("peer-identity exited %d: %s", exitCode, stdout)
	}
	var observed peerIdentityOutput
	if err := json.Unmarshal([]byte(stdout), &observed); err != nil {
		t.Fatalf("helper stdout is not the strict JSON line: %q (%v)", stdout, err)
	}
	if observed.Pid == os.Getpid() {
		t.Fatalf("helper reported the caller pid; expected the peer child pid %d", child.Process.Pid)
	}
	if observed.Pid != child.Process.Pid {
		t.Fatalf("proven pid %d is not the peer child pid %d", observed.Pid, child.Process.Pid)
	}
	if observed.Uid == nil || *observed.Uid != os.Getuid() {
		t.Fatalf("proven uid %v is not the same-user uid %d", observed.Uid, os.Getuid())
	}
}

func TestPeerIdentityFailsClosedOnANonSocketDescriptor(t *testing.T) {
	pipeReader, pipeWriter, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	t.Cleanup(func() {
		_ = pipeReader.Close()
		_ = pipeWriter.Close()
	})
	stdout, exitCode := runPeerIdentity(t, []*os.File{pipeWriter}, "peer-identity")
	if exitCode == 0 {
		t.Fatalf("a pipe descriptor must not yield a peer identity: %q", stdout)
	}
	if stdout != "" {
		t.Fatalf("a failed inspection must never emit an identity line: %q", stdout)
	}
}

func TestPeerIdentityFailsClosedWithoutTheInheritedDescriptor(t *testing.T) {
	stdout, exitCode := runPeerIdentity(t, nil, "peer-identity")
	if exitCode == 0 {
		t.Fatalf("a missing descriptor must not yield a peer identity: %q", stdout)
	}
	if stdout != "" {
		t.Fatalf("a failed inspection must never emit an identity line: %q", stdout)
	}
}

func TestPeerIdentityRejectsUnexpectedArguments(t *testing.T) {
	_, _, accepted := dialAndAccept(t, t.TempDir())
	acceptedFile, err := accepted.(*net.UnixConn).File()
	if err != nil {
		t.Fatalf("accepted fd: %v", err)
	}
	defer func() { _ = acceptedFile.Close() }()
	stdout, exitCode := runPeerIdentity(t, []*os.File{acceptedFile}, "peer-identity", "--bogus=1")
	if exitCode != 2 {
		t.Fatalf("unexpected arguments must be a usage error, got exit %d: %q", exitCode, stdout)
	}
}
