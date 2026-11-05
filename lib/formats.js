/**
 * Format tables derived from the AnyDoc 0.2.4 documentation and verified
 * against its published binding.
 *
 * Extension lists are documentation and input validation only: the parser
 * decides from the file content, and a mislabelled file still converts. A
 * content-verified format is what the tools report as `detectedFormat`.
 *
 * @module dsh-anydoc/formats
 */

/** Canonical AnyDoc format -> the extensions that name it. */
export const FORMAT_EXTENSIONS = Object.freeze({
  doc: ['doc', 'docx', 'docm'],
  ppt: ['ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'ppsm'],
  xls: ['xls', 'xlsx', 'xlsm', 'xlsb'],
  odf: ['odt', 'ods', 'odp'],
  rtf: ['rtf'],
  epub: ['epub'],
  csv: ['csv'],
  pdf: ['pdf'],
})

/** Every extension named by the upstream supported-format table. */
export const SUPPORTED_EXTENSIONS = Object.freeze(
  [...new Set(Object.values(FORMAT_EXTENSIONS).flat())].sort(),
)

/** Formats whose bytes carry no signature and therefore need the extension hint. */
export const SIGNATURELESS_EXTENSIONS = Object.freeze(['csv'])

/**
 * Lowercase extension without the leading dot.
 * @param {string} path
 * @returns {string} the extension, or '' when the name has none.
 */
export function extensionOf(path) {
  const name = path.replaceAll('\\', '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Whether the name ends in one of the documented supported extensions.
 * This is a cheap pre-check, never proof that the content parses.
 * @param {string} path
 * @returns {boolean}
 */
export function hasSupportedExtension(path) {
  return SUPPORTED_EXTENSIONS.includes(extensionOf(path))
}

/**
 * Group an extension names, for warnings such as "extension not in the
 * documented list".
 * @param {string} extension
 * @returns {string | undefined}
 */
export function formatGroupOfExtension(extension) {
  for (const [group, extensions] of Object.entries(FORMAT_EXTENSIONS)) {
    if (extensions.includes(extension)) return group
  }
  return undefined
}
