# GENERATED FILE — DO NOT EDIT BY HAND.
#
# Produced by `npm run generate:lambda-manifest` (scripts/generate-lambda-manifest.ts) from every
# `module "<name>" { source = "./modules/lambda-function" ... }` block across infra/*.tf. This is the
# single source of truth for which Lambdas the deploy manifest / emergency rollback mechanism
# (.github/workflows/cd.yml, .github/workflows/rollback.yml) cover — see decisions-log.md D-232
# (E-020) for the bug this closes: these two outputs used to be hand-maintained in outputs.tf and
# silently fell behind infra/main.tf.
#
# `npm run check:lambda-manifest` (CI-blocking, .github/workflows/ci.yml) fails the build the
# moment this file drifts from infra/*.tf — regenerate with `npm run generate:lambda-manifest`
# instead of editing this file.

output "lambda_function_names" {
  value = [
    module.test_ping_handler.function_name,
    module.items_handler.function_name,
    module.export_handler.function_name,
    module.reports_handler.function_name,
    module.bulk_actions_handler.function_name,
    module.subjects_handler.function_name,
    module.reminders_handler.function_name,
    module.notifications_handler.function_name,
    module.memberships_handler.function_name,
    module.reminder_producer.function_name,
    module.reminder_dispatch.function_name,
    module.reminder_reconciliation.function_name,
    module.dispatch_outbox_relay.function_name,
    module.outbox_sweeper.function_name,
    module.document_archive_handler.function_name,
    module.document_archive_guest_handler.function_name,
    module.external_share_handler.function_name,
    module.document_request_credential_issuance_handler.function_name,
    module.guest_credential_delivery_handler.function_name,
    module.bff_handler.function_name,
    module.reminder_materialization_trigger.function_name,
    module.notification_router.function_name,
    module.notification_email_outbox_relay.function_name,
    module.email_delivery.function_name,
    module.notification_whatsapp_outbox_relay.function_name,
    module.whatsapp_delivery.function_name,
    module.whatsapp_webhook_handler.function_name,
    module.ses_callback.function_name,
    module.parser_sandbox.function_name,
    module.documents_handler.function_name,
    module.guest_documents_handler.function_name,
    module.document_chasing_dispatch_handler.function_name,
    module.upload_finalizer_handler.function_name,
    module.malware_result_handler.function_name,
    module.upload_slot_reconciliation_handler.function_name,
    module.document_file_reconciliation_handler.function_name,
    module.document_purge_handler.function_name,
    module.import_parse_handler.function_name,
    module.requirement_evidence_refresh_handler.function_name,
    module.requirement_evidence_daily_sweep_handler.function_name,
    module.report_subscription_delivery_handler.function_name,
    module.dossier_export_generation_handler.function_name,
    module.import_commit_handler.function_name,
    module.imports_handler.function_name,
    module.extraction_starter_handler.function_name,
    module.textract_task_handler.function_name,
    module.pdf_parser_task_handler.function_name,
    module.bedrock_extraction_task_handler.function_name,
    module.extraction_validation_task_handler.function_name,
    module.tenant_purge_worker_handler.function_name,
    module.tenant_lifecycle_transition_handler.function_name,
    module.tenant_purge_sweeper_handler.function_name,
    module.requirement_reindex_handler.function_name,
    module.document_request_recurrence_handler.function_name,
    module.core_user_data_purge_handler.function_name,
    module.delivery_record_purge_handler.function_name,
    module.security_audit_purge_handler.function_name,
    module.quota_telemetry_purge_handler.function_name,
    module.invitation_purge_handler.function_name,
    module.transient_purge_handler.function_name,
    module.membership_purge_handler.function_name,
    module.scheduled_reports_scheduler_handler.function_name,
  ]
}

