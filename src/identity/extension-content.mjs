// Revision metadata records where and from which checkout an extension bundle
// was built. It is provenance, not content identity: an identical canonical
// bundle can be inspected from a dirty checkout, a later commit, or
// package.json#gitHead without changing the code Chrome executes.
const EXTENSION_IDENTITY_CONTENT_FIELDS = Object.freeze([
  "schema",
  "product",
  "extension_version",
  "manifest_version",
  "source_digest",
  "protocol_revision",
]);

const EXTENSION_IDENTITY_PROVENANCE_FIELDS = Object.freeze([
  "build_revision",
  "build_revision_source",
  "build_inputs_dirty",
]);

function mismatchedFields(observed, expected, fields) {
  return fields.filter((field) => (
    !observed
    || !expected
    || !Object.hasOwn(observed, field)
    || !Object.hasOwn(expected, field)
    || observed[field] !== expected[field]
  ));
}

function compareExtensionIdentityContent(observed, expected) {
  const observedObject = observed && typeof observed === "object" ? observed : null;
  const expectedObject = expected && typeof expected === "object" ? expected : null;
  const mismatches = mismatchedFields(
    observedObject,
    expectedObject,
    EXTENSION_IDENTITY_CONTENT_FIELDS,
  );
  const contentMatch = Boolean(observedObject && expectedObject && mismatches.length === 0);
  const provenanceMismatches = mismatchedFields(
    observedObject,
    expectedObject,
    EXTENSION_IDENTITY_PROVENANCE_FIELDS,
  );
  const observedProvenance = String(observedObject?.build_revision_source ?? "");
  const expectedProvenance = String(expectedObject?.build_revision_source ?? "");
  const provenanceMatch = Boolean(
    contentMatch
    && provenanceMismatches.length === 0,
  );
  return {
    content_match: contentMatch,
    mismatches,
    provenance_mismatches: provenanceMismatches,
    provenance_match: provenanceMatch,
    provenance_variant: Boolean(contentMatch && !provenanceMatch),
    observed_provenance: observedProvenance || null,
    expected_provenance: expectedProvenance || null,
  };
}

export {
  EXTENSION_IDENTITY_CONTENT_FIELDS,
  EXTENSION_IDENTITY_PROVENANCE_FIELDS,
  compareExtensionIdentityContent,
};
