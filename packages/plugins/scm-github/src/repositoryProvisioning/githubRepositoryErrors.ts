import {
  SCM_OPERATION_ERROR_CODES,
  type ScmOperationErrorCode,
} from '@happier-dev/plugin-sdk/scm';

import { describeGithubRateLimitFailure } from '../observations/githubResponseFailure.js';

export class GithubRepositoryProvisioningError extends Error {
  readonly errorCode: ScmOperationErrorCode;

  constructor(message: string, errorCode: ScmOperationErrorCode) {
    super(message);
    this.name = 'GithubRepositoryProvisioningError';
    this.errorCode = errorCode;
  }
}

export function createGithubRepositoryAuthRequiredError(
  message = 'GitHub repository authentication is required',
): GithubRepositoryProvisioningError {
  return new GithubRepositoryProvisioningError(message, SCM_OPERATION_ERROR_CODES.REMOTE_AUTH_REQUIRED);
}

export function createGithubRepositoryNotFoundError(
  message = 'GitHub repository was not found',
): GithubRepositoryProvisioningError {
  return new GithubRepositoryProvisioningError(message, SCM_OPERATION_ERROR_CODES.REMOTE_NOT_FOUND);
}

export function createGithubRepositoryCommandFailedError(
  message = 'GitHub repository operation failed',
): GithubRepositoryProvisioningError {
  return new GithubRepositoryProvisioningError(message, SCM_OPERATION_ERROR_CODES.COMMAND_FAILED);
}

export function createGithubRepositoryRemoteRejectedError(
  message = 'GitHub repository operation was rejected',
): GithubRepositoryProvisioningError {
  return new GithubRepositoryProvisioningError(message, SCM_OPERATION_ERROR_CODES.REMOTE_REJECTED);
}

export function createGithubRepositoryAlreadyExistsError(
  message = 'GitHub repository already exists',
): GithubRepositoryProvisioningError {
  return new GithubRepositoryProvisioningError(message, SCM_OPERATION_ERROR_CODES.REMOTE_ALREADY_EXISTS);
}

/**
 * A GitHub throttle is a temporarily unavailable backend, never a credential the
 * owner must repair: `REMOTE_AUTH_REQUIRED` or `REMOTE_REJECTED` would tell them
 * to reconnect or give up on an account and a request that are both fine.
 */
export function createGithubRepositoryRateLimitedError(
  retryNotBeforeMs: number | undefined,
): GithubRepositoryProvisioningError {
  return new GithubRepositoryProvisioningError(
    describeGithubRateLimitFailure(retryNotBeforeMs),
    SCM_OPERATION_ERROR_CODES.BACKEND_UNAVAILABLE,
  );
}

export function createGithubRepositoryUnsupportedError(
  message = 'GitHub repository operation is unsupported',
): GithubRepositoryProvisioningError {
  return new GithubRepositoryProvisioningError(message, SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED);
}

export function isGithubRepositoryAuthRequiredError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === 'object'
    && (error as { errorCode?: unknown }).errorCode === SCM_OPERATION_ERROR_CODES.REMOTE_AUTH_REQUIRED;
}

export function isGithubRepositoryNotFoundError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === 'object'
    && (error as { errorCode?: unknown }).errorCode === SCM_OPERATION_ERROR_CODES.REMOTE_NOT_FOUND;
}
