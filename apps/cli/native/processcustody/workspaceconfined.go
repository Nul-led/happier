package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
)

const (
	workspaceConfinedMaxRequestBytes = 64 * 1024
	workspaceConfinedMaxPreviewBytes = 1024 * 1024
)

type workspaceConfinedKind string

const (
	workspaceConfinedKindMissing   workspaceConfinedKind = "missing"
	workspaceConfinedKindFile      workspaceConfinedKind = "file"
	workspaceConfinedKindDirectory workspaceConfinedKind = "directory"
	workspaceConfinedKindSymlink   workspaceConfinedKind = "symlink"
)

var workspaceConfinedDigestPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

type workspaceConfinedReadRequest struct {
	rootPath       string
	relativePath   string
	maxBytes       int64
	expectedDigest string
}

type workspaceConfinedDeleteRequest struct {
	rootPath       string
	relativePath   string
	expectedKind   workspaceConfinedKind
	expectedDigest string
}

type workspaceConfinedPreparedOperation interface {
	commit() workspaceConfinedResult
	close()
}

type workspaceConfinedResult struct {
	V             int     `json:"v"`
	T             string  `json:"t"`
	Status        string  `json:"status"`
	ActualDigest  string  `json:"actualDigest,omitempty"`
	Size          *uint64 `json:"size,omitempty"`
	Digest        string  `json:"digest,omitempty"`
	ContentBase64 *string `json:"contentBase64,omitempty"`
	Code          string  `json:"code,omitempty"`
	Message       string  `json:"message,omitempty"`
	RecoveryPath  string  `json:"recoveryPath,omitempty"`
}

type workspaceConfinedDomainError struct {
	code         string
	message      string
	recoveryPath string
}

func workspaceConfinedError(code, message string) *workspaceConfinedDomainError {
	return &workspaceConfinedDomainError{code: code, message: message}
}

func workspaceConfinedRecoveryError(code, message, recoveryPath string) *workspaceConfinedDomainError {
	return &workspaceConfinedDomainError{code: code, message: message, recoveryPath: recoveryPath}
}

func (e *workspaceConfinedDomainError) result() workspaceConfinedResult {
	return workspaceConfinedResult{
		V:            1,
		T:            "workspace-confined-result",
		Status:       "error",
		Code:         e.code,
		Message:      e.message,
		RecoveryPath: e.recoveryPath,
	}
}

func workspaceConfinedSuccess(status string) workspaceConfinedResult {
	return workspaceConfinedResult{V: 1, T: "workspace-confined-result", Status: status}
}

func workspaceConfinedString(value string) *string {
	return &value
}

func decodeClosedWorkspaceConfinedObject(encoded []byte, allowed map[string]bool) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	delimiter, ok := token.(json.Delim)
	if !ok || delimiter != '{' {
		return nil, fmt.Errorf("JSON value must be an object")
	}
	result := make(map[string]json.RawMessage, len(allowed))
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return nil, err
		}
		key, ok := token.(string)
		if !ok || !allowed[key] {
			return nil, fmt.Errorf("unknown field")
		}
		if _, duplicate := result[key]; duplicate {
			return nil, fmt.Errorf("duplicate field")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		result[key] = value
	}
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	if decoder.More() {
		return nil, fmt.Errorf("unexpected trailing JSON")
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("unexpected trailing JSON")
		}
		return nil, err
	}
	return result, nil
}

func decodeRequiredString(fields map[string]json.RawMessage, key string) (string, error) {
	encoded, ok := fields[key]
	if !ok {
		return "", fmt.Errorf("missing %s", key)
	}
	var value string
	if err := json.Unmarshal(encoded, &value); err != nil {
		return "", fmt.Errorf("invalid %s", key)
	}
	return value, nil
}

func decodeVersion(fields map[string]json.RawMessage) error {
	encoded, ok := fields["v"]
	if !ok {
		return fmt.Errorf("unsupported protocol version")
	}
	var version int
	if err := json.Unmarshal(encoded, &version); err != nil || version != 1 {
		return fmt.Errorf("unsupported protocol version")
	}
	return nil
}

func decodeOptionalDigest(fields map[string]json.RawMessage) (string, error) {
	encoded, ok := fields["expectedDigest"]
	if !ok {
		return "", nil
	}
	var value string
	if err := json.Unmarshal(encoded, &value); err != nil || !workspaceConfinedDigestPattern.MatchString(value) {
		return "", fmt.Errorf("invalid expectedDigest")
	}
	return value, nil
}

func decodeWorkspaceConfinedReadRequest(encoded []byte) (workspaceConfinedReadRequest, error) {
	fields, err := decodeClosedWorkspaceConfinedObject(encoded, map[string]bool{
		"v": true, "rootPath": true, "relativePath": true, "maxBytes": true, "expectedDigest": true,
	})
	if err != nil {
		return workspaceConfinedReadRequest{}, err
	}
	if err := decodeVersion(fields); err != nil {
		return workspaceConfinedReadRequest{}, err
	}
	rootPath, err := decodeRequiredString(fields, "rootPath")
	if err != nil {
		return workspaceConfinedReadRequest{}, err
	}
	relativePath, err := decodeRequiredString(fields, "relativePath")
	if err != nil {
		return workspaceConfinedReadRequest{}, err
	}
	maxEncoded, ok := fields["maxBytes"]
	if !ok {
		return workspaceConfinedReadRequest{}, fmt.Errorf("missing maxBytes")
	}
	var maxBytes int64
	if err := json.Unmarshal(maxEncoded, &maxBytes); err != nil || maxBytes < 1 || maxBytes > workspaceConfinedMaxPreviewBytes {
		return workspaceConfinedReadRequest{}, fmt.Errorf("invalid maxBytes")
	}
	expectedDigest, err := decodeOptionalDigest(fields)
	if err != nil {
		return workspaceConfinedReadRequest{}, err
	}
	return workspaceConfinedReadRequest{
		rootPath: rootPath, relativePath: relativePath, maxBytes: maxBytes, expectedDigest: expectedDigest,
	}, nil
}

