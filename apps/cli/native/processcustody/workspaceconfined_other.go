//go:build !windows && !darwin

package main

func prepareWorkspaceConfinedRead(workspaceConfinedReadRequest) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
	return nil, workspaceConfinedError("workspace_root_unsafe", "native workspace confinement is available only on Windows")
}

func prepareWorkspaceConfinedDelete(workspaceConfinedDeleteRequest) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
	return nil, workspaceConfinedError("workspace_root_unsafe", "native workspace confinement is available only on Windows")
}
