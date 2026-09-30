import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acceptsBundles, serializeLocalModelCatalogModel, validBundleSpec } from '../src/server/utils/localModelCatalog.js';
const signUrl = key => `https://updates.example/${key}?grant=fixture`;
const digest = 'a'.repeat(64);
const bundle = () => ({ id:'speech', category:'audio', installable:true, bundleSpec:{ kind:'bundle-v1',bundleId:'chatterbox-v3',digest,minimumRuntime:'0.4.0',sizeBytes:100,platforms:['windows-x86_64'],manifestKey:`models/bundles/chatterbox-v3/${digest}/xrt.bundle.json` } });

test('legacy GGUF projection remains installable and unchanged in shape', () => {
 const model={id:'text',installable:true,installSpec:{source:'r2',artifactKey:'models/local-chat/text/model.gguf',sha256:digest,filename:'model.gguf'}};
 const legacy=serializeLocalModelCatalogModel(model,{signUrl});
 assert.equal(legacy.installable,true);assert.equal(legacy.installSpec.downloadUrl,signUrl(model.installSpec.artifactKey));
 assert.equal('bundleSpec' in legacy,false);
});
test('legacy clients never receive a bundle as a single-file installation', () => {
 const row=serializeLocalModelCatalogModel(bundle(),{signUrl});
 assert.equal(row.installable,false);assert.equal(row.installSpec,null);assert.equal('bundleSpec' in row,false);
 assert.match(row.unavailableReason,/Update the client/);
});
test('negotiated bundle carries exact content identity and no GGUF installSpec', () => {
 const row=serializeLocalModelCatalogModel(bundle(),{signUrl,bundles:true});
 assert.equal(row.installable,true);assert.equal(row.installSpec,null);assert.equal(row.bundleSpec.digest,digest);
 assert.equal(row.bundleSpec.manifestUrl,signUrl(bundle().bundleSpec.manifestKey));
});
test('unknown versions, path drift and invalid digests fail closed', () => {
 for(const patch of [{kind:'bundle-v2'},{digest:'bad'},{manifestKey:'models/other.json'},{sizeBytes:-1},{minimumRuntime:'latest'}]) {
  const model=bundle();Object.assign(model.bundleSpec,patch);
  assert.equal(validBundleSpec(model.bundleSpec),false);
  const row=serializeLocalModelCatalogModel(model,{signUrl,bundles:true});assert.equal(row.installable,false);assert.equal(row.bundleSpec,null);
 }
});
test('capability negotiation is explicit and route invokes projection with request header', () => {
 assert.equal(acceptsBundles(undefined),false);assert.equal(acceptsBundles('bundle-v10'),false);assert.equal(acceptsBundles('gguf,bundle-v1'),true);
 const source=readFileSync(new URL('../src/server/routes/aiRoutes.js',import.meta.url),'utf8');
 const start=source.indexOf("router.get('/local-model-catalog'");assert.ok(start>=0);
 const route=source.slice(start,source.indexOf('\n});',start));
 assert.match(route,/acceptsBundles\(req\.get\('X-Xrt-Catalog-Capabilities'\)\)/);
 assert.match(route,/serializeLocalModelCatalogModel\(model, \{ bundles, signUrl: generateSignedUrl \}\)/);
});
