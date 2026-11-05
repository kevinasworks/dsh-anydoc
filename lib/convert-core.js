/**
 * The conversion core shared by the worker process and the in-process
 * fallback. Keeping one implementation means both execution modes produce
 * byte-identical Markdown and identical error codes.
 *
 * Privacy invariant: no options object is ever passed to AnyDoc's conversion
 * functions. Upstream only leaves the machine when `ocr: 'hosted'` is
 * requested, so this module cannot trigger a network transfer of a document.
 *
 * @module dsh-anydoc/convert-core
 */

/** Media type -> file extension for exported assets. */
const MEDIA_TYPE_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/bmp', 'bmp'],
  ['image/tiff', 'tiff'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['image/x-emf', 'emf'],
  ['image/x-wmf', 'wmf'],
  ['image/emf', 'emf'],
  ['image/wmf', 'wmf'],
])

/** Upstream rejection code -> plugin error code (kept in sync with errors.js). */
export const CODE_MAP = Object.freeze({
  unsupported: 'UNSUPPORTED_FORMAT',
  needsOcr: 'NEEDS_OCR',
  malformed: 'MALFORMED_DOCUMENT',
  encrypted: 'ENCRYPTED_DOCUMENT',
  resourceLimit: 'RESOURCE_LIMIT',
  missingPart: 'MISSING_PART',
  io: 'IO_ERROR',
  hosted: 'HOSTED_OCR_DISABLED',
})

/**
 * @param {string} mediaType
 * @returns {string}
 */
export function extensionForMediaType(mediaType) {
  const known = MEDIA_TYPE_EXTENSIONS.get(String(mediaType).toLowerCase())
  if (known !== undefined) return known
  const subtype = String(mediaType).split('/')[1] ?? ''
  const cleaned = subtype.replaceAll(/[^a-z0-9]+/gi, '')
  return cleaned === '' ? 'bin' : cleaned
}

/**
 * @param {unknown} error
 * @returns {{ errorCode: string, errorMessage: string, pages: number[] | null, rawCode: string | null }}
 */
export function mapEngineError(error) {
  const rawCode = typeof error?.code === 'string' ? error.code : null
  return {
    errorCode: (rawCode !== null ? CODE_MAP[rawCode] : undefined) ?? 'CONVERSION_FAILED',
    errorMessage: error instanceof Error ? error.message : String(error),
    pages: Array.isArray(error?.pages) ? error.pages : null,
    rawCode,
  }
}

/**
 * Convert in-memory bytes and optionally collect embedded assets.
 *
 * @param {Record<string, unknown>} anydoc the loaded `@firecrawl/anydoc` module.
 * @param {{ bytes: Buffer, file: string, wantAssets: boolean, maxAssetBytes: number }} request
 * @returns {Promise<object>} a JSON-safe payload; throws the upstream error unchanged.
 */
export async function convertWithAnyDoc(anydoc, request) {
  const { bytes, file, wantAssets, maxAssetBytes } = request
  const warnings = []
  const startedAt = performance.now()

  const contentFormat = anydoc.formatFromBytes(bytes)
  const extensionFormat = anydoc.formatFromPath(file)
  const format = contentFormat ?? extensionFormat ?? null
  const formatSource = contentFormat != null ? 'content' : extensionFormat != null ? 'extension' : 'none'
  if (contentFormat == null && extensionFormat != null) {
    warnings.push(`format detection fell back to the file extension (${extensionFormat}): the content carries no signature`)
  }

  // Deliberately no options argument: `ocr: 'hosted'` would be the only path
  // that transfers the document, and this plugin never takes it.
  const markdown = await anydoc.toMarkdownBytes(bytes, format ?? undefined)

  let assets = []
  let assetsSkipped = 0
  if (wantAssets) {
    if (format === 'pdf' || format === 'csv' || format === null) {
      warnings.push(`asset export is not available for ${format ?? 'this'} input: AnyDoc has no document model for it`)
    } else {
      try {
        const document = await anydoc.toDocument(bytes, format)
        let budget = maxAssetBytes
        for (const asset of document.assets) {
          const size = asset.data.byteLength
          if (size > budget) {
            assetsSkipped += 1
            continue
          }
          budget -= size
          assets.push({
            id: asset.id,
            mediaType: asset.mediaType,
            originPart: asset.originPart,
            extension: extensionForMediaType(asset.mediaType),
            bytes: size,
            data: Buffer.from(asset.data).toString('base64'),
          })
        }
        if (assetsSkipped > 0) {
          warnings.push(`${assetsSkipped} asset(s) skipped: the maxAssetBytes budget of ${maxAssetBytes} bytes was exhausted`)
        }
      } catch (error) {
        warnings.push(`asset export failed: ${error?.code ?? error?.message ?? String(error)}`)
      }
    }
  }

  return {
    markdown,
    format,
    formatSource,
    contentFormat: contentFormat ?? null,
    extensionFormat: extensionFormat ?? null,
    bytesRead: bytes.byteLength,
    assets,
    assetsSkipped,
    warnings,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  }
}
