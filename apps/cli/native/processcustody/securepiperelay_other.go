//go:build !windows

package main

import "fmt"

func securePipeRelayCommand(args []string) error {
	_ = args
	return fmt.Errorf("secure named-pipe relay is unavailable on this platform")
}
