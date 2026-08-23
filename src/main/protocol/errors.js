'use strict';

class XtMusicError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'XtMusicError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

function normalizeError(error) {
  if (error instanceof XtMusicError) return error.toJSON();
  return {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    details: null
  };
}

module.exports = { XtMusicError, normalizeError };
