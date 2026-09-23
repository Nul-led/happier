function withWindowsHide(options, platform = process.platform) {
  if (platform === 'win32') {
    return { ...options, windowsHide: true };
  }
  return options;
}

function normalizeChildProcessExitCode(code) {
  return typeof code === 'number' ? code : 1;
}

module.exports = {
  normalizeChildProcessExitCode,
  withWindowsHide,
};
