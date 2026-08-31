//go:build !linux && !darwin && !windows

// Platform guard for peer identity. Without a supported exact OS peer
// primitive every invocation fails closed instead of pretending to a proof it
// cannot provide.
package main

func peerIdentityCommand(args []string) error {
	return unsupportedPlatform()
}
