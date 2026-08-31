// Test-only dialer for the peer-identity live tests: it connects to the unix
// socket path given in argv[1] from THIS distinct process and then holds the
// connection, so SO_PEERCRED binds the peer credentials to this process's pid.
// Go tooling ignores testdata directories, so this never becomes part of the
// helper build.
package main

import (
	"net"
	"os"
	"time"
)

func main() {
	connection, err := net.Dial("unix", os.Args[1])
	if err != nil {
		os.Exit(3)
	}
	defer connection.Close()
	time.Sleep(30 * time.Second)
}