func decodeWorkspaceConfinedDeleteRequest(encoded []byte) (workspaceConfinedDeleteRequest, error) {
	fields, err := decodeClosedWorkspaceConfinedObject(encoded, map[string]bool{
		"v": true, "rootPath": true, "relativePath": true, "expectedKind": true, "expectedDigest": true,
	})
	if err != nil {
		return workspaceConfinedDeleteRequest{}, err
	}
	if err := decodeVersion(fields); err != nil {
		return workspaceConfinedDeleteRequest{}, err
	}
	rootPath, err := decodeRequiredString(fields, "rootPath")
	if err != nil {
		return workspaceConfinedDeleteRequest{}, err
	}
	relativePath, err := decodeRequiredString(fields, "relativePath")
	if err != nil {
		return workspaceConfinedDeleteRequest{}, err
	}
	kindValue, err := decodeRequiredString(fields, "expectedKind")
	if err != nil {
		return workspaceConfinedDeleteRequest{}, err
	}
	kind := workspaceConfinedKind(kindValue)
	if kind != workspaceConfinedKindMissing && kind != workspaceConfinedKindFile && kind != workspaceConfinedKindDirectory && kind != workspaceConfinedKindSymlink {
		return workspaceConfinedDeleteRequest{}, fmt.Errorf("invalid expectedKind")
	}
	expectedDigest, err := decodeOptionalDigest(fields)
	if err != nil {
		return workspaceConfinedDeleteRequest{}, err
	}
	if kind == workspaceConfinedKindFile && expectedDigest == "" {
		return workspaceConfinedDeleteRequest{}, fmt.Errorf("file deletion requires expectedDigest")
	}
	if kind != workspaceConfinedKindFile && expectedDigest != "" {
		return workspaceConfinedDeleteRequest{}, fmt.Errorf("expectedDigest is valid only for files")
	}
	return workspaceConfinedDeleteRequest{
		rootPath: rootPath, relativePath: relativePath, expectedKind: kind, expectedDigest: expectedDigest,
	}, nil
}

func decodeWorkspaceConfinedDecision(encoded []byte) (string, error) {
	fields, err := decodeClosedWorkspaceConfinedObject(encoded, map[string]bool{"v": true, "decision": true})
	if err != nil {
		return "", err
	}
	if err := decodeVersion(fields); err != nil {
		return "", err
	}
	decision, err := decodeRequiredString(fields, "decision")
	if err != nil {
		return "", err
	}
	if decision != "commit" && decision != "abort" {
		return "", fmt.Errorf("invalid decision")
	}
	return decision, nil
}

func readWorkspaceConfinedLine(reader *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		fragment, more, err := reader.ReadLine()
		if err != nil {
			return nil, err
		}
		if len(line)+len(fragment) > workspaceConfinedMaxRequestBytes {
			return nil, fmt.Errorf("JSON line exceeds limit")
		}
		line = append(line, fragment...)
		if !more {
			return line, nil
		}
	}
}

func writeWorkspaceConfinedRecord(writer io.Writer, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = writer.Write(append(encoded, '\n'))
	return err
}

func runWorkspaceConfinedExchange(
	args []string,
	input io.Reader,
	output io.Writer,
	decodeRequest func([]byte) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError),
) error {
	if len(args) != 0 {
		return fmt.Errorf("workspace-confined command accepts no arguments")
	}
	reader := bufio.NewReader(input)
	requestLine, err := readWorkspaceConfinedLine(reader)
	if err != nil {
		return fmt.Errorf("read workspace-confined request: %w", err)
	}
	operation, domainErr := decodeRequest(requestLine)
	if domainErr != nil {
		return writeWorkspaceConfinedRecord(output, domainErr.result())
	}
	defer operation.close()
	if err := writeWorkspaceConfinedRecord(output, struct {
		V int    `json:"v"`
		T string `json:"t"`
	}{V: 1, T: "workspace-confined-prepared"}); err != nil {
		return err
	}
	decisionLine, err := readWorkspaceConfinedLine(reader)
	if err == io.EOF {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read workspace-confined decision: %w", err)
	}
	decision, err := decodeWorkspaceConfinedDecision(decisionLine)
	if err != nil {
		return writeWorkspaceConfinedRecord(output, workspaceConfinedError("workspace_root_unsafe", "invalid workspace confinement decision").result())
	}
	if decision == "abort" {
		return nil
	}
	return writeWorkspaceConfinedRecord(output, operation.commit())
}

func workspaceConfinedReadCommand(args []string, input io.Reader, output io.Writer) error {
	return runWorkspaceConfinedExchange(args, input, output, func(encoded []byte) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
		request, err := decodeWorkspaceConfinedReadRequest(encoded)
		if err != nil {
			return nil, workspaceConfinedError("workspace_root_unsafe", "invalid workspace-confined read request")
		}
		return prepareWorkspaceConfinedRead(request)
	})
}

func workspaceConfinedDeleteCommand(args []string, input io.Reader, output io.Writer) error {
	return runWorkspaceConfinedExchange(args, input, output, func(encoded []byte) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
		request, err := decodeWorkspaceConfinedDeleteRequest(encoded)
		if err != nil {
			return nil, workspaceConfinedError("workspace_root_unsafe", "invalid workspace-confined delete request")
		}
		return prepareWorkspaceConfinedDelete(request)
	})
}
