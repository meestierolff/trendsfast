import {
  ContextProvenanceSchema,
  ProjectContextSchema,
  ProjectEntityTypeSchema,
  type ContextProvenance,
  type ProjectContext,
  type ProjectEntityType,
} from "@trendsfast/schemas";

const CANONICAL_CONTEXT_FIELDS = new Set([
  "name",
  "entity_type",
  "category",
  "audience",
  "problem",
  "desired_outcome",
  "language",
  "markets",
  "credible_topics",
  "suitable_channels",
  "available_formats",
]);

const CONFIRMED_CONTEXT_RATIONALE =
  "Founder-confirmed editable context; not an independently verified external fact.";
const CORRECTED_CONTEXT_RATIONALE =
  "Founder-confirmed correction to editable context; not an independently verified external fact.";

function canonicalContextEntries(
  context: ProjectContext,
  entityType: ProjectEntityType,
): Array<[string, string]> {
  const candidates: Array<[string, string]> = [
    ["name", context.name],
    ["entity_type", entityType],
    ["category", context.category],
    ["audience", context.audience],
    ["problem", context.problem],
    ["desired_outcome", context.desiredOutcome],
    ["language", context.language],
    ["markets", context.markets.join(", ")],
    ["credible_topics", context.credibleTopics.join(", ")],
    ["suitable_channels", context.suitableChannels.join(", ")],
    ["available_formats", context.availableFormats.join(", ")],
  ];
  return candidates.filter(([, value]) => value.trim().length > 0);
}

/**
 * Reconciles founder edits with the server-owned website provenance boundary.
 * Observations and collection metadata remain trusted server data; editable
 * context values receive one canonical inference entry each.
 */
export function reconcileMemberContextProvenance(input: {
  previousContext: ProjectContext;
  previousEntityType: ProjectEntityType;
  nextContext: ProjectContext;
  nextEntityType: ProjectEntityType;
  currentProvenance: ContextProvenance;
  requestedProvenance: ContextProvenance;
}): ContextProvenance {
  const previousContext = ProjectContextSchema.parse(input.previousContext);
  const previousEntityType = ProjectEntityTypeSchema.parse(input.previousEntityType);
  const nextContext = ProjectContextSchema.parse(input.nextContext);
  const nextEntityType = ProjectEntityTypeSchema.parse(input.nextEntityType);
  const currentProvenance = ContextProvenanceSchema.parse(input.currentProvenance);
  const requestedProvenance = ContextProvenanceSchema.parse(input.requestedProvenance);

  const previousValues = new Map(canonicalContextEntries(previousContext, previousEntityType));
  const requestedValues = new Map(
    requestedProvenance.inferred_context.map((entry) => [entry.field, entry]),
  );
  const currentValues = new Map(
    currentProvenance.inferred_context.map((entry) => [entry.field, entry]),
  );

  const canonicalInferences = canonicalContextEntries(nextContext, nextEntityType).map(
    ([field, value]) => {
      const changed = previousValues.get(field) !== value;
      const requested = requestedValues.get(field);
      const current = currentValues.get(field);
      const matchingRationale =
        requested?.value === value
          ? requested.rationale
          : current?.value === value
            ? current.rationale
            : undefined;
      return {
        field,
        value,
        rationale: changed
          ? CORRECTED_CONTEXT_RATIONALE
          : (matchingRationale ?? CONFIRMED_CONTEXT_RATIONALE),
      };
    },
  );
  const customInferences = requestedProvenance.inferred_context.filter(
    (entry) => !CANONICAL_CONTEXT_FIELDS.has(entry.field),
  );

  return ContextProvenanceSchema.parse({
    observed_facts: currentProvenance.observed_facts,
    inferred_context: [...canonicalInferences, ...customInferences],
    assumptions: nextContext.assumptions,
  });
}
