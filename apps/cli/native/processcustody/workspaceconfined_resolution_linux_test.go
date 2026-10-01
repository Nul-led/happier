//go:build linux

package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceConfinedFingerprintKeepsCanonicalUnicodeJSON(t *testing.T) {
	name := "café\"\\\n.txt"
	executable := false
	size := uint64(1)
	entry := workspaceConfinedExpectation{
		Kind:       workspaceConfinedKindFile,
		Digest:     "7a38d8cbd20d9932ba948efaa364bb62651d5ad4",
		Executable: &executable,
		Size:       &size,
	}
	writer := newWorkspaceConfinedFingerprintWriter()
	writer.add(name, entry)
	canonical := `{"v":1,"entries":[["café\"\\\n.txt",{"kind":"file","digest":"7a38d8cbd20d9932ba948efaa364bb62651d5ad4","executable":false,"size":1}]]}`
	want := fmt.Sprintf("%x", sha256.Sum256([]byte(canonical)))
	if got := writer.finish(); got != want {
		t.Fatalf("valid Unicode fingerprint diverged from canonical JSON: got %s want %s", got, want)
	}
}

func TestLinuxWorkspaceConfinedDirectoryRejectsNonUTF8Names(t *testing.T) {
	for _, rawName := range []byte{0xff, 0xfe} {
		root := t.TempDir()
		if err := os.Mkdir(filepath.Join(root, "tree"), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "tree", string([]byte{rawName})), []byte("content"), 0o600); err != nil {
			t.Fatal(err)
		}
		path, domainErr := openWorkspaceConfinedLinuxPath(root, "tree")
		if domainErr != nil {
			t.Fatal(domainErr)
		}
		_, domainErr = observeWorkspaceConfinedLinuxPath(path)
		path.close()
		if domainErr == nil || domainErr.code != "workspace_file_unsupported" {
			t.Fatalf("non-UTF-8 child produced an authoritative fingerprint: %v", domainErr)
		}
		if _, err := observeWorkspaceConfinedPrivateMaterial(filepath.Join(root, "tree")); err == nil {
			t.Fatal("non-UTF-8 private material produced an authoritative fingerprint")
		}
	}
}

func TestLinuxWorkspaceConfinedObservationRejectsNonUTF8SymlinkTarget(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "link")
	if err := os.Symlink(string([]byte{0xff}), path); err != nil {
		t.Fatal(err)
	}
	held, domainErr := openWorkspaceConfinedLinuxPath(root, "link")
	if domainErr != nil {
		t.Fatal(domainErr)
	}
	_, domainErr = observeWorkspaceConfinedLinuxPath(held)
	held.close()
	if domainErr == nil || domainErr.code != "workspace_file_unsupported" {
		t.Fatalf("non-UTF-8 symlink target produced an authoritative expectation: %v", domainErr)
	}
	if _, err := observeWorkspaceConfinedPrivateMaterial(path); err == nil {
		t.Fatal("non-UTF-8 private symlink target produced an authoritative expectation")
	}
}

func TestLinuxWorkspaceConfinedDirectoryPostTraversalRejectsChildAddedAfterEnumeration(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "entry")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "first"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	path, domainErr := openWorkspaceConfinedLinuxPath(root, "entry")
	if domainErr != nil {
		t.Fatal(domainErr)
	}
	defer path.close()
	entry := path.handles[len(path.handles)-1]
	before, err := inspectWorkspaceConfinedLinuxFD(entry.fd)
	if err != nil {
		t.Fatal(err)
	}
	names, err := listWorkspaceConfinedLinuxDirectory(entry.fd)
	if err != nil {
		t.Fatal(err)
	}
	if !workspaceConfinedLinuxDirectoryUnchanged(entry.fd, before, names) {
		t.Fatal("post-traversal check rejected an unchanged directory")
	}
	if err := os.WriteFile(filepath.Join(directory, "later"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	if workspaceConfinedLinuxDirectoryUnchanged(entry.fd, before, names) {
		t.Fatal("post-traversal check accepted a child created after the first enumeration")
	}
}

func runLinuxWorkspaceConfinedExchange(t *testing.T, command func([]string, io.Reader, io.Writer) error, request any) map[string]any {
	t.Helper()
	inputReader, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- command(nil, inputReader, outputWriter); _ = outputWriter.Close() }()
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inputWriter.Write(append(encoded, '\n')); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(outputReader)
	prepared, err := reader.ReadString('\n')
	if err != nil || prepared != "{\"v\":1,\"t\":\"workspace-confined-prepared\"}\n" {
		t.Fatalf("prepare: %q %v", prepared, err)
	}
	if _, err := io.WriteString(inputWriter, "{\"v\":1,\"decision\":\"commit\"}\n"); err != nil {
		t.Fatal(err)
	}
	_ = inputWriter.Close()
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(line), &result); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	return result
}

