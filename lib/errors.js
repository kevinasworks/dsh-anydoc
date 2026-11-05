/**
 * Error vocabulary for dsh-anydoc.
 *
 * Every failure the plugin reports carries a stable `errorCode` so a model or a
 * human can branch on it without parsing prose. Upstream AnyDoc codes are
 * mapped onto these names; anything the plugin itself detects uses its own code.
 *
 * @module dsh-anydoc/errors
 */

/**
 * The `error.code` values the AnyDoc Node binding rejects with.
 * @see https://github.com/firecrawl/anydoc/blob/main/node/README.md
 */
export const ENGINE_CODES = Object.freeze([
  'unsupported',
  'needsOcr',
  'malformed',
  'encrypted',
  'resourceLimit',
  'missingPart',
  'io',
  'hosted',
])

/** Upstream engine code -> plugin error code. */
export const ENGINE_CODE_MAP = Object.freeze({
  unsupported: 'UNSUPPORTED_FORMAT',
  needsOcr: 'NEEDS_OCR',
  malformed: 'MALFORMED_DOCUMENT',
  encrypted: 'ENCRYPTED_DOCUMENT',
  resourceLimit: 'RESOURCE_LIMIT',
  missingPart: 'MISSING_PART',
  io: 'IO_ERROR',
  // Unreachable in this plugin: hosted OCR is never requested. Kept so an
  // unexpected upstream path still produces a recognisable code.
  hosted: 'HOSTED_OCR_DISABLED',
})

/** A failure the plugin detected itself, with a stable code. */
export class AnyDocFailure extends Error {
  /**
   * @param {string} code stable plugin error code.
   * @param {string} message human-readable detail.
   * @param {object} [details] extra JSON-safe fields (pages, path, cause code).
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'AnyDocFailure'
    this.code = code
    this.details = details
  }
}

/**
 * Convert any thrown value into `{ errorCode, errorMessage, pages, warnings }`.
 * Unknown throwables keep their message but are labelled `UNKNOWN_ERROR`.
 * @param {unknown} error
 * @returns {{ errorCode: string, errorMessage: string, pages: number[] | undefined }}
 */
export function describeFailure(error) {
  if (error instanceof AnyDocFailure) {
    return {
      errorCode: error.code,
      errorMessage: error.message,
      pages: Array.isArray(error.details?.pages) ? error.details.pages : undefined,
    }
  }
  const code = typeof error?.code === 'string' ? error.code : undefined
  const message = error instanceof Error ? error.message : String(error)
  if (code !== undefined && code in ENGINE_CODE_MAP) {
    return {
      errorCode: ENGINE_CODE_MAP[code],
      errorMessage: message,
      pages: Array.isArray(error.pages) ? error.pages : undefined,
    }
  }
  return { errorCode: code !== undefined ? code.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_') : 'UNKNOWN_ERROR', errorMessage: message, pages: undefined }
}

/**
 * One short actionable hint for a failure code, appended to the model-facing
 * rendering. Deliberately does not suggest any hosted/remote fallback.
 * @param {string} code
 * @returns {string}
 */
export function hintForCode(code) {
  switch (code) {
    case 'NEEDS_OCR':
      return 'The PDF pages listed are scanned or image-only. AnyDoc does no OCR and this plugin keeps conversion local, so no remote OCR is attempted. Supply a text-layer PDF, or convert the pages with a local OCR tool first.'
    case 'ENCRYPTED_DOCUMENT':
      return 'The document is encrypted or password-protected. Remove the password with an authorised tool before converting.'
    case 'UNSUPPORTED_FORMAT':
      return 'Neither the file content nor its extension names a supported format.'
    case 'MALFORMED_DOCUMENT':
      return 'The file is structurally unusable; no meaningful text could be extracted.'
    case 'RESOURCE_LIMIT':
      return 'AnyDoc refused the document at one of its fixed safety limits (decompression, nesting depth, node count). The file is not processed further.'
    case 'MISSING_PART':
      return 'A package part required for meaningful output is absent from the file.'
    case 'FILE_TOO_LARGE':
      return 'The file exceeds maxFileBytes. Raise the limit in the plugin configuration only for a document you trust.'
    case 'TIMEOUT':
      return 'The conversion exceeded timeoutMs. The engine process was stopped, so the work really did stop.'
    case 'TIMEOUT_NOT_CANCELLED':
      return 'The conversion exceeded timeoutMs, but the in-process engine cannot be interrupted. Its work may still finish in the background.'
    case 'CANCELLED':
      return 'The tool call was cancelled.'
    case 'OUTPUT_EXISTS':
      return 'The output file already exists and overwrite is false.'
    case 'PATH_OUTSIDE_ALLOWED_ROOTS':
      return 'The path is outside allowedRoots. Add the directory to allowedRoots in the plugin configuration to permit it.'
    case 'PATH_FORBIDDEN':
      return 'The path names a credential or key location that this plugin refuses to read.'
    case 'FILE_NOT_FOUND':
      return 'No file exists at that path. Pass an absolute path, or a path relative to the session working directory.'
    case 'NOT_A_FILE':
      return 'The path names a directory or special file; pass one document file.'
    case 'EMPTY_FILE':
      return 'The file is zero bytes, so there is nothing to convert.'
    case 'PERMISSION_DENIED':
      return 'The process cannot read this file. Check its permissions, or move it somewhere readable.'
    case 'OUTPUT_UNWRITABLE':
      return 'The output directory cannot be created or written. Choose another outputDir.'
    case 'OUTPUT_TOO_LARGE':
      return 'The converted Markdown is larger than maxOutputChars. Raise the limit or split the document.'
    case 'INVALID_ARGUMENT':
      return 'One argument is unusable; check the tool schema and retry.'
    case 'NATIVE_UNAVAILABLE':
      return 'The AnyDoc native binding did not load. Run anydoc_capabilities for the exact error.'
    default:
      return ''
  }
}