output "lambda_published_versions" {
  value = {
    (module.test_ping_handler.function_name)                            = module.test_ping_handler.published_version
    (module.items_handler.function_name)                                = module.items_handler.published_version
    (module.export_handler.function_name)                               = module.export_handler.published_version
    (module.reports_handler.function_name)                              = module.reports_handler.published_version
    (module.bulk_actions_handler.function_name)                         = module.bulk_actions_handler.published_version
    (module.subjects_handler.function_name)                             = module.subjects_handler.published_version
    (module.reminders_handler.function_name)                            = module.reminders_handler.published_version
    (module.notifications_handler.function_name)                        = module.notifications_handler.published_version
    (module.memberships_handler.function_name)                          = module.memberships_handler.published_version
    (module.reminder_producer.function_name)                            = module.reminder_producer.published_version
    (module.reminder_dispatch.function_name)                            = module.reminder_dispatch.published_version
    (module.reminder_reconciliation.function_name)                      = module.reminder_reconciliation.published_version
    (module.dispatch_outbox_relay.function_name)                        = module.dispatch_outbox_relay.published_version
    (module.outbox_sweeper.function_name)                               = module.outbox_sweeper.published_version
    (module.document_archive_handler.function_name)                     = module.document_archive_handler.published_version
    (module.document_archive_guest_handler.function_name)               = module.document_archive_guest_handler.published_version
    (module.external_share_handler.function_name)                       = module.external_share_handler.published_version
    (module.document_request_credential_issuance_handler.function_name) = module.document_request_credential_issuance_handler.published_version
    (module.guest_credential_delivery_handler.function_name)            = module.guest_credential_delivery_handler.published_version
    (module.bff_handler.function_name)                                  = module.bff_handler.published_version
    (module.reminder_materialization_trigger.function_name)             = module.reminder_materialization_trigger.published_version
    (module.notification_router.function_name)                          = module.notification_router.published_version
    (module.notification_email_outbox_relay.function_name)              = module.notification_email_outbox_relay.published_version
    (module.email_delivery.function_name)                               = module.email_delivery.published_version
    (module.notification_whatsapp_outbox_relay.function_name)           = module.notification_whatsapp_outbox_relay.published_version
    (module.whatsapp_delivery.function_name)                            = module.whatsapp_delivery.published_version
    (module.whatsapp_webhook_handler.function_name)                     = module.whatsapp_webhook_handler.published_version
    (module.ses_callback.function_name)                                 = module.ses_callback.published_version
    (module.parser_sandbox.function_name)                               = module.parser_sandbox.published_version
    (module.documents_handler.function_name)                            = module.documents_handler.published_version
    (module.guest_documents_handler.function_name)                      = module.guest_documents_handler.published_version
    (module.document_chasing_dispatch_handler.function_name)            = module.document_chasing_dispatch_handler.published_version
    (module.upload_finalizer_handler.function_name)                     = module.upload_finalizer_handler.published_version
    (module.malware_result_handler.function_name)                       = module.malware_result_handler.published_version
    (module.upload_slot_reconciliation_handler.function_name)           = module.upload_slot_reconciliation_handler.published_version
    (module.document_file_reconciliation_handler.function_name)         = module.document_file_reconciliation_handler.published_version
    (module.document_purge_handler.function_name)                       = module.document_purge_handler.published_version
    (module.import_parse_handler.function_name)                         = module.import_parse_handler.published_version
    (module.requirement_evidence_refresh_handler.function_name)         = module.requirement_evidence_refresh_handler.published_version
    (module.requirement_evidence_daily_sweep_handler.function_name)     = module.requirement_evidence_daily_sweep_handler.published_version
    (module.report_subscription_delivery_handler.function_name)         = module.report_subscription_delivery_handler.published_version
    (module.dossier_export_generation_handler.function_name)            = module.dossier_export_generation_handler.published_version
    (module.import_commit_handler.function_name)                        = module.import_commit_handler.published_version
    (module.imports_handler.function_name)                              = module.imports_handler.published_version
    (module.extraction_starter_handler.function_name)                   = module.extraction_starter_handler.published_version
    (module.textract_task_handler.function_name)                        = module.textract_task_handler.published_version
    (module.pdf_parser_task_handler.function_name)                      = module.pdf_parser_task_handler.published_version
    (module.bedrock_extraction_task_handler.function_name)              = module.bedrock_extraction_task_handler.published_version
    (module.extraction_validation_task_handler.function_name)           = module.extraction_validation_task_handler.published_version
    (module.tenant_purge_worker_handler.function_name)                  = module.tenant_purge_worker_handler.published_version
    (module.tenant_lifecycle_transition_handler.function_name)          = module.tenant_lifecycle_transition_handler.published_version
    (module.tenant_purge_sweeper_handler.function_name)                 = module.tenant_purge_sweeper_handler.published_version
    (module.requirement_reindex_handler.function_name)                  = module.requirement_reindex_handler.published_version
    (module.document_request_recurrence_handler.function_name)          = module.document_request_recurrence_handler.published_version
    (module.core_user_data_purge_handler.function_name)                 = module.core_user_data_purge_handler.published_version
    (module.delivery_record_purge_handler.function_name)                = module.delivery_record_purge_handler.published_version
    (module.security_audit_purge_handler.function_name)                 = module.security_audit_purge_handler.published_version
    (module.quota_telemetry_purge_handler.function_name)                = module.quota_telemetry_purge_handler.published_version
    (module.invitation_purge_handler.function_name)                     = module.invitation_purge_handler.published_version
    (module.transient_purge_handler.function_name)                      = module.transient_purge_handler.published_version
    (module.membership_purge_handler.function_name)                     = module.membership_purge_handler.published_version
    (module.scheduled_reports_scheduler_handler.function_name)          = module.scheduled_reports_scheduler_handler.published_version
  }
}