func TestLinuxWorkspaceConfinedApplyInstallsCapturedFileAndDirectoryWithoutReplacement(t *testing.T) {
	for _, fixture := range []struct {
		name         string
		makeMaterial func(string) error
		makeTarget   func(string) error
	}{
		{name: "file-to-directory", makeMaterial: func(path string) error { return os.WriteFile(path, []byte("selected"), 0o700) }, makeTarget: func(path string) error { return os.Mkdir(path, 0o700) }},
		{name: "directory-to-file", makeMaterial: func(path string) error {
			if err := os.Mkdir(path, 0o700); err != nil {
				return err
			}
			return os.WriteFile(filepath.Join(path, "child"), []byte("selected"), 0o600)
		}, makeTarget: func(path string) error { return os.WriteFile(path, []byte("old"), 0o600) }},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			root := t.TempDir()
			capture := t.TempDir()
			recovery := t.TempDir()
			material := filepath.Join(capture, "material")
			target := filepath.Join(root, "entry")
			if err := fixture.makeMaterial(material); err != nil {
				t.Fatal(err)
			}
			if err := fixture.makeTarget(target); err != nil {
				t.Fatal(err)
			}
			selected, err := observeWorkspaceConfinedPrivateMaterial(material)
			if err != nil {
				t.Fatal(err)
			}
			destination, err := observeWorkspaceConfinedPrivateMaterial(target)
			if err != nil {
				t.Fatal(err)
			}
			result := runLinuxWorkspaceConfinedExchange(t, workspaceConfinedApplyCommand, map[string]any{"v": 1, "rootPath": root, "relativePath": "entry", "expectedDestination": destination, "selectedExpectation": selected, "materialPath": material, "recoveryDirectory": recovery, "operationId": "apply-" + fixture.name})
			if result["status"] != "installed" {
				t.Fatalf("unexpected result: %#v", result)
			}
			installed, err := observeWorkspaceConfinedPrivateMaterial(target)
			if err != nil || !workspaceConfinedExpectationsEqual(installed, selected) {
				t.Fatalf("installed entry mismatch: %#v %v", installed, err)
			}
		})
	}
}

