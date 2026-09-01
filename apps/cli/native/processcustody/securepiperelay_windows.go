//go:build windows

package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"os"
	"os/user"
	"sync"

	winio "github.com/Microsoft/go-winio"
)

type fileDescriptor interface {
	Fd() uintptr
}

type closeWriter interface {
	CloseWrite() error
}

func securePipeListenerConfig(userSID string) *winio.PipeConfig {
	return &winio.PipeConfig{
		SecurityDescriptor: fmt.Sprintf("D:P(A;;GA;;;%s)", userSID),
		// go-winio supports CloseWrite only for message-mode pipes. Both named-
		// pipe endpoints are go-winio, and the relay presents only an ordinary
		// byte stream to the TypeScript broker over loopback TCP.
		MessageMode:      true,
		InputBufferSize:  64 * 1024,
		OutputBufferSize: 64 * 1024,
	}
}

func readSecurePipeRelaySecret() ([]byte, error) {
	secret := make([]byte, securePipeRelaySecretBytes)
	_, err := io.ReadFull(os.Stdin, secret)
	if err != nil {
		return nil, fmt.Errorf("read secure pipe relay secret: %w", err)
	}
	return secret, nil
}

func securePipeRelayPreamble(secret []byte, peerPID int) ([]byte, error) {
	if len(secret) != securePipeRelaySecretBytes || peerPID < 1 || uint64(peerPID) > uint64(^uint32(0)) {
		return nil, fmt.Errorf("invalid secure pipe relay witness")
	}
	authenticated := make([]byte, len(securePipeRelayMagic)+4+securePipeRelayNonceBytes)
	copy(authenticated, securePipeRelayMagic)
	binary.BigEndian.PutUint32(authenticated[len(securePipeRelayMagic):], uint32(peerPID))
	if _, err := rand.Read(authenticated[len(securePipeRelayMagic)+4:]); err != nil {
		return nil, fmt.Errorf("create secure pipe relay nonce: %w", err)
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(authenticated)
	return append(authenticated, mac.Sum(nil)...), nil
}

func relayOpaqueBytes(pipe net.Conn, loopback *net.TCPConn) {
	defer pipe.Close()
	defer loopback.Close()
	var copies sync.WaitGroup
	copies.Add(2)
	copyHalf := func(destination io.Writer, source io.Reader) {
		defer copies.Done()
		_, _ = io.Copy(destination, source)
		if half, ok := destination.(closeWriter); ok {
			_ = half.CloseWrite()
		}
	}
	go copyHalf(loopback, pipe)
	go copyHalf(pipe, loopback)
	copies.Wait()
}

func serveSecurePipeConnection(connection net.Conn, target string, secret []byte) {
	descriptor, ok := connection.(fileDescriptor)
	if !ok {
		_ = connection.Close()
		return
	}
	peerPID, err := namedPipeClientPid(descriptor.Fd())
	if err != nil {
		_ = connection.Close()
		return
	}
	preamble, err := securePipeRelayPreamble(secret, peerPID)
	if err != nil {
		_ = connection.Close()
		return
	}
	loopbackConnection, err := net.Dial("tcp4", target)
	if err != nil {
		_ = connection.Close()
		return
	}
	loopback, ok := loopbackConnection.(*net.TCPConn)
	if !ok {
		_ = loopbackConnection.Close()
		_ = connection.Close()
		return
	}
	if _, err := loopback.Write(preamble); err != nil {
		_ = loopback.Close()
		_ = connection.Close()
		return
	}
	relayOpaqueBytes(connection, loopback)
}

func securePipeRelayCommand(args []string) error {
	options, err := parseSecurePipeRelayOptions(args)
	if err != nil {
		return err
	}
	secret, err := readSecurePipeRelaySecret()
	if err != nil {
		return err
	}
	defer func() {
		for index := range secret {
			secret[index] = 0
		}
	}()
	current, err := user.Current()
	if err != nil {
		return fmt.Errorf("resolve current Windows user SID: %w", err)
	}
	if current.Uid == "" {
		return fmt.Errorf("resolve current Windows user SID: empty SID")
	}
	listener, err := winio.ListenPipe(options.pipeName, securePipeListenerConfig(current.Uid))
	if err != nil {
		return fmt.Errorf("listen on secured workspace-sync named pipe: %w", err)
	}
	defer listener.Close()
	// Stdin remains open after its fixed secret as the parent-lifetime signal.
	// Daemon exit closes the inherited pipe, which retires this listener and
	// every relay without a second supervision owner or durable state.
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		_ = listener.Close()
	}()
	if err := emit(map[string]any{
		"t":        "secure-pipe-relay-ready",
		"pipeName": options.pipeName,
	}); err != nil {
		return err
	}
	target := fmt.Sprintf("127.0.0.1:%d", options.targetPort)
	for {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			return fmt.Errorf("accept secured workspace-sync named pipe: %w", acceptErr)
		}
		go serveSecurePipeConnection(connection, target, secret)
	}
}
