//go:build !windows && !darwin && !linux

package main

func prepareWorkspaceConfinedRead(workspaceConfinedReadRequest) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
	return nil, workspaceConfinedError("workspace_root_unsafe", "native workspace confinement is unavailable")
}

func prepareWorkspaceConfinedDelete(workspaceConfinedDeleteRequest) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
	return nil, workspaceConfinedError("workspace_root_unsafe", "native workspace confinement is unavailable")
}

func prepareWorkspaceConfinedObserve(workspaceConfinedObserveRequest) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
	return nil, workspaceConfinedError("workspace_root_unsafe", "native workspace confinement is unavailable")
}
func prepareWorkspaceConfinedCapture(workspaceConfinedCaptureRequest) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
	return nil, workspaceConfinedError("workspace_root_unsafe", "native workspace confinement is unavailable")
}
func prepareWorkspaceConfinedApply(workspaceConfinedApplyRequest) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
	return nil, workspaceConfinedError("workspace_root_unsafe", "native workspace confinement is unavailable")
}
func prepareWorkspaceConfinedRecover(workspaceConfinedRecoverRequest) (workspaceConfinedPreparedOperation, *workspaceConfinedDomainError) {
	return nil, workspaceConfinedError("workspace_root_unsafe", "native workspace confinement is unavailable")
}
