GRANT SELECT ON TABLE
  public."SourceCategoryCrosswalkRevision", public."CanonicalCategoryRevision",
  public."EditorialReviewReceipt", public."ContentRightsReceipt",
  public."QuestionRevision", public."QuestionAnswerRevision", public."MediaRevision", public."QuestionRevisionMedia",
  public."QuestionRevisionSeal", public."CatalogRelease", public."CatalogReleaseSourceSnapshot",
  public."CatalogReleaseCategory", public."CatalogReleaseQuestion", public."CatalogReleaseAvailability",
  public."CatalogReleaseSeal", public."CatalogValidationReceipt"
TO catalog_validator;

GRANT EXECUTE ON FUNCTION
  public.int4_question_payload(TEXT), public.int4_question_child_manifest(TEXT,TEXT),
  public.int4_category_payload(TEXT), public.int4_release_payload(TEXT)
TO catalog_validator;