func TestLinuxWorkspaceConfinedRecoverNeverOverwritesExternalWriter(t *testing.T) {
	root := t.TempDir()
	recovery := t.TempDir()
	publicPath := filepath.Join(root, "entry")
	priorName := ".happier-conflict-resolution-op-prior"
	candidateName := ".happier-conflict-resolution-op-selected"
	if err := os.WriteFile(filepath.Join(root, priorName), []byte("prior"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, candidateName), []byte("selected"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(publicPath, []byte("external"), 0o600); err != nil {
		t.Fatal(err)
	}
	prior, _ := observeWorkspaceConfinedPrivateMaterial(filepath.Join(root, priorName))
	selected, _ := observeWorkspaceConfinedPrivateMaterial(filepath.Join(root, candidateName))
	rootHandle, err := openWorkspaceConfinedLinuxRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	identity := linuxWorkspaceConfinedIdentity(rootHandle)
	_ = unixCloseForTest(rootHandle.fd)
	record := workspaceConfinedRecoveryRecord{V: 1, OperationID: "op", RootPath: root, RootIdentity: identity, RelativePath: "entry", ExpectedDestination: prior, SelectedExpectation: selected, CandidateName: candidateName, PriorName: priorName}
	if err := workspaceConfinedWriteRecoveryRecord(workspaceConfinedRecoveryRecordPath(recovery, "op"), record); err != nil {
		t.Fatal(err)
	}
	result := runLinuxWorkspaceConfinedExchange(t, workspaceConfinedRecoverCommand, map[string]any{"v": 1, "rootPath": root, "recoveryDirectory": recovery, "operationId": "op"})
	if result["status"] != "recovery_needed" {
		t.Fatalf("unexpected recovery result: %#v", result)
	}
	content, err := os.ReadFile(publicPath)
	if err != nil || string(content) != "external" {
		t.Fatalf("external writer was overwritten: %q %v", content, err)
	}
	if _, err := os.Stat(filepath.Join(root, priorName)); err != nil {
		t.Fatalf("prior recovery material missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, candidateName)); err != nil {
		t.Fatalf("selected recovery material missing: %v", err)
	}
}

func TestLinuxWorkspaceConfinedRecoverRetainsChangedDisplacedEntry(t *testing.T) {
	root := t.TempDir()
	recovery := t.TempDir()
	priorName := ".happier-conflict-resolution-op-prior"
	priorPath := filepath.Join(root, priorName)
	selectedPath := filepath.Join(root, "entry")
	if err := os.WriteFile(priorPath, []byte("reviewed old bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	prior, err := observeWorkspaceConfinedPrivateMaterial(priorPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(selectedPath, []byte("selected bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	selected, err := observeWorkspaceConfinedPrivateMaterial(selectedPath)
	if err != nil {
		t.Fatal(err)
	}
	rootHandle, err := openWorkspaceConfinedLinuxRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	identity := linuxWorkspaceConfinedIdentity(rootHandle)
	_ = unixCloseForTest(rootHandle.fd)
	record := workspaceConfinedRecoveryRecord{V: 1, OperationID: "op", RootPath: root, RootIdentity: identity, RelativePath: "entry", ExpectedDestination: prior, SelectedExpectation: selected, CandidateName: ".happier-conflict-resolution-op-selected", PriorName: priorName}
	if err := workspaceConfinedWriteRecoveryRecord(workspaceConfinedRecoveryRecordPath(recovery, "op"), record); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(priorPath, []byte("later unreviewed bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	result := runLinuxWorkspaceConfinedExchange(t, workspaceConfinedRecoverCommand, map[string]any{"v": 1, "rootPath": root, "recoveryDirectory": recovery, "operationId": "op"})
	if result["status"] != "recovery_needed" {
		t.Fatalf("changed displaced entry was settled: %#v", result)
	}
	content, err := os.ReadFile(priorPath)
	if err != nil || string(content) != "later unreviewed bytes" {
		t.Fatalf("changed displaced bytes were removed: %q %v", content, err)
	}
}

func TestLinuxWorkspaceConfinedRecoverSettlesInstalledEntryAfterPriorCleanup(t *testing.T) {
	root := t.TempDir()
	recovery := t.TempDir()
	selectedPath := filepath.Join(root, "entry")
	if err := os.WriteFile(selectedPath, []byte("selected bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	selected, err := observeWorkspaceConfinedPrivateMaterial(selectedPath)
	if err != nil {
		t.Fatal(err)
	}
	priorPath := filepath.Join(root, ".happier-conflict-resolution-op-prior")
	if err := os.WriteFile(priorPath, []byte("old bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	prior, err := observeWorkspaceConfinedPrivateMaterial(priorPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(priorPath); err != nil {
		t.Fatal(err)
	}
	rootHandle, err := openWorkspaceConfinedLinuxRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	identity := linuxWorkspaceConfinedIdentity(rootHandle)
	_ = unixCloseForTest(rootHandle.fd)
	record := workspaceConfinedRecoveryRecord{V: 1, OperationID: "op", RootPath: root, RootIdentity: identity, RelativePath: "entry", ExpectedDestination: prior, SelectedExpectation: selected, CandidateName: ".happier-conflict-resolution-op-selected", PriorName: ".happier-conflict-resolution-op-prior"}
	if err := workspaceConfinedWriteRecoveryRecord(workspaceConfinedRecoveryRecordPath(recovery, "op"), record); err != nil {
		t.Fatal(err)
	}
	result := runLinuxWorkspaceConfinedExchange(t, workspaceConfinedRecoverCommand, map[string]any{"v": 1, "rootPath": root, "recoveryDirectory": recovery, "operationId": "op"})
	if result["status"] != "settled" {
		t.Fatalf("installed entry was not settled after prior cleanup: %#v", result)
	}
}

func TestLinuxWorkspaceConfinedRecoverRetainsChangedStagedEntry(t *testing.T) {
	root := t.TempDir()
	recovery := t.TempDir()
	publicPath := filepath.Join(root, "entry")
	if err := os.WriteFile(publicPath, []byte("selected"), 0o600); err != nil {
		t.Fatal(err)
	}
	selected, err := observeWorkspaceConfinedPrivateMaterial(publicPath)
	if err != nil {
		t.Fatal(err)
	}
	candidateName := ".happier-conflict-resolution-op-selected"
	candidatePath := filepath.Join(root, candidateName)
	if err := os.WriteFile(candidatePath, []byte("unreviewed"), 0o600); err != nil {
		t.Fatal(err)
	}
	rootHandle, err := openWorkspaceConfinedLinuxRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	identity := linuxWorkspaceConfinedIdentity(rootHandle)
	_ = unixCloseForTest(rootHandle.fd)
	record := workspaceConfinedRecoveryRecord{V: 1, OperationID: "op", RootPath: root, RootIdentity: identity, RelativePath: "entry", ExpectedDestination: workspaceConfinedExpectation{Kind: workspaceConfinedKindMissing}, SelectedExpectation: selected, CandidateName: candidateName, PriorName: ".happier-conflict-resolution-op-prior"}
	if err := workspaceConfinedWriteRecoveryRecord(workspaceConfinedRecoveryRecordPath(recovery, "op"), record); err != nil {
		t.Fatal(err)
	}
	result := runLinuxWorkspaceConfinedExchange(t, workspaceConfinedRecoverCommand, map[string]any{"v": 1, "rootPath": root, "recoveryDirectory": recovery, "operationId": "op"})
	if result["status"] != "recovery_needed" {
		t.Fatalf("changed staged entry was settled: %#v", result)
	}
	if content, err := os.ReadFile(candidatePath); err != nil || string(content) != "unreviewed" {
		t.Fatalf("changed staged bytes were removed: %q %v", content, err)
	}
}

func TestLinuxWorkspaceConfinedApplyIntentionalMissingDoesNotCreateRecoveryBlock(t *testing.T) {
	root := t.TempDir()
	recovery := t.TempDir()
	target := filepath.Join(root, "entry")
	if err := os.WriteFile(target, []byte("remove"), 0o600); err != nil {
		t.Fatal(err)
	}
	destination, err := observeWorkspaceConfinedPrivateMaterial(target)
	if err != nil {
		t.Fatal(err)
	}
	result := runLinuxWorkspaceConfinedExchange(t, workspaceConfinedApplyCommand, map[string]any{"v": 1, "rootPath": root, "relativePath": "entry", "expectedDestination": destination, "selectedExpectation": workspaceConfinedExpectation{Kind: workspaceConfinedKindMissing}, "materialPath": nil, "recoveryDirectory": recovery, "operationId": "delete-intent"})
	if result["status"] != "installed" {
		t.Fatalf("unexpected apply result: %#v", result)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("intentional deletion was not installed: %v", err)
	}
	recovered := runLinuxWorkspaceConfinedExchange(t, workspaceConfinedRecoverCommand, map[string]any{"v": 1, "rootPath": root, "recoveryDirectory": recovery, "operationId": "delete-intent"})
	if recovered["status"] != "settled" {
		t.Fatalf("intentional absence created false recovery block: %#v", recovered)
	}
}

func unixCloseForTest(fd int) error { return os.NewFile(uintptr(fd), "root").Close() }
