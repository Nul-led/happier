//go:build windows

package main

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCustodyRunSubprocess(t *testing.T) {
	separator := -1
	for index, argument := range os.Args {
		if argument == "--" {
			separator = index
			break
		}
	}
	if separator < 0 || separator+1 >= len(os.Args) {
		return
	}

	switch os.Args[separator+1] {
	case "custody-helper":
		if err := runCustodyCommand(os.Args[separator+2:]); err != nil {
			_, _ = fmt.Fprintln(os.Stderr, err)
			os.Exit(exitOSError)
		}
		os.Exit(exitOK)
	case "custody-target":
		_, _ = fmt.Fprintln(os.Stdout, "target-ready")
		_, _ = fmt.Fprintln(os.Stderr, "target-error-ready")
		_ = os.Stdin.Close()
		_ = os.Stdout.Close()
		_ = os.Stderr.Close()
		// Stay alive long enough to distinguish target half-close from custody
		// exit. The parent kills the custody helper after observing both facts.
		time.Sleep(10 * time.Second)
		os.Exit(exitOK)
	}
}

func TestCustodyRunReleasesHelperStdioAfterTargetStarts(t *testing.T) {
	jobName := fmt.Sprintf(`Local\happier-processcustody-test-%d`, os.Getpid())
	handshakePath := filepath.Join(t.TempDir(), "custody.json")
	command := exec.Command(
		os.Args[0],
		"-test.run=^TestCustodyRunSubprocess$",
		"--",
		"custody-helper",
		"--job="+jobName,
		"--handshake="+handshakePath,
		"--",
		os.Args[0],
		"-test.run=^TestCustodyRunSubprocess$",
		"--",
		"custody-target",
	)
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatalf("create custody stdin pipe: %v", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("create custody stdout pipe: %v", err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		t.Fatalf("create custody stderr pipe: %v", err)
	}
	if err := command.Start(); err != nil {
		t.Fatalf("start custody helper: %v", err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill()
		_ = command.Wait()
	})

	reader := bufio.NewReader(stdout)
	ready, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read target readiness: %v", err)
	}
	if strings.TrimSpace(ready) != "target-ready" {
		t.Fatalf("unexpected target readiness: %q", ready)
	}
	stderrReader := bufio.NewReader(stderr)
	errorReady, err := stderrReader.ReadString('\n')
	if err != nil {
		t.Fatalf("read target stderr readiness: %v", err)
	}
	if strings.TrimSpace(errorReady) != "target-error-ready" {
		t.Fatalf("unexpected target stderr readiness: %q", errorReady)
	}

	for name, stream := range map[string]io.Reader{
		"stdout": reader,
		"stderr": stderrReader,
	} {
		result := make(chan error, 1)
		go func() {
			_, readErr := io.ReadAll(stream)
			result <- readErr
		}()
		select {
		case readErr := <-result:
			if readErr != nil {
				t.Fatalf("read target %s to EOF: %v", name, readErr)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("custody helper retained %s after the target closed it", name)
		}
	}

	writeResult := make(chan error, 1)
	go func() {
		_, writeErr := stdin.Write([]byte("must-observe-no-reader"))
		writeResult <- writeErr
	}()
	select {
	case writeErr := <-writeResult:
		if writeErr == nil {
			t.Fatal("custody helper retained stdin after the target closed it")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stdin write blocked because the custody helper retained the read handle")
	}
}

func TestQuoteWindowsArgumentRoundTripsThroughArgvDecoding(t *testing.T) {
	cases := []string{
		"plain",
		"",
		"with space",
		`quoted "inside"`,
		`trailing backslash \`,
		`C:\tool\`,
		`backslash before quote \"`,
		"--port=43111",
		`C:\Program Files\Tool\tool.exe serve`,
	}
	for _, value := range cases {
		quoted := quoteWindowsArgument(value)
		if decoded := decodeMSVCRTArgument(quoted); decoded != value {
			t.Fatalf("quote/decode round trip failed for %q: quoted %q decoded %q", value, quoted, decoded)
		}
	}
}

// decodeMSVCRTArgument implements the CommandLineToArgvW decoding rule for one
// argument, proving quoteWindowsArgument is its lossless inverse.
func decodeMSVCRTArgument(argument string) string {
	if argument == `""` {
		return ""
	}
	var out bytes.Buffer
	inQuotes := false
	backslashes := 0
	for i := 0; i < len(argument); i++ {
		char := argument[i]
		switch {
		case char == '\\':
			backslashes++
		case char == '"':
			for backslashes/2 > 0 {
				out.WriteByte('\\')
				backslashes--
			}
			if backslashes%2 == 1 {
				out.WriteByte('"')
				backslashes = 0
			} else {
				backslashes = 0
				inQuotes = !inQuotes
			}
		default:
			for backslashes > 0 {
				out.WriteByte('\\')
				backslashes--
			}
			out.WriteByte(char)
		}
	}
	for backslashes > 0 {
		out.WriteByte('\\')
		backslashes--
	}
	_ = inQuotes
	return out.String()
}

func TestParseRunArgsRequiresJobAndTarget(t *testing.T) {
	job, handshake, inheritedStdinArg, verbatim, target, err := parseRunArgs([]string{
		"--handshake=C:\\tmp\\hs.json",
		"--job=Local\\happier-svc09-abc",
		"--target-inherited-stdin-arg=--broker-descriptor",
		"--target-windows-verbatim",
		"--",
		"tool.exe",
		"--serve",
		"443",
	})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if job != `Local\happier-svc09-abc` || handshake != `C:\tmp\hs.json` || inheritedStdinArg != "--broker-descriptor" || !verbatim {
		t.Fatalf("unexpected options: job=%q handshake=%q", job, handshake)
	}
	if len(target) != 3 || target[0] != "tool.exe" || target[2] != "443" {
		t.Fatalf("unexpected target: %v", target)
	}
	if _, _, _, _, _, err := parseRunArgs([]string{"--job=x", "tool.exe"}); err == nil {
		t.Fatalf("target before -- must be rejected")
	}
	if _, _, _, _, _, err := parseRunArgs([]string{"--", "tool.exe"}); err == nil {
		t.Fatalf("missing --job must be rejected")
	}
	if _, _, _, _, _, err := parseRunArgs([]string{"--job=x", "--target-inherited-stdin-arg=", "--", "tool.exe"}); err == nil {
		t.Fatalf("empty inherited-stdin argument name must be rejected")
	}
}

func TestWindowsCommandLinePreservesVerbatimCmdTail(t *testing.T) {
	target := []string{`C:\Windows\System32\cmd.exe`, "/d", "/s", "/c", `""C:\Program Files\tool.cmd" "a&b""`}
	got := windowsCommandLine(target, true)
	want := `C:\Windows\System32\cmd.exe /d /s /c ""C:\Program Files\tool.cmd" "a&b""`
	if got != want {
		t.Fatalf("verbatim command line changed cmd.exe grammar: got %q want %q", got, want)
	}
}

func TestParseJobArgs(t *testing.T) {
	job, timeout, err := parseJobArgs([]string{"--job=j1", "--timeout-ms=250"})
	if err != nil || job != "j1" || timeout != 250 {
		t.Fatalf("parse failed: job=%q timeout=%d err=%v", job, timeout, err)
	}
	if _, _, err := parseJobArgs([]string{"--timeout-ms=0"}); err == nil {
		t.Fatalf("non-positive timeout must be rejected")
	}
}
