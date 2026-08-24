output "table_name" {
  value = module.table.table_name
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "api_endpoint" {
  value = module.api.api_endpoint
}

output "dispatch_queue_url" {
  value = module.dispatch_queue.queue_url
}

output "dispatch_queue_dlq_url" {
  value = module.dispatch_queue.dlq_url
}

output "lambda_function_names" {
  value = [
    module.test_ping_handler.function_name,
    module.items_handler.function_name,
    module.reminders_handler.function_name,
    module.reminder_producer.function_name,
    module.reminder_dispatch.function_name,
    module.reminder_reconciliation.function_name,
    module.dispatch_outbox_relay.function_name,
    module.outbox_sweeper.function_name,
    module.notification_router.function_name,
    module.notification_email_outbox_relay.function_name,
    module.email_delivery.function_name,
    module.ses_callback.function_name,
    module.notifications_handler.function_name,
    module.documents_handler.function_name,
    module.upload_finalizer_handler.function_name,
    module.malware_result_handler.function_name,
    module.upload_slot_reconciliation_handler.function_name,
    module.parser_sandbox.function_name,
    module.subjects_handler.function_name,
    module.guest_documents_handler.function_name,
    module.document_chasing_dispatch_handler.function_name,
    module.imports_handler.function_name,
    module.import_parse_handler.function_name,
    module.import_commit_handler.function_name,
    module.bff_handler.function_name,
  ]
}

# Rollback design entrega 1 (docs/architecture/reviews/rollback-mechanism-design/
# codex-round2-final-design.md): `cd.yml` reads this map to build the deploy manifest
# (function_name -> published version + live alias name) - not sensitive, no PII/secrets.
output "lambda_published_versions" {
  value = {
    (module.test_ping_handler.function_name)                  = module.test_ping_handler.published_version
    (module.items_handler.function_name)                      = module.items_handler.published_version
    (module.reminders_handler.function_name)                  = module.reminders_handler.published_version
    (module.reminder_producer.function_name)                  = module.reminder_producer.published_version
    (module.reminder_dispatch.function_name)                  = module.reminder_dispatch.published_version
    (module.reminder_reconciliation.function_name)            = module.reminder_reconciliation.published_version
    (module.dispatch_outbox_relay.function_name)              = module.dispatch_outbox_relay.published_version
    (module.outbox_sweeper.function_name)                     = module.outbox_sweeper.published_version
    (module.notification_router.function_name)                = module.notification_router.published_version
    (module.notification_email_outbox_relay.function_name)    = module.notification_email_outbox_relay.published_version
    (module.email_delivery.function_name)                     = module.email_delivery.published_version
    (module.ses_callback.function_name)                       = module.ses_callback.published_version
    (module.notifications_handler.function_name)              = module.notifications_handler.published_version
    (module.documents_handler.function_name)                  = module.documents_handler.published_version
    (module.upload_finalizer_handler.function_name)           = module.upload_finalizer_handler.published_version
    (module.malware_result_handler.function_name)             = module.malware_result_handler.published_version
    (module.upload_slot_reconciliation_handler.function_name) = module.upload_slot_reconciliation_handler.published_version
    (module.parser_sandbox.function_name)                     = module.parser_sandbox.published_version
    (module.subjects_handler.function_name)                   = module.subjects_handler.published_version
    (module.guest_documents_handler.function_name)            = module.guest_documents_handler.published_version
    (module.document_chasing_dispatch_handler.function_name)  = module.document_chasing_dispatch_handler.published_version
    (module.imports_handler.function_name)                    = module.imports_handler.published_version
    (module.import_parse_handler.function_name)               = module.import_parse_handler.published_version
    (module.import_commit_handler.function_name)              = module.import_commit_handler.published_version
    (module.bff_handler.function_name)                        = module.bff_handler.published_version
  }
}

output "bff_api_endpoint" {
  description = "The BFF's own dedicated HTTP API endpoint (D-053/D-054) - in production this sits behind CloudFront at the same origin as the SPA under the /bff/* path, never called directly by the browser."
  value       = module.bff_api.api_endpoint
}

output "bff_session_table_name" {
  value = module.bff_session_table.table_name
}

output "deploy_manifest_bucket_name" {
  value = module.deploy_manifests.bucket_name
}

output "document_quarantine_bucket_name" {
  value = module.document_buckets.quarantine_bucket_name
}

output "document_clean_bucket_name" {
  value = module.document_buckets.clean_bucket_name
}

output "malware_protection_enabled" {
  value = module.document_malware_protection.enabled
}

output "import_bucket_name" {
  value = module.import_bucket.bucket_name
}
