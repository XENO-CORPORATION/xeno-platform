// Catalog projection is capability-negotiated. Older Hub clients must never
// receive a multi-file manifest disguised as their single-GGUF installSpec.
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export function acceptsBundles(header) {
  return typeof header === 'string' && header.split(',').map(v => v.trim()).includes('bundle-v1');
}

export function validBundleSpec(spec) {
  return spec && spec.kind === 'bundle-v1' && ID.test(spec.bundleId)
    && DIGEST.test(spec.digest) && VERSION.test(spec.minimumRuntime)
    && spec.manifestKey === `models/bundles/${spec.bundleId}/${spec.digest}/xrt.bundle.json`
    && Number.isSafeInteger(spec.sizeBytes) && spec.sizeBytes > 0
    && Array.isArray(spec.platforms) && spec.platforms.length > 0
    && spec.platforms.every(v => typeof v === 'string' && /^[a-z0-9_-]+$/.test(v));
}

export function serializeLocalModelCatalogModel(model, { bundles = false, signUrl } = {}) {
  const bundle = model.bundleSpec;
  const isBundle = bundle != null;
  // Deliberately omit installSpec for bundle rows, even for capable clients.
  // An old reader then cannot dispatch a manifest into its GGUF downloader.
  const installSpec = !isBundle && model.installSpec ? {
    ...model.installSpec,
    downloadUrl: model.installSpec.artifactKey ? signUrl(model.installSpec.artifactKey, 6 * 60 * 60) : null,
  } : null;
  const bundleSpec = isBundle && bundles && validBundleSpec(bundle) ? {
    kind: 'bundle-v1', bundleId: bundle.bundleId, digest: bundle.digest,
    minimumRuntime: bundle.minimumRuntime, sizeBytes: bundle.sizeBytes,
    platforms: bundle.platforms,
    manifestUrl: signUrl(bundle.manifestKey, 6 * 60 * 60),
  } : null;
  const unavailableReason = isBundle && !bundleSpec
    ? (bundles ? 'Bundle metadata is invalid; installation is unavailable.' : 'Update the client to install multi-file model bundles.')
    : model.unavailableReason ?? null;
  return {
    id: model.id, name: model.name, provider: model.provider, category: model.category,
    description: model.description, size: model.size, sizeBytes: model.sizeBytes ?? null,
    parameters: model.parameters ?? null, tags: Array.isArray(model.tags) ? model.tags : [],
    license: model.license ?? null, runtime: model.runtime ?? null,
    installable: Boolean(model.installable && (installSpec?.downloadUrl || bundleSpec?.manifestUrl)),
    installSpec,
    ...(bundles ? { bundleSpec } : {}),
    unavailableReason, path: 'inhouse', paths: ['inhouse'],
  };
}
