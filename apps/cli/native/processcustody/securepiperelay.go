package main

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	securePipeRelaySecretBytes = 32
	securePipeRelayNonceBytes  = 16
	securePipeRelayMACBytes    = 32
)

var securePipeRelayMagic = []byte("HWSPIPE1")

type securePipeRelayOptions struct {
	pipeName   string
	targetPort uint16
}

func parseSecurePipeRelayOptions(args []string) (securePipeRelayOptions, error) {
	var options securePipeRelayOptions
	for _, arg := range args {
		switch {
		case strings.HasPrefix(arg, "--pipe-name=") && options.pipeName == "":
			options.pipeName = strings.TrimPrefix(arg, "--pipe-name=")
		case strings.HasPrefix(arg, "--target-port=") && options.targetPort == 0:
			parsed, err := strconv.ParseUint(strings.TrimPrefix(arg, "--target-port="), 10, 16)
			if err != nil || parsed == 0 {
				return securePipeRelayOptions{}, fmt.Errorf("invalid secure pipe relay target port")
			}
			options.targetPort = uint16(parsed)
		default:
			return securePipeRelayOptions{}, fmt.Errorf("invalid secure pipe relay argument")
		}
	}
	if !strings.HasPrefix(options.pipeName, `\\.\pipe\happier-workspace-sync-`) || len(options.pipeName) > 256 {
		return securePipeRelayOptions{}, fmt.Errorf("invalid workspace-sync named-pipe path")
	}
	if options.targetPort == 0 {
		return securePipeRelayOptions{}, fmt.Errorf("secure pipe relay target port is required")
	}
	return options, nil
}
