//go:build linux || darwin || windows

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceConfinedInspectRecoveryUsesNativeRecordParser(t *testing.T) {
	directory := t.TempDir()
	root := t.TempDir()
	recordPath := workspaceConfinedRecoveryRecordPath(directory, "reviewed")
	record := workspaceConfinedRecoveryRecord{
		V: 1, OperationID: "reviewed", RootPath: root, RootIdentity: "held-root", RelativePath: "entry",
		ExpectedDestination: workspaceConfinedExpectation{Kind: workspaceConfinedKindMissing},
		SelectedExpectation: workspaceConfinedExpectation{Kind: workspaceConfinedKindMissing},
		CandidateName:       ".happier-conflict-resolution-reviewed-selected",
		PriorName:           ".happier-conflict-resolution-reviewed-prior",
	}
	if err := workspaceConfinedWriteRecoveryRecord(recordPath, record); err != nil {
		t.Fatal(err)
	}
	request := `{"v":1,"recoveryDirectory":` + mustJSONWorkspaceConfinedTest(t, directory) + `,"operationId":"reviewed"}`
	var output bytes.Buffer
	if err := workspaceConfinedInspectCommand(nil, strings.NewReader(request+"\n"+`{"v":1,"decision":"commit"}`+"\n"), &output); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected prepared and inspected records, got %q", output.String())
	}
	var result workspaceConfinedResult
	if err := json.Unmarshal([]byte(lines[1]), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "recovery_record" || result.OperationID != "reviewed" || result.RootPath != root {
		t.Fatalf("native inspection did not return the recovery owner: %#v", result)
	}
	if err := os.WriteFile(recordPath, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	if err := workspaceConfinedInspectCommand(nil, strings.NewReader(request+"\n"+`{"v":1,"decision":"commit"}`+"\n"), &output); err != nil {
		t.Fatal(err)
	}
	lines = strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 || !strings.Contains(lines[1], `"status":"error"`) {
		t.Fatalf("malformed recovery record was not rejected: %q", output.String())
	}
}

func mustJSONWorkspaceConfinedTest(t *testing.T, value string) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func TestWorkspaceConfinedDirectoryFingerprintMatchesLinuxCanonicalJSON(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "a&b"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "z\u2028x"), 0o700); err != nil {
		t.Fatal(err)
	}
	observed, err := observeWorkspaceConfinedPrivateMaterial(root)
	if err != nil {
		t.Fatal(err)
	}
	// SHA-256 of Linux JSON.stringify for the sorted a&b and z\u2028x child entries.
	if observed.Kind != workspaceConfinedKindDirectory || observed.Fingerprint != "16d36673c1af0a8e527ca252a11029f657895d726303d6e4b353101d46fe5d7d" {
		t.Fatalf("directory fingerprint differs from Linux canonical encoding: %#v", observed)
	}
}

func TestWorkspaceConfinedApplyRejectsDirectoryChildDrift(t *testing.T) {
	root := t.TempDir()
	recovery := t.TempDir()
	capture := t.TempDir()
	target := filepath.Join(root, "entry")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "old"), []byte("reviewed"), 0o600); err != nil {
		t.Fatal(err)
	}
	expected, err := observeWorkspaceConfinedPrivateMaterial(target)
	if err != nil {
		t.Fatal(err)
	}
	material := filepath.Join(capture, "selected")
	if err := os.WriteFile(material, []byte("selected"), 0o600); err != nil {
		t.Fatal(err)
	}
	selected, err := observeWorkspaceConfinedPrivateMaterial(material)
	if err != nil {
		t.Fatal(err)
	}
	operation, domainErr := prepareWorkspaceConfinedApply(workspaceConfinedApplyRequest{rootPath: root, relativePath: "entry", expectedDestination: expected, selectedExpectation: selected, materialPath: &material, recoveryDirectory: recovery, operationID: "child-drift"})
	if domainErr != nil {
		t.Fatal(domainErr)
	}
	defer operation.close()
	if err := os.WriteFile(filepath.Join(target, "new"), []byte("unreviewed"), 0o600); err != nil {
		t.Fatal(err)
	}
	result := operation.commit()
	if result.Status != "error" || result.Code != "conflict_changed" {
		t.Fatalf("changed subtree was accepted: %#v", result)
	}
	if content, err := os.ReadFile(filepath.Join(target, "new")); err != nil || string(content) != "unreviewed" {
		t.Fatalf("unreviewed child was removed: %q %v", content, err)
	}
}

func TestWorkspaceConfinedApplyDoesNotReplaceNewPublicEntry(t *testing.T) {
	root := t.TempDir()
	recovery := t.TempDir()
	capture := t.TempDir()
	material := filepath.Join(capture, "selected")
	if err := os.WriteFile(material, []byte("selected"), 0o600); err != nil {
		t.Fatal(err)
	}
	selected, err := observeWorkspaceConfinedPrivateMaterial(material)
	if err != nil {
		t.Fatal(err)
	}
	operation, domainErr := prepareWorkspaceConfinedApply(workspaceConfinedApplyRequest{rootPath: root, relativePath: "entry", expectedDestination: workspaceConfinedExpectation{Kind: workspaceConfinedKindMissing}, selectedExpectation: selected, materialPath: &material, recoveryDirectory: recovery, operationID: "new-entry"})
	if domainErr != nil {
		t.Fatal(domainErr)
	}
	defer operation.close()
	if err := os.WriteFile(filepath.Join(root, "entry"), []byte("external"), 0o600); err != nil {
		t.Fatal(err)
	}
	result := operation.commit()
	if result.Status != "error" || result.Code != "conflict_changed" {
		t.Fatalf("new public entry was accepted: %#v", result)
	}
	if content, err := os.ReadFile(filepath.Join(root, "entry")); err != nil || string(content) != "external" {
		t.Fatalf("new public entry was overwritten: %q %v", content, err)
	}
}
