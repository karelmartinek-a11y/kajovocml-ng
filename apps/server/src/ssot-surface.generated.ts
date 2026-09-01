/* AUTO-GENERATED mechanical SSOT surface. It is not implementation or conformance evidence. DO NOT EDIT. */
export const SSOT_SURFACE_FINGERPRINT = "d1e1020ff347a9aea8bcf21f4443759b2ae165757b7a53112a2d9f6e0c9c4eb7" as const;
export const SSOT_ENTITY_NAMES = [
  "owner_identity",
  "owner_session",
  "owner_login_throttle",
  "owner_recovery_code",
  "owner_mfa_enrollment",
  "owner_api_credential",
  "component",
  "component_revision",
  "component_tool_contract",
  "component_resource_contract",
  "component_prompt_contract",
  "component_endpoint_contract",
  "component_pulse_contract",
  "component_state_contract",
  "component_state_transition",
  "component_runtime_target",
  "component_contract_binding",
  "component_release",
  "component_readiness_gate",
  "component_e2e_run",
  "mcp_server_revision_profile",
  "mcp_registration_probe",
  "mcp_discovery_snapshot",
  "mcp_discovery_item",
  "mcp_tool_alias",
  "mcp_request_event",
  "mcp_call_run",
  "mcp_call_progress",
  "mcp_input_exchange",
  "mcp_input_request_item",
  "mcp_input_response_item",
  "mcp_subscription",
  "mcp_subscription_notification",
  "mcp_state_handle",
  "mcp_task",
  "mcp_task_input_request",
  "mcp_task_input_response",
  "mcp_task_event",
  "mcp_idempotency_record",
  "runtime_execution_context",
  "runtime_instance",
  "runtime_process_identity",
  "runtime_ipc_connection",
  "runtime_ipc_call",
  "runtime_credential_generation",
  "runtime_cleanup_operation",
  "external_auth_binding",
  "secret_record",
  "secret_version",
  "secret_binding",
  "secret_resolution",
  "secret_access_event",
  "external_target",
  "external_target_binding",
  "external_request_event",
  "webhook_endpoint",
  "dashboard_workspace",
  "dashboard_node_position",
  "dashboard_connection",
  "dashboard_runtime_event",
  "monitoring_profile",
  "monitoring_probe",
  "component_state_history",
  "operational_alert",
  "alert_delivery",
  "monitoring_scheduler_heartbeat",
  "platform_worker_heartbeat",
  "audit_event",
  "audit_head",
  "audit_archive_outbox",
  "component_audit_stream",
  "component_audit_event",
  "debug_log_event",
  "generation_job",
  "generation_source",
  "generation_fact",
  "generation_owner_decision",
  "generation_message",
  "generation_turn",
  "generation_spec_revision",
  "generation_execution_authority",
  "generation_capability_snapshot",
  "generation_capability_match",
  "generation_plan",
  "generation_plan_node",
  "generation_plan_edge",
  "generation_phase_run",
  "generation_checkpoint",
  "generation_tool_event",
  "generation_workspace_revision",
  "generation_workspace_file",
  "generation_workspace_patch",
  "generation_artifact_manifest",
  "generation_artifact",
  "generation_contract_candidate",
  "generation_validation_run",
  "generation_validation_result",
  "generation_repair_iteration",
  "generation_blocker",
  "generation_activation_set",
  "generation_activation_member",
  "generation_event",
  "openai_model_capability_snapshot",
  "openai_request_descriptor",
  "ai_model_call",
  "ai_model_event",
  "ai_model_output_item",
  "ai_model_output_content_part",
  "ai_tool_dispatch",
  "ai_model_continuation",
  "ai_run_state_checkpoint",
  "agent_session_compaction",
  "agent_definition",
  "agent_revision",
  "agent_tool_binding",
  "agent_handoff_binding",
  "agent_guardrail",
  "agent_session",
  "agent_session_item",
  "agent_run",
  "agent_run_checkpoint",
  "agent_message",
  "agent_tool_call",
  "agent_handoff_run",
  "agent_approval_request",
  "agent_memory_namespace",
  "agent_memory_item",
  "agent_trigger",
  "agent_eval_suite",
  "agent_eval_case",
  "agent_eval_run",
  "agent_eval_case_result",
  "system_chat_conversation",
  "system_chat_message",
  "system_chat_action",
  "browser_runtime_build_manifest",
  "browser_session",
  "browser_session_binding",
  "browser_host_slot",
  "browser_context_instance",
  "browser_page",
  "browser_frame",
  "browser_document",
  "browser_navigation",
  "browser_observation",
  "browser_preview_frame",
  "browser_preview_ticket",
  "browser_preview_event",
  "browser_control_lease",
  "browser_control_transfer",
  "browser_input_event",
  "browser_target_reference",
  "browser_action_run",
  "browser_action_attempt",
  "browser_action_dispatch_event",
  "browser_operation_scope",
  "browser_irreversible_confirmation",
  "browser_account_binding",
  "browser_auth_attempt",
  "browser_state_bundle",
  "browser_state_bundle_member",
  "browser_local_bridge",
  "browser_bridge_connection",
  "browser_bridge_assignment",
  "browser_profile_lease",
  "browser_dialog",
  "browser_permission_request",
  "browser_upload_handle",
  "browser_download",
  "browser_teaching_run",
  "browser_teaching_step",
  "browser_automation_definition",
  "browser_automation_revision",
  "browser_automation_run",
  "browser_automation_run_step",
  "browser_automation_artifact",
  "browser_auth_binding",
  "browser_challenge",
  "self_test_run",
  "self_test_case_result",
  "self_test_catalog_entry",
  "application_release",
  "deployment_run",
  "deployment_step",
  "backup_record",
  "production_acceptance_run",
  "operational_setting",
  "operational_setting_applied",
  "platform_incarnation",
  "domain_command",
  "domain_idempotency_record",
  "side_effect_operation",
  "side_effect_attempt",
  "side_effect_attempt_state",
  "side_effect_attempt_evidence",
  "transactional_outbox",
  "transactional_inbox",
  "queue_item",
  "concurrency_claim",
  "binding_set",
  "binding_set_revision",
  "binding_set_member",
  "activation_domain_head",
  "domain_command_activation_domain",
  "activation_head",
  "application_deployment_head",
  "activation_domain_barrier",
  "cleanup_operation",
  "cleanup_resource",
  "configuration_apply_run",
  "schema_migration",
  "authority_lineage",
  "operation_intent",
  "content_provenance",
  "instruction_segment",
  "operation_context",
  "semantic_action_plan",
  "value_derivation",
  "secret_use_context",
  "agentic_security_event"
] as const;
export const SSOT_ROUTES = [
  {
    "method": "GET",
    "path": "/operations/catalog",
    "routeKey": "GET /operations/catalog",
    "entity": "operation_context",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/operations/:operationKey/invoke",
    "routeKey": "POST /operations/:operationKey/invoke",
    "entity": "operation_context",
    "operation": "__DYNAMIC_OPERATION__",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/auth/login",
    "routeKey": "POST /auth/login",
    "entity": "owner_login_throttle",
    "operation": null,
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/auth/login/mfa",
    "routeKey": "POST /auth/login/mfa",
    "entity": "owner_login_throttle",
    "operation": null,
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/auth/logout",
    "routeKey": "POST /auth/logout",
    "entity": "owner_session",
    "operation": null,
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/auth/api-key-session",
    "routeKey": "POST /auth/api-key-session",
    "entity": "owner_session",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/session",
    "routeKey": "GET /session",
    "entity": "owner_session",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/session/reauthenticate",
    "routeKey": "POST /session/reauthenticate",
    "entity": "owner_session",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/owner/security",
    "routeKey": "GET /owner/security",
    "entity": "owner_identity",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/owner/mfa/enroll",
    "routeKey": "POST /owner/mfa/enroll",
    "entity": "owner_mfa_enrollment",
    "operation": null,
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/owner/mfa/verify",
    "routeKey": "POST /owner/mfa/verify",
    "entity": "owner_mfa_enrollment",
    "operation": null,
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/owner/recovery-codes/rotate",
    "routeKey": "POST /owner/recovery-codes/rotate",
    "entity": "owner_recovery_code",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/owner/sessions",
    "routeKey": "GET /owner/sessions",
    "entity": "owner_session",
    "operation": null,
    "mutating": false
  },
  {
    "method": "DELETE",
    "path": "/owner/sessions/:id",
    "routeKey": "DELETE /owner/sessions/:id",
    "entity": "owner_session",
    "operation": null,
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/owner/sessions/revoke-others",
    "routeKey": "POST /owner/sessions/revoke-others",
    "entity": "owner_session",
    "operation": null,
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/owner/sessions/revoke-all",
    "routeKey": "POST /owner/sessions/revoke-all",
    "entity": "owner_session",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/owner/api-key",
    "routeKey": "GET /owner/api-key",
    "entity": "owner_api_credential",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/owner/api-key/value",
    "routeKey": "GET /owner/api-key/value",
    "entity": "owner_api_credential",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/owner/api-key/rotate",
    "routeKey": "POST /owner/api-key/rotate",
    "entity": "owner_api_credential",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/owner/api-key/usage",
    "routeKey": "GET /owner/api-key/usage",
    "entity": "owner_api_credential",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/dashboard/topology",
    "routeKey": "GET /dashboard/topology",
    "entity": "dashboard_workspace",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PUT",
    "path": "/dashboard/layout",
    "routeKey": "PUT /dashboard/layout",
    "entity": "dashboard_node_position",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/dashboard/events",
    "routeKey": "GET /dashboard/events",
    "entity": "dashboard_runtime_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/dashboard/identity-cards",
    "routeKey": "GET /dashboard/identity-cards",
    "entity": "dashboard_workspace",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/dashboard/connections/preview",
    "routeKey": "POST /dashboard/connections/preview",
    "entity": "dashboard_connection",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/dashboard/connections",
    "routeKey": "POST /dashboard/connections",
    "entity": "dashboard_connection",
    "operation": "component.register",
    "mutating": true
  },
  {
    "method": "PUT",
    "path": "/dashboard/connections/:id/binding",
    "routeKey": "PUT /dashboard/connections/:id/binding",
    "entity": "dashboard_connection",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "DELETE",
    "path": "/dashboard/connections/:id",
    "routeKey": "DELETE /dashboard/connections/:id",
    "entity": "dashboard_connection",
    "operation": "component.deregister",
    "mutating": true
  },
  {
    "method": "PUT",
    "path": "/dashboard/nodes/:id/suspension",
    "routeKey": "PUT /dashboard/nodes/:id/suspension",
    "entity": "component",
    "operation": "component.suspend",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/dashboard/nodes/:id/deregistration-preview",
    "routeKey": "GET /dashboard/nodes/:id/deregistration-preview",
    "entity": "component",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/dashboard/nodes/:id/deregister",
    "routeKey": "POST /dashboard/nodes/:id/deregister",
    "entity": "component",
    "operation": "component.deregister",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/dashboard/secrets/:secretId/bindings",
    "routeKey": "POST /dashboard/secrets/:secretId/bindings",
    "entity": "secret_binding",
    "operation": "secret.bind",
    "mutating": true
  },
  {
    "method": "DELETE",
    "path": "/dashboard/secrets/:secretId/bindings/:nodeId",
    "routeKey": "DELETE /dashboard/secrets/:secretId/bindings/:nodeId",
    "entity": "secret_binding",
    "operation": "secret.unbind",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/dashboard/secrets/:secretId/bindings/bulk-preview",
    "routeKey": "GET /dashboard/secrets/:secretId/bindings/bulk-preview",
    "entity": "secret_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/dashboard/secrets/:secretId/bindings/bulk",
    "routeKey": "POST /dashboard/secrets/:secretId/bindings/bulk",
    "entity": "secret_binding",
    "operation": "secret.bind",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/components",
    "routeKey": "GET /components",
    "entity": "component",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/components",
    "routeKey": "POST /components",
    "entity": "component",
    "operation": "component.register",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/components/:id",
    "routeKey": "GET /components/:id",
    "entity": "component",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PATCH",
    "path": "/components/:id",
    "routeKey": "PATCH /components/:id",
    "entity": "component",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/components/:id/revisions",
    "routeKey": "GET /components/:id/revisions",
    "entity": "component_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/components/:id/revisions",
    "routeKey": "POST /components/:id/revisions",
    "entity": "component_revision",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/components/:id/releases",
    "routeKey": "GET /components/:id/releases",
    "entity": "component_release",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/components/:id/validate",
    "routeKey": "POST /components/:id/validate",
    "entity": "component",
    "operation": "component.validate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/verify",
    "routeKey": "POST /components/:id/verify",
    "entity": "component",
    "operation": "component.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/activate",
    "routeKey": "POST /components/:id/activate",
    "entity": "component",
    "operation": "component.activate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/enable",
    "routeKey": "POST /components/:id/enable",
    "entity": "component",
    "operation": "component.enable",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/disable",
    "routeKey": "POST /components/:id/disable",
    "entity": "component",
    "operation": "component.disable",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/suspend",
    "routeKey": "POST /components/:id/suspend",
    "entity": "component",
    "operation": "component.suspend",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/quarantine",
    "routeKey": "POST /components/:id/quarantine",
    "entity": "component",
    "operation": "component.quarantine",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/restore",
    "routeKey": "POST /components/:id/restore",
    "entity": "component",
    "operation": "component.restore",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/rollback",
    "routeKey": "POST /components/:id/rollback",
    "entity": "component",
    "operation": "component.rollback",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/repair",
    "routeKey": "POST /components/:id/repair",
    "entity": "component",
    "operation": "component.restore",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/recertify",
    "routeKey": "POST /components/:id/recertify",
    "entity": "component",
    "operation": "component.recertify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/e2e-runs",
    "routeKey": "POST /components/:id/e2e-runs",
    "entity": "component_e2e_run",
    "operation": "component.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/state-queries",
    "routeKey": "POST /components/:id/state-queries",
    "entity": "component_state_history",
    "operation": "component.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/components/:id/heartbeat-challenges",
    "routeKey": "POST /components/:id/heartbeat-challenges",
    "entity": "component_pulse_contract",
    "operation": "component.verify",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/components/:id/logs",
    "routeKey": "GET /components/:id/logs",
    "entity": "debug_log_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/components/:id/audit",
    "routeKey": "GET /components/:id/audit",
    "entity": "component_audit_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/components/:id/bindings",
    "routeKey": "GET /components/:id/bindings",
    "entity": "component_contract_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/components/:id/secrets",
    "routeKey": "GET /components/:id/secrets",
    "entity": "secret_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/components/:id/usage",
    "routeKey": "GET /components/:id/usage",
    "entity": "component",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-servers",
    "routeKey": "GET /mcp-servers",
    "entity": "mcp_server_revision_profile",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-servers",
    "routeKey": "POST /mcp-servers",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.contract.compatibility",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-servers/:id",
    "routeKey": "GET /mcp-servers/:id",
    "entity": "mcp_server_revision_profile",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PATCH",
    "path": "/mcp-servers/:id",
    "routeKey": "PATCH /mcp-servers/:id",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.contract.compatibility",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-servers/:id/revisions",
    "routeKey": "GET /mcp-servers/:id/revisions",
    "entity": "mcp_server_revision_profile",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/revisions",
    "routeKey": "POST /mcp-servers/:id/revisions",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.contract.compatibility",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-servers/:id/revisions/:revisionId",
    "routeKey": "GET /mcp-servers/:id/revisions/:revisionId",
    "entity": "mcp_server_revision_profile",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/revisions/:revisionId/validate",
    "routeKey": "POST /mcp-servers/:id/revisions/:revisionId/validate",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.contract.validate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/revisions/:revisionId/verify",
    "routeKey": "POST /mcp-servers/:id/revisions/:revisionId/verify",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.wire.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/revisions/:revisionId/activate",
    "routeKey": "POST /mcp-servers/:id/revisions/:revisionId/activate",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.contract.compatibility",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/revisions/:revisionId/compatibility",
    "routeKey": "POST /mcp-servers/:id/revisions/:revisionId/compatibility",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.contract.compatibility",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-servers/:id/discovery-snapshots",
    "routeKey": "GET /mcp-servers/:id/discovery-snapshots",
    "entity": "mcp_discovery_snapshot",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/discovery-snapshots",
    "routeKey": "POST /mcp-servers/:id/discovery-snapshots",
    "entity": "mcp_discovery_snapshot",
    "operation": "mcp.discovery.snapshot",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-servers/:id/discovery-snapshots/:snapshotId",
    "routeKey": "GET /mcp-servers/:id/discovery-snapshots/:snapshotId",
    "entity": "mcp_discovery_snapshot",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-servers/:id/discovery-snapshots/:snapshotId/diff",
    "routeKey": "GET /mcp-servers/:id/discovery-snapshots/:snapshotId/diff",
    "entity": "mcp_discovery_snapshot",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-servers/:id/registration-probes",
    "routeKey": "GET /mcp-servers/:id/registration-probes",
    "entity": "mcp_registration_probe",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/era-probe",
    "routeKey": "POST /mcp-servers/:id/era-probe",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.era.probe",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/server-discover-test",
    "routeKey": "POST /mcp-servers/:id/server-discover-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.server.discover",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/request-metadata-test",
    "routeKey": "POST /mcp-servers/:id/request-metadata-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.contract.validate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/streamable-http-test",
    "routeKey": "POST /mcp-servers/:id/streamable-http-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.contract.validate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/cache-pagination-test",
    "routeKey": "POST /mcp-servers/:id/cache-pagination-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.cache.invalidate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/mrtr-test",
    "routeKey": "POST /mcp-servers/:id/mrtr-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.tools.reconcile",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/tasks-test",
    "routeKey": "POST /mcp-servers/:id/tasks-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.task.update",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/wire-edge-matrix",
    "routeKey": "POST /mcp-servers/:id/wire-edge-matrix",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.wire.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/tools/list-test",
    "routeKey": "POST /mcp-servers/:id/tools/list-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.tools.list",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/resources/list-test",
    "routeKey": "POST /mcp-servers/:id/resources/list-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.resources.list",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/resources/templates/list-test",
    "routeKey": "POST /mcp-servers/:id/resources/templates/list-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.resources.templates.list",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/prompts/list-test",
    "routeKey": "POST /mcp-servers/:id/prompts/list-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.prompts.list",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/tools/:toolName/call-test",
    "routeKey": "POST /mcp-servers/:id/tools/:toolName/call-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.tools.call",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-servers/:id/subscriptions/list-test",
    "routeKey": "POST /mcp-servers/:id/subscriptions/list-test",
    "entity": "mcp_server_revision_profile",
    "operation": "mcp.subscription.listen",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-request-events",
    "routeKey": "GET /mcp-request-events",
    "entity": "mcp_request_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-request-events/:requestEventId",
    "routeKey": "GET /mcp-request-events/:requestEventId",
    "entity": "mcp_request_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-request-events/:requestEventId/raw",
    "routeKey": "GET /mcp-request-events/:requestEventId/raw",
    "entity": "mcp_request_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-call-runs",
    "routeKey": "GET /mcp-call-runs",
    "entity": "mcp_call_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-call-runs/:callId",
    "routeKey": "GET /mcp-call-runs/:callId",
    "entity": "mcp_call_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-call-runs/:callId/events",
    "routeKey": "GET /mcp-call-runs/:callId/events",
    "entity": "mcp_call_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-call-runs/:callId/outcome",
    "routeKey": "GET /mcp-call-runs/:callId/outcome",
    "entity": "mcp_call_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-call-runs/:callId/cancel",
    "routeKey": "POST /mcp-call-runs/:callId/cancel",
    "entity": "mcp_call_run",
    "operation": "mcp.tools.cancel",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-call-runs/:callId/reconcile",
    "routeKey": "POST /mcp-call-runs/:callId/reconcile",
    "entity": "mcp_call_run",
    "operation": "mcp.tools.reconcile",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-call-runs/:callId/input-exchanges",
    "routeKey": "GET /mcp-call-runs/:callId/input-exchanges",
    "entity": "mcp_input_exchange",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-input-exchanges/:exchangeId",
    "routeKey": "GET /mcp-input-exchanges/:exchangeId",
    "entity": "mcp_input_exchange",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-input-exchanges/:exchangeId/respond",
    "routeKey": "POST /mcp-input-exchanges/:exchangeId/respond",
    "entity": "mcp_input_exchange",
    "operation": "mcp.input.respond",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-subscriptions",
    "routeKey": "GET /mcp-subscriptions",
    "entity": "mcp_subscription",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-subscriptions/:subscriptionId",
    "routeKey": "GET /mcp-subscriptions/:subscriptionId",
    "entity": "mcp_subscription",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-subscriptions/:subscriptionId/cancel",
    "routeKey": "POST /mcp-subscriptions/:subscriptionId/cancel",
    "entity": "mcp_subscription",
    "operation": "mcp.subscription.cancel",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-subscriptions/:subscriptionId/notifications",
    "routeKey": "GET /mcp-subscriptions/:subscriptionId/notifications",
    "entity": "mcp_subscription_notification",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-state-handles",
    "routeKey": "GET /mcp-state-handles",
    "entity": "mcp_state_handle",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-state-handles/:handleId",
    "routeKey": "GET /mcp-state-handles/:handleId",
    "entity": "mcp_state_handle",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-state-handles/:handleId/close",
    "routeKey": "POST /mcp-state-handles/:handleId/close",
    "entity": "mcp_state_handle",
    "operation": "mcp.stateHandle.close",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-tasks",
    "routeKey": "GET /mcp-tasks",
    "entity": "mcp_task",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-tasks/:taskId",
    "routeKey": "GET /mcp-tasks/:taskId",
    "entity": "mcp_task",
    "operation": "mcp.task.get",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-tasks/:taskId/update",
    "routeKey": "POST /mcp-tasks/:taskId/update",
    "entity": "mcp_task",
    "operation": "mcp.task.update",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-tasks/:taskId/cancel",
    "routeKey": "POST /mcp-tasks/:taskId/cancel",
    "entity": "mcp_task",
    "operation": "mcp.task.cancel",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-tasks/:taskId/events",
    "routeKey": "GET /mcp-tasks/:taskId/events",
    "entity": "mcp_task_event",
    "operation": "mcp.task.get",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-tools",
    "routeKey": "GET /mcp-tools",
    "entity": "component_tool_contract",
    "operation": "mcp.tools.list",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-tools",
    "routeKey": "POST /mcp-tools",
    "entity": "component_tool_contract",
    "operation": "mcp.contract.compatibility",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/mcp-tools/:id",
    "routeKey": "GET /mcp-tools/:id",
    "entity": "component_tool_contract",
    "operation": "mcp.tools.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-tools/:id/revisions",
    "routeKey": "GET /mcp-tools/:id/revisions",
    "entity": "component_tool_contract",
    "operation": "mcp.tools.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-tools/:id/callers",
    "routeKey": "GET /mcp-tools/:id/callers",
    "entity": "component_tool_contract",
    "operation": "mcp.tools.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-tools/:id/usage",
    "routeKey": "GET /mcp-tools/:id/usage",
    "entity": "component_tool_contract",
    "operation": "mcp.tools.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-resources",
    "routeKey": "GET /mcp-resources",
    "entity": "component_resource_contract",
    "operation": "mcp.resources.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-resources/:id",
    "routeKey": "GET /mcp-resources/:id",
    "entity": "component_resource_contract",
    "operation": "mcp.resources.read",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-resource-templates",
    "routeKey": "GET /mcp-resource-templates",
    "entity": "component_resource_contract",
    "operation": "mcp.resources.templates.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-resource-templates/:id",
    "routeKey": "GET /mcp-resource-templates/:id",
    "entity": "component_resource_contract",
    "operation": "mcp.resources.templates.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-prompts",
    "routeKey": "GET /mcp-prompts",
    "entity": "component_prompt_contract",
    "operation": "mcp.prompts.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-prompts/:id",
    "routeKey": "GET /mcp-prompts/:id",
    "entity": "component_prompt_contract",
    "operation": "mcp.prompts.get",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/mcp-aliases",
    "routeKey": "GET /mcp-aliases",
    "entity": "mcp_tool_alias",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/mcp-aliases/preview",
    "routeKey": "POST /mcp-aliases/preview",
    "entity": "mcp_tool_alias",
    "operation": "mcp.contract.compatibility",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/mcp-aliases",
    "routeKey": "POST /mcp-aliases",
    "entity": "mcp_tool_alias",
    "operation": "mcp.contract.compatibility",
    "mutating": true
  },
  {
    "method": "DELETE",
    "path": "/mcp-aliases/:id",
    "routeKey": "DELETE /mcp-aliases/:id",
    "entity": "mcp_tool_alias",
    "operation": "mcp.discovery.invalidate",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents",
    "routeKey": "GET /agents",
    "entity": "agent_definition",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agents",
    "routeKey": "POST /agents",
    "entity": "agent_definition",
    "operation": "agent.eval.start",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents/:id",
    "routeKey": "GET /agents/:id",
    "entity": "agent_definition",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PATCH",
    "path": "/agents/:id",
    "routeKey": "PATCH /agents/:id",
    "entity": "agent_definition",
    "operation": "agent.eval.result",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents/:id/revisions",
    "routeKey": "GET /agents/:id/revisions",
    "entity": "agent_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agents/:id/revisions",
    "routeKey": "POST /agents/:id/revisions",
    "entity": "agent_revision",
    "operation": "agent.eval.start",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents/:id/revisions/:revisionId",
    "routeKey": "GET /agents/:id/revisions/:revisionId",
    "entity": "agent_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agents/:id/revisions/:revisionId/validate",
    "routeKey": "POST /agents/:id/revisions/:revisionId/validate",
    "entity": "agent_revision",
    "operation": "agent.eval.result",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agents/:id/revisions/:revisionId/verify",
    "routeKey": "POST /agents/:id/revisions/:revisionId/verify",
    "entity": "agent_revision",
    "operation": "agent.eval.result",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agents/:id/revisions/:revisionId/activate",
    "routeKey": "POST /agents/:id/revisions/:revisionId/activate",
    "entity": "agent_revision",
    "operation": "agent.eval.result",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agents/:id/revisions/:revisionId/compatibility",
    "routeKey": "POST /agents/:id/revisions/:revisionId/compatibility",
    "entity": "agent_revision",
    "operation": "agent.eval.result",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents/:id/revisions/:revisionId/tool-bindings",
    "routeKey": "GET /agents/:id/revisions/:revisionId/tool-bindings",
    "entity": "agent_tool_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agents/:id/revisions/:revisionId/tool-bindings/preview",
    "routeKey": "POST /agents/:id/revisions/:revisionId/tool-bindings/preview",
    "entity": "agent_tool_binding",
    "operation": "agent.tool.request",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents/:id/revisions/:revisionId/handoffs",
    "routeKey": "GET /agents/:id/revisions/:revisionId/handoffs",
    "entity": "agent_handoff_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agents/:id/revisions/:revisionId/guardrails",
    "routeKey": "GET /agents/:id/revisions/:revisionId/guardrails",
    "entity": "agent_guardrail",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agents/:id/revisions/:revisionId/promotion-gates",
    "routeKey": "GET /agents/:id/revisions/:revisionId/promotion-gates",
    "entity": "agent_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agents/:id/enable",
    "routeKey": "POST /agents/:id/enable",
    "entity": "agent_definition",
    "operation": "agent.run.start",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agents/:id/disable",
    "routeKey": "POST /agents/:id/disable",
    "entity": "agent_definition",
    "operation": "agent.run.cancel",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agents/:id/repair",
    "routeKey": "POST /agents/:id/repair",
    "entity": "agent_definition",
    "operation": "agent.run.manualReview",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agents/:id/runs",
    "routeKey": "POST /agents/:id/runs",
    "entity": "agent_run",
    "operation": "agent.run.start",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents/:id/runs",
    "routeKey": "GET /agents/:id/runs",
    "entity": "agent_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agent-runs/:runId",
    "routeKey": "GET /agent-runs/:runId",
    "entity": "agent_run",
    "operation": "agent.run.status",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agent-runs/:runId/events",
    "routeKey": "GET /agent-runs/:runId/events",
    "entity": "agent_message",
    "operation": "agent.run.status",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agent-runs/:runId/checkpoints",
    "routeKey": "GET /agent-runs/:runId/checkpoints",
    "entity": "agent_run_checkpoint",
    "operation": "agent.run.status",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agent-runs/:runId/messages",
    "routeKey": "POST /agent-runs/:runId/messages",
    "entity": "agent_message",
    "operation": "agent.message.append",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agent-runs/:runId/pause",
    "routeKey": "POST /agent-runs/:runId/pause",
    "entity": "agent_run",
    "operation": "agent.run.pause",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agent-runs/:runId/resume",
    "routeKey": "POST /agent-runs/:runId/resume",
    "entity": "agent_run",
    "operation": "agent.run.resume",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agent-runs/:runId/cancel",
    "routeKey": "POST /agent-runs/:runId/cancel",
    "entity": "agent_run",
    "operation": "agent.run.cancel",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agent-runs/:runId/tool-calls",
    "routeKey": "GET /agent-runs/:runId/tool-calls",
    "entity": "agent_tool_call",
    "operation": "agent.run.status",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agent-runs/:runId/handoffs",
    "routeKey": "GET /agent-runs/:runId/handoffs",
    "entity": "agent_handoff_run",
    "operation": "agent.run.status",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agent-runs/:runId/approvals",
    "routeKey": "GET /agent-runs/:runId/approvals",
    "entity": "agent_approval_request",
    "operation": "agent.run.status",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agent-runs/:runId/approvals/:approvalId/approve",
    "routeKey": "POST /agent-runs/:runId/approvals/:approvalId/approve",
    "entity": "agent_approval_request",
    "operation": "agent.approval.approve",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agent-runs/:runId/approvals/:approvalId/reject",
    "routeKey": "POST /agent-runs/:runId/approvals/:approvalId/reject",
    "entity": "agent_approval_request",
    "operation": "agent.approval.reject",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents/:id/sessions",
    "routeKey": "GET /agents/:id/sessions",
    "entity": "agent_session",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agent-sessions/:sessionId",
    "routeKey": "GET /agent-sessions/:sessionId",
    "entity": "agent_session",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agent-sessions/:sessionId/items",
    "routeKey": "GET /agent-sessions/:sessionId/items",
    "entity": "agent_session_item",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agent-sessions/:sessionId/compact",
    "routeKey": "POST /agent-sessions/:sessionId/compact",
    "entity": "agent_session",
    "operation": "agent.session.compact",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agent-sessions/:sessionId/close",
    "routeKey": "POST /agent-sessions/:sessionId/close",
    "entity": "agent_session",
    "operation": "agent.session.compact",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents/:id/memory",
    "routeKey": "GET /agents/:id/memory",
    "entity": "agent_memory_namespace",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agents/:id/memory/search",
    "routeKey": "POST /agents/:id/memory/search",
    "entity": "agent_memory_namespace",
    "operation": "agent.memory.read",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agents/:id/memory/items",
    "routeKey": "POST /agents/:id/memory/items",
    "entity": "agent_memory_item",
    "operation": "agent.memory.write",
    "mutating": true
  },
  {
    "method": "DELETE",
    "path": "/agents/:id/memory/items/:itemId",
    "routeKey": "DELETE /agents/:id/memory/items/:itemId",
    "entity": "agent_memory_item",
    "operation": "agent.memory.write",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agents/:id/eval-suites",
    "routeKey": "GET /agents/:id/eval-suites",
    "entity": "agent_eval_suite",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agents/:id/eval-suites",
    "routeKey": "POST /agents/:id/eval-suites",
    "entity": "agent_eval_suite",
    "operation": "agent.eval.start",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agent-eval-suites/:suiteId",
    "routeKey": "GET /agent-eval-suites/:suiteId",
    "entity": "agent_eval_suite",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agent-eval-suites/:suiteId/runs",
    "routeKey": "POST /agent-eval-suites/:suiteId/runs",
    "entity": "agent_eval_suite",
    "operation": "agent.eval.start",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/agent-eval-runs/:runId",
    "routeKey": "GET /agent-eval-runs/:runId",
    "entity": "agent_eval_run",
    "operation": "agent.run.status",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agent-eval-runs/:runId/cases",
    "routeKey": "GET /agent-eval-runs/:runId/cases",
    "entity": "agent_eval_case_result",
    "operation": "agent.run.status",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agents/:id/triggers",
    "routeKey": "GET /agents/:id/triggers",
    "entity": "agent_trigger",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agents/:id/triggers",
    "routeKey": "POST /agents/:id/triggers",
    "entity": "agent_trigger",
    "operation": "agent.delegate.request",
    "mutating": true
  },
  {
    "method": "PATCH",
    "path": "/agents/:id/triggers/:triggerId",
    "routeKey": "PATCH /agents/:id/triggers/:triggerId",
    "entity": "agent_trigger",
    "operation": "agent.delegate.request",
    "mutating": true
  },
  {
    "method": "DELETE",
    "path": "/agents/:id/triggers/:triggerId",
    "routeKey": "DELETE /agents/:id/triggers/:triggerId",
    "entity": "agent_trigger",
    "operation": "agent.delegate.request",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/chat/conversations",
    "routeKey": "GET /chat/conversations",
    "entity": "system_chat_conversation",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/chat/conversations",
    "routeKey": "POST /chat/conversations",
    "entity": "system_chat_conversation",
    "operation": "chat.conversation.create",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/chat/conversations/:id",
    "routeKey": "GET /chat/conversations/:id",
    "entity": "system_chat_conversation",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/chat/conversations/:id/messages",
    "routeKey": "GET /chat/conversations/:id/messages",
    "entity": "system_chat_message",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/chat/conversations/:id/messages",
    "routeKey": "POST /chat/conversations/:id/messages",
    "entity": "system_chat_message",
    "operation": "chat.message.append",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/chat/conversations/:id/events",
    "routeKey": "GET /chat/conversations/:id/events",
    "entity": "system_chat_conversation",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/chat/conversations/:id/cancel",
    "routeKey": "POST /chat/conversations/:id/cancel",
    "entity": "system_chat_conversation",
    "operation": "chat.command.execute",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/chat/conversations/:id/browser-sessions",
    "routeKey": "GET /chat/conversations/:id/browser-sessions",
    "entity": "browser_session_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/chat/conversations/:id/browser-sessions",
    "routeKey": "POST /chat/conversations/:id/browser-sessions",
    "entity": "browser_session_binding",
    "operation": "chat.browser.session.create",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/chat/conversations/:id/browser-sessions/:sessionId/attach",
    "routeKey": "POST /chat/conversations/:id/browser-sessions/:sessionId/attach",
    "entity": "browser_session_binding",
    "operation": "chat.browser.session.attach",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/chat/ask",
    "routeKey": "POST /chat/ask",
    "entity": "system_chat_action",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/ai/model-calls",
    "routeKey": "GET /ai/model-calls",
    "entity": "ai_model_call",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/ai/model-calls/:id",
    "routeKey": "GET /ai/model-calls/:id",
    "entity": "ai_model_call",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/ai/model-calls/:id/request-descriptor",
    "routeKey": "GET /ai/model-calls/:id/request-descriptor",
    "entity": "openai_request_descriptor",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/ai/model-calls/:id/events",
    "routeKey": "GET /ai/model-calls/:id/events",
    "entity": "ai_model_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/ai/model-calls/:id/output-items",
    "routeKey": "GET /ai/model-calls/:id/output-items",
    "entity": "ai_model_output_item",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/ai/model-calls/:id/tool-dispatches",
    "routeKey": "GET /ai/model-calls/:id/tool-dispatches",
    "entity": "ai_tool_dispatch",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/ai/model-calls/:id/continuations",
    "routeKey": "GET /ai/model-calls/:id/continuations",
    "entity": "ai_model_continuation",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/ai/model-calls/:id/checkpoints",
    "routeKey": "GET /ai/model-calls/:id/checkpoints",
    "entity": "ai_run_state_checkpoint",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/ai/model-calls/:id/retrieve",
    "routeKey": "POST /ai/model-calls/:id/retrieve",
    "entity": "ai_model_call",
    "operation": "agent.model.completed",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/ai/model-calls/:id/resume-stream",
    "routeKey": "POST /ai/model-calls/:id/resume-stream",
    "entity": "ai_model_call",
    "operation": "agent.model.completed",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/ai/model-calls/:id/request-cancel",
    "routeKey": "POST /ai/model-calls/:id/request-cancel",
    "entity": "ai_model_call",
    "operation": "agent.model.started",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/ai/model-calls/:id/reconcile",
    "routeKey": "POST /ai/model-calls/:id/reconcile",
    "entity": "ai_model_call",
    "operation": "agent.model.completed",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/ai/model-capabilities",
    "routeKey": "GET /ai/model-capabilities",
    "entity": "openai_model_capability_snapshot",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/ai/model-capabilities/:snapshotId",
    "routeKey": "GET /ai/model-capabilities/:snapshotId",
    "entity": "openai_model_capability_snapshot",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/ai/model-capabilities/refresh",
    "routeKey": "POST /ai/model-capabilities/refresh",
    "entity": "openai_model_capability_snapshot",
    "operation": "agent.model.started",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs",
    "routeKey": "POST /generation/jobs",
    "entity": "generation_job",
    "operation": "generation.job.create",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs",
    "routeKey": "GET /generation/jobs",
    "entity": "generation_job",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id",
    "routeKey": "GET /generation/jobs/:id",
    "entity": "generation_job",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/snapshot",
    "routeKey": "GET /generation/jobs/:id/snapshot",
    "entity": "generation_job",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/messages",
    "routeKey": "GET /generation/jobs/:id/messages",
    "entity": "generation_message",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/messages",
    "routeKey": "POST /generation/jobs/:id/messages",
    "entity": "generation_message",
    "operation": "generation.message.append",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/turns",
    "routeKey": "GET /generation/jobs/:id/turns",
    "entity": "generation_turn",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/events",
    "routeKey": "GET /generation/jobs/:id/events",
    "entity": "generation_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/sources",
    "routeKey": "GET /generation/jobs/:id/sources",
    "entity": "generation_source",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/sources",
    "routeKey": "POST /generation/jobs/:id/sources",
    "entity": "generation_source",
    "operation": "generation.source.add",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/sources/:sourceId",
    "routeKey": "GET /generation/jobs/:id/sources/:sourceId",
    "entity": "generation_source",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/facts",
    "routeKey": "GET /generation/jobs/:id/facts",
    "entity": "generation_fact",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/owner-decisions",
    "routeKey": "GET /generation/jobs/:id/owner-decisions",
    "entity": "generation_owner_decision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/capability-snapshots",
    "routeKey": "GET /generation/jobs/:id/capability-snapshots",
    "entity": "generation_capability_snapshot",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/capability-snapshots/refresh",
    "routeKey": "POST /generation/jobs/:id/capability-snapshots/refresh",
    "entity": "generation_capability_snapshot",
    "operation": "generation.capability.resolve",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/spec",
    "routeKey": "GET /generation/jobs/:id/spec",
    "entity": "generation_spec_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/spec/revisions",
    "routeKey": "GET /generation/jobs/:id/spec/revisions",
    "entity": "generation_spec_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/spec/revisions/:revisionId",
    "routeKey": "GET /generation/jobs/:id/spec/revisions/:revisionId",
    "entity": "generation_spec_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/spec/revisions/:revisionId/precheck",
    "routeKey": "POST /generation/jobs/:id/spec/revisions/:revisionId/precheck",
    "entity": "generation_spec_revision",
    "operation": "generation.spec.precheck",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/approve-spec",
    "routeKey": "POST /generation/jobs/:id/approve-spec",
    "entity": "generation_job",
    "operation": "generation.spec.approve",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/authority",
    "routeKey": "GET /generation/jobs/:id/authority",
    "entity": "generation_execution_authority",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/plans",
    "routeKey": "GET /generation/jobs/:id/plans",
    "entity": "generation_plan",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/plans/:planId",
    "routeKey": "GET /generation/jobs/:id/plans/:planId",
    "entity": "generation_plan",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/plans/:planId/validate",
    "routeKey": "POST /generation/jobs/:id/plans/:planId/validate",
    "entity": "generation_plan",
    "operation": "generation.plan.validate",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/phases",
    "routeKey": "GET /generation/jobs/:id/phases",
    "entity": "generation_phase_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/phases/:phaseRunId",
    "routeKey": "GET /generation/jobs/:id/phases/:phaseRunId",
    "entity": "generation_phase_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/checkpoints",
    "routeKey": "GET /generation/jobs/:id/checkpoints",
    "entity": "generation_checkpoint",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/model-calls",
    "routeKey": "GET /generation/jobs/:id/model-calls",
    "entity": "ai_model_call",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/tool-events",
    "routeKey": "GET /generation/jobs/:id/tool-events",
    "entity": "generation_tool_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/workspace/revisions",
    "routeKey": "GET /generation/jobs/:id/workspace/revisions",
    "entity": "generation_workspace_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/workspace/revisions/:revisionId",
    "routeKey": "GET /generation/jobs/:id/workspace/revisions/:revisionId",
    "entity": "generation_workspace_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/workspace/revisions/:revisionId/files",
    "routeKey": "GET /generation/jobs/:id/workspace/revisions/:revisionId/files",
    "entity": "generation_workspace_file",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/workspace/patches",
    "routeKey": "GET /generation/jobs/:id/workspace/patches",
    "entity": "generation_workspace_patch",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/contract-candidates",
    "routeKey": "GET /generation/jobs/:id/contract-candidates",
    "entity": "generation_contract_candidate",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/artifact-manifests",
    "routeKey": "GET /generation/jobs/:id/artifact-manifests",
    "entity": "generation_artifact_manifest",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/artifacts",
    "routeKey": "GET /generation/jobs/:id/artifacts",
    "entity": "generation_artifact",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/validation-runs",
    "routeKey": "GET /generation/jobs/:id/validation-runs",
    "entity": "generation_validation_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/validation-runs/:runId",
    "routeKey": "GET /generation/jobs/:id/validation-runs/:runId",
    "entity": "generation_validation_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/validation-runs",
    "routeKey": "POST /generation/jobs/:id/validation-runs",
    "entity": "generation_validation_run",
    "operation": "generation.validation.run",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/blockers",
    "routeKey": "GET /generation/jobs/:id/blockers",
    "entity": "generation_blocker",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/blockers/:blockerId/resolve",
    "routeKey": "POST /generation/jobs/:id/blockers/:blockerId/resolve",
    "entity": "generation_blocker",
    "operation": "generation.blocker.resolve",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/activation-set",
    "routeKey": "GET /generation/jobs/:id/activation-set",
    "entity": "generation_activation_set",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/cancel",
    "routeKey": "POST /generation/jobs/:id/cancel",
    "entity": "generation_job",
    "operation": "generation.job.cancel",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/retry",
    "routeKey": "POST /generation/jobs/:id/retry",
    "entity": "generation_job",
    "operation": "generation.job.retry",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/follow-up",
    "routeKey": "POST /generation/jobs/:id/follow-up",
    "entity": "generation_job",
    "operation": "generation.message.append",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/resume",
    "routeKey": "POST /generation/jobs/:id/resume",
    "entity": "generation_job",
    "operation": "generation.job.resume",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/releases",
    "routeKey": "GET /generation/jobs/:id/releases",
    "entity": "component_release",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/logs",
    "routeKey": "GET /generation/jobs/:id/logs",
    "entity": "debug_log_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/audit",
    "routeKey": "GET /generation/jobs/:id/audit",
    "entity": "audit_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/browser/session",
    "routeKey": "GET /generation/jobs/:id/browser/session",
    "entity": "browser_session",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/session",
    "routeKey": "POST /generation/jobs/:id/browser/session",
    "entity": "browser_session",
    "operation": "browser.session.create",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/browser/preview",
    "routeKey": "GET /generation/jobs/:id/browser/preview",
    "entity": "browser_session",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/attach",
    "routeKey": "POST /generation/jobs/:id/browser/attach",
    "entity": "browser_session",
    "operation": "browser.session.attach",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/credentials",
    "routeKey": "POST /generation/jobs/:id/browser/credentials",
    "entity": "browser_session",
    "operation": "browser.auth.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/account/save",
    "routeKey": "POST /generation/jobs/:id/browser/account/save",
    "entity": "browser_account_binding",
    "operation": "browser.account.save",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/operation-scope",
    "routeKey": "POST /generation/jobs/:id/browser/operation-scope",
    "entity": "browser_operation_scope",
    "operation": "browser.session.state",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/confirmations",
    "routeKey": "POST /generation/jobs/:id/browser/confirmations",
    "entity": "browser_irreversible_confirmation",
    "operation": "browser.challenge.resolve",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/generation/jobs/:id/browser/teaching",
    "routeKey": "GET /generation/jobs/:id/browser/teaching",
    "entity": "browser_teaching_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/teaching",
    "routeKey": "POST /generation/jobs/:id/browser/teaching",
    "entity": "browser_teaching_run",
    "operation": "browser.teaching.start",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/teaching/preflight",
    "routeKey": "POST /generation/jobs/:id/browser/teaching/preflight",
    "entity": "browser_teaching_run",
    "operation": "browser.automation.preflight",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/teaching/replay",
    "routeKey": "POST /generation/jobs/:id/browser/teaching/replay",
    "entity": "browser_teaching_run",
    "operation": "browser.automation.run",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/takeover",
    "routeKey": "POST /generation/jobs/:id/browser/takeover",
    "entity": "browser_session",
    "operation": "browser.control.transfer",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/generation/jobs/:id/browser/return-to-ai",
    "routeKey": "POST /generation/jobs/:id/browser/return-to-ai",
    "entity": "browser_session",
    "operation": "browser.control.release",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions",
    "routeKey": "GET /browser-sessions",
    "entity": "browser_session",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions",
    "routeKey": "POST /browser-sessions",
    "entity": "browser_session",
    "operation": "browser.session.create",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId",
    "routeKey": "GET /browser-sessions/:sessionId",
    "entity": "browser_session",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/snapshot",
    "routeKey": "GET /browser-sessions/:sessionId/snapshot",
    "entity": "browser_session",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/events",
    "routeKey": "GET /browser-sessions/:sessionId/events",
    "entity": "browser_session",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/pages",
    "routeKey": "GET /browser-sessions/:sessionId/pages",
    "entity": "browser_page",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/pages",
    "routeKey": "POST /browser-sessions/:sessionId/pages",
    "entity": "browser_page",
    "operation": "browser.page.open",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/pages/:pageId",
    "routeKey": "GET /browser-sessions/:sessionId/pages/:pageId",
    "entity": "browser_page",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/pages/:pageId/activate",
    "routeKey": "POST /browser-sessions/:sessionId/pages/:pageId/activate",
    "entity": "browser_page",
    "operation": "browser.page.activate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/pages/:pageId/close",
    "routeKey": "POST /browser-sessions/:sessionId/pages/:pageId/close",
    "entity": "browser_page",
    "operation": "browser.page.close",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/frames",
    "routeKey": "GET /browser-sessions/:sessionId/frames",
    "entity": "browser_frame",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/documents",
    "routeKey": "GET /browser-sessions/:sessionId/documents",
    "entity": "browser_document",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/navigations",
    "routeKey": "GET /browser-sessions/:sessionId/navigations",
    "entity": "browser_navigation",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/observe",
    "routeKey": "POST /browser-sessions/:sessionId/observe",
    "entity": "browser_observation",
    "operation": "browser.session.observe",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/actions",
    "routeKey": "POST /browser-sessions/:sessionId/actions",
    "entity": "browser_action_run",
    "operation": "browser.action.start",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/actions/:actionId",
    "routeKey": "GET /browser-sessions/:sessionId/actions/:actionId",
    "entity": "browser_action_run",
    "operation": "browser.action.status",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/actions/:actionId/attempts",
    "routeKey": "GET /browser-sessions/:sessionId/actions/:actionId/attempts",
    "entity": "browser_action_attempt",
    "operation": "browser.action.status",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/actions/:actionId/cancel",
    "routeKey": "POST /browser-sessions/:sessionId/actions/:actionId/cancel",
    "entity": "browser_action_run",
    "operation": "browser.action.cancel",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/actions/:actionId/reconcile",
    "routeKey": "POST /browser-sessions/:sessionId/actions/:actionId/reconcile",
    "entity": "browser_action_run",
    "operation": "browser.action.reconcile",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/actions/:actionId/resolve-outcome",
    "routeKey": "POST /browser-sessions/:sessionId/actions/:actionId/resolve-outcome",
    "entity": "browser_action_run",
    "operation": "browser.action.resolveOutcome",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/control",
    "routeKey": "GET /browser-sessions/:sessionId/control",
    "entity": "browser_control_lease",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/control/acquire",
    "routeKey": "POST /browser-sessions/:sessionId/control/acquire",
    "entity": "browser_control_lease",
    "operation": "browser.control.acquire",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/control/release",
    "routeKey": "POST /browser-sessions/:sessionId/control/release",
    "entity": "browser_control_lease",
    "operation": "browser.control.release",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/control/return-to-ai",
    "routeKey": "POST /browser-sessions/:sessionId/control/return-to-ai",
    "entity": "browser_control_lease",
    "operation": "browser.control.release",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/control-transfers",
    "routeKey": "GET /browser-sessions/:sessionId/control-transfers",
    "entity": "browser_control_transfer",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/operation-scopes",
    "routeKey": "POST /browser-sessions/:sessionId/operation-scopes",
    "entity": "browser_operation_scope",
    "operation": "browser.session.state",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/targets",
    "routeKey": "GET /browser-sessions/:sessionId/targets",
    "entity": "browser_target_reference",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/targets/pick",
    "routeKey": "POST /browser-sessions/:sessionId/targets/pick",
    "entity": "browser_target_reference",
    "operation": "browser.target.pick",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/targets/:targetId/revalidate",
    "routeKey": "POST /browser-sessions/:sessionId/targets/:targetId/revalidate",
    "entity": "browser_target_reference",
    "operation": "browser.target.revalidate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/credentials",
    "routeKey": "POST /browser-sessions/:sessionId/credentials",
    "entity": "browser_auth_attempt",
    "operation": "browser.auth.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/auth/verify",
    "routeKey": "POST /browser-sessions/:sessionId/auth/verify",
    "entity": "browser_auth_attempt",
    "operation": "browser.auth.verify",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/auth-attempts",
    "routeKey": "GET /browser-sessions/:sessionId/auth-attempts",
    "entity": "browser_auth_attempt",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/accounts/save",
    "routeKey": "POST /browser-sessions/:sessionId/accounts/save",
    "entity": "browser_account_binding",
    "operation": "browser.account.save",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/state-bundles/capture",
    "routeKey": "POST /browser-sessions/:sessionId/state-bundles/capture",
    "entity": "browser_state_bundle",
    "operation": "browser.state.capture",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/dialogs/:dialogId/respond",
    "routeKey": "POST /browser-sessions/:sessionId/dialogs/:dialogId/respond",
    "entity": "browser_dialog",
    "operation": "browser.dialog.respond",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/permissions/:requestId/respond",
    "routeKey": "POST /browser-sessions/:sessionId/permissions/:requestId/respond",
    "entity": "browser_permission_request",
    "operation": "browser.dialog.respond",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/challenges/:challengeId/resolve",
    "routeKey": "POST /browser-sessions/:sessionId/challenges/:challengeId/resolve",
    "entity": "browser_challenge",
    "operation": "browser.challenge.resolve",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/pause",
    "routeKey": "POST /browser-sessions/:sessionId/pause",
    "entity": "browser_session",
    "operation": "browser.session.pause",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/resume",
    "routeKey": "POST /browser-sessions/:sessionId/resume",
    "entity": "browser_session",
    "operation": "browser.session.resume",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/recover",
    "routeKey": "POST /browser-sessions/:sessionId/recover",
    "entity": "browser_session",
    "operation": "browser.session.recover",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/close",
    "routeKey": "POST /browser-sessions/:sessionId/close",
    "entity": "browser_session",
    "operation": "browser.session.close",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/artifacts",
    "routeKey": "GET /browser-sessions/:sessionId/artifacts",
    "entity": "browser_automation_artifact",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/uploads",
    "routeKey": "POST /browser-sessions/:sessionId/uploads",
    "entity": "browser_upload_handle",
    "operation": "browser.upload.create",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/downloads",
    "routeKey": "GET /browser-sessions/:sessionId/downloads",
    "entity": "browser_download",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-sessions/:sessionId/preview-tickets",
    "routeKey": "POST /browser-sessions/:sessionId/preview-tickets",
    "entity": "browser_preview_ticket",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-sessions/:sessionId/preview/latest",
    "routeKey": "GET /browser-sessions/:sessionId/preview/latest",
    "entity": "browser_preview_frame",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "WSS",
    "path": "/browser-sessions/:sessionId/preview/ws",
    "routeKey": "WSS /browser-sessions/:sessionId/preview/ws",
    "entity": "browser_preview_frame",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-accounts",
    "routeKey": "GET /browser-accounts",
    "entity": "browser_account_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-accounts",
    "routeKey": "POST /browser-accounts",
    "entity": "browser_account_binding",
    "operation": "browser.account.save",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-accounts/:accountId",
    "routeKey": "GET /browser-accounts/:accountId",
    "entity": "browser_account_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PATCH",
    "path": "/browser-accounts/:accountId",
    "routeKey": "PATCH /browser-accounts/:accountId",
    "entity": "browser_account_binding",
    "operation": "browser.account.save",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-accounts/:accountId/verify",
    "routeKey": "POST /browser-accounts/:accountId/verify",
    "entity": "browser_account_binding",
    "operation": "browser.account.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-accounts/:accountId/reauthenticate",
    "routeKey": "POST /browser-accounts/:accountId/reauthenticate",
    "entity": "browser_account_binding",
    "operation": "browser.automation.reauthenticate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-accounts/:accountId/logout",
    "routeKey": "POST /browser-accounts/:accountId/logout",
    "entity": "browser_account_binding",
    "operation": "browser.account.logout",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-accounts/:accountId/invalidate-state",
    "routeKey": "POST /browser-accounts/:accountId/invalidate-state",
    "entity": "browser_account_binding",
    "operation": "browser.state.invalidate",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-accounts/:accountId/state-bundles",
    "routeKey": "GET /browser-accounts/:accountId/state-bundles",
    "entity": "browser_state_bundle",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-accounts/:accountId/state-bundles/:bundleId",
    "routeKey": "GET /browser-accounts/:accountId/state-bundles/:bundleId",
    "entity": "browser_state_bundle",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-accounts/:accountId/state-bundles/:bundleId/verify",
    "routeKey": "POST /browser-accounts/:accountId/state-bundles/:bundleId/verify",
    "entity": "browser_state_bundle",
    "operation": "browser.state.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-accounts/:accountId/state-bundles/:bundleId/activate",
    "routeKey": "POST /browser-accounts/:accountId/state-bundles/:bundleId/activate",
    "entity": "browser_state_bundle",
    "operation": "browser.state.activate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-accounts/:accountId/state-bundles/:bundleId/invalidate",
    "routeKey": "POST /browser-accounts/:accountId/state-bundles/:bundleId/invalidate",
    "entity": "browser_state_bundle",
    "operation": "browser.state.invalidate",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-bridges",
    "routeKey": "GET /browser-bridges",
    "entity": "browser_local_bridge",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-bridges/enrollments",
    "routeKey": "POST /browser-bridges/enrollments",
    "entity": "browser_local_bridge",
    "operation": "browser.bridge.enroll",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-bridges/enrollments/:enrollmentId/complete",
    "routeKey": "POST /browser-bridges/enrollments/:enrollmentId/complete",
    "entity": "browser_local_bridge",
    "operation": "browser.bridge.connect",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-bridges/:bridgeId",
    "routeKey": "GET /browser-bridges/:bridgeId",
    "entity": "browser_local_bridge",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-bridges/:bridgeId/connections",
    "routeKey": "GET /browser-bridges/:bridgeId/connections",
    "entity": "browser_bridge_connection",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-bridges/:bridgeId/profiles",
    "routeKey": "GET /browser-bridges/:bridgeId/profiles",
    "entity": "browser_profile_lease",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-bridges/:bridgeId/test",
    "routeKey": "POST /browser-bridges/:bridgeId/test",
    "entity": "browser_local_bridge",
    "operation": "browser.bridge.test",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-bridges/:bridgeId/rotate-certificate",
    "routeKey": "POST /browser-bridges/:bridgeId/rotate-certificate",
    "entity": "browser_local_bridge",
    "operation": "browser.bridge.rotateCertificate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-bridges/:bridgeId/revoke",
    "routeKey": "POST /browser-bridges/:bridgeId/revoke",
    "entity": "browser_local_bridge",
    "operation": "browser.bridge.revoke",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-automations",
    "routeKey": "GET /browser-automations",
    "entity": "browser_automation_definition",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-automations",
    "routeKey": "POST /browser-automations",
    "entity": "browser_automation_definition",
    "operation": "browser.automation.run",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-automations/:id",
    "routeKey": "GET /browser-automations/:id",
    "entity": "browser_automation_definition",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PATCH",
    "path": "/browser-automations/:id",
    "routeKey": "PATCH /browser-automations/:id",
    "entity": "browser_automation_definition",
    "operation": "browser.automation.repair",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-automations/:id/revisions",
    "routeKey": "GET /browser-automations/:id/revisions",
    "entity": "browser_automation_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/revisions",
    "routeKey": "POST /browser-automations/:id/revisions",
    "entity": "browser_automation_revision",
    "operation": "browser.teaching.compile",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-automations/:id/revisions/:revisionId",
    "routeKey": "GET /browser-automations/:id/revisions/:revisionId",
    "entity": "browser_automation_revision",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/revisions/:revisionId/preflight",
    "routeKey": "POST /browser-automations/:id/revisions/:revisionId/preflight",
    "entity": "browser_automation_revision",
    "operation": "browser.automation.preflight",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/revisions/:revisionId/verify",
    "routeKey": "POST /browser-automations/:id/revisions/:revisionId/verify",
    "entity": "browser_automation_revision",
    "operation": "browser.automation.verify",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/revisions/:revisionId/activate",
    "routeKey": "POST /browser-automations/:id/revisions/:revisionId/activate",
    "entity": "browser_automation_revision",
    "operation": "browser.automation.run",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/revisions/:revisionId/rollback",
    "routeKey": "POST /browser-automations/:id/revisions/:revisionId/rollback",
    "entity": "browser_automation_revision",
    "operation": "browser.automation.repair",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-automations/:id/auth-bindings",
    "routeKey": "GET /browser-automations/:id/auth-bindings",
    "entity": "browser_auth_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/auth-bindings",
    "routeKey": "POST /browser-automations/:id/auth-bindings",
    "entity": "browser_auth_binding",
    "operation": "browser.account.save",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-automations/:id/schedules",
    "routeKey": "GET /browser-automations/:id/schedules",
    "entity": "browser_automation_definition",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/schedules",
    "routeKey": "POST /browser-automations/:id/schedules",
    "entity": "browser_automation_definition",
    "operation": "browser.schedule.evaluate",
    "mutating": true
  },
  {
    "method": "PATCH",
    "path": "/browser-automations/:id/schedules/:scheduleId",
    "routeKey": "PATCH /browser-automations/:id/schedules/:scheduleId",
    "entity": "browser_automation_definition",
    "operation": "browser.schedule.evaluate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/teaching-runs",
    "routeKey": "POST /browser-automations/:id/teaching-runs",
    "entity": "browser_teaching_run",
    "operation": "browser.teaching.start",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-teaching-runs/:teachingRunId",
    "routeKey": "GET /browser-teaching-runs/:teachingRunId",
    "entity": "browser_teaching_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-teaching-runs/:teachingRunId/stop",
    "routeKey": "POST /browser-teaching-runs/:teachingRunId/stop",
    "entity": "browser_teaching_run",
    "operation": "browser.teaching.start",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-teaching-runs/:teachingRunId/compile",
    "routeKey": "POST /browser-teaching-runs/:teachingRunId/compile",
    "entity": "browser_teaching_run",
    "operation": "browser.teaching.compile",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/runs",
    "routeKey": "POST /browser-automations/:id/runs",
    "entity": "browser_automation_run",
    "operation": "browser.automation.run",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-automations/:id/runs",
    "routeKey": "GET /browser-automations/:id/runs",
    "entity": "browser_automation_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-runs/:runId",
    "routeKey": "GET /browser-runs/:runId",
    "entity": "browser_automation_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-runs/:runId/session",
    "routeKey": "GET /browser-runs/:runId/session",
    "entity": "browser_session",
    "operation": "browser.session.observe",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-runs/:runId/steps",
    "routeKey": "GET /browser-runs/:runId/steps",
    "entity": "browser_automation_run_step",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-runs/:runId/control/acquire",
    "routeKey": "POST /browser-runs/:runId/control/acquire",
    "entity": "browser_automation_run",
    "operation": "browser.control.acquire",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-runs/:runId/control/release",
    "routeKey": "POST /browser-runs/:runId/control/release",
    "entity": "browser_automation_run",
    "operation": "browser.control.release",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-runs/:runId/control/return-to-runtime",
    "routeKey": "POST /browser-runs/:runId/control/return-to-runtime",
    "entity": "browser_automation_run",
    "operation": "browser.control.release",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-runs/:runId/cancel",
    "routeKey": "POST /browser-runs/:runId/cancel",
    "entity": "browser_automation_run",
    "operation": "browser.automation.cancel",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-runs/:runId/reauthenticate",
    "routeKey": "POST /browser-runs/:runId/reauthenticate",
    "entity": "browser_automation_run",
    "operation": "browser.automation.reauthenticate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-runs/:runId/reconcile",
    "routeKey": "POST /browser-runs/:runId/reconcile",
    "entity": "browser_automation_run",
    "operation": "browser.automation.reconcile",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-runs/:runId/resolve-outcome",
    "routeKey": "POST /browser-runs/:runId/resolve-outcome",
    "entity": "browser_automation_run",
    "operation": "browser.run.manualReview",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-runs/:runId/challenges/:challengeId/resolve",
    "routeKey": "POST /browser-runs/:runId/challenges/:challengeId/resolve",
    "entity": "browser_challenge",
    "operation": "browser.challenge.resolve",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/browser-runs/:runId/artifacts",
    "routeKey": "GET /browser-runs/:runId/artifacts",
    "entity": "browser_automation_artifact",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/browser-runs/:runId/artifacts/:artifactId",
    "routeKey": "GET /browser-runs/:runId/artifacts/:artifactId",
    "entity": "browser_automation_artifact",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/enable",
    "routeKey": "POST /browser-automations/:id/enable",
    "entity": "browser_automation_definition",
    "operation": "browser.automation.run",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/disable",
    "routeKey": "POST /browser-automations/:id/disable",
    "entity": "browser_automation_definition",
    "operation": "browser.automation.cancel",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/browser-automations/:id/repair",
    "routeKey": "POST /browser-automations/:id/repair",
    "entity": "browser_automation_definition",
    "operation": "browser.automation.repair",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/secrets",
    "routeKey": "GET /secrets",
    "entity": "secret_record",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/secrets",
    "routeKey": "POST /secrets",
    "entity": "secret_record",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/secrets/:id",
    "routeKey": "GET /secrets/:id",
    "entity": "secret_record",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PATCH",
    "path": "/secrets/:id",
    "routeKey": "PATCH /secrets/:id",
    "entity": "secret_record",
    "operation": null,
    "mutating": true
  },
  {
    "method": "DELETE",
    "path": "/secrets/:id",
    "routeKey": "DELETE /secrets/:id",
    "entity": "secret_record",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/secrets/:id/value",
    "routeKey": "GET /secrets/:id/value",
    "entity": "secret_record",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/secrets/:id/versions",
    "routeKey": "POST /secrets/:id/versions",
    "entity": "secret_version",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/secrets/:id/versions",
    "routeKey": "GET /secrets/:id/versions",
    "entity": "secret_version",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/secrets/:id/versions/:versionId/activate",
    "routeKey": "POST /secrets/:id/versions/:versionId/activate",
    "entity": "secret_version",
    "operation": "secret.version.activate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/secrets/:id/rotate",
    "routeKey": "POST /secrets/:id/rotate",
    "entity": "secret_record",
    "operation": "secret.rotate",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/secrets/:id/bindings",
    "routeKey": "GET /secrets/:id/bindings",
    "entity": "secret_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/secrets/:id/bindings",
    "routeKey": "POST /secrets/:id/bindings",
    "entity": "secret_binding",
    "operation": "secret.bind",
    "mutating": true
  },
  {
    "method": "DELETE",
    "path": "/secrets/:id/bindings/:bindingId",
    "routeKey": "DELETE /secrets/:id/bindings/:bindingId",
    "entity": "secret_binding",
    "operation": "secret.unbind",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/secrets/:id/usage",
    "routeKey": "GET /secrets/:id/usage",
    "entity": "secret_access_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/secrets/:id/test-resolve",
    "routeKey": "POST /secrets/:id/test-resolve",
    "entity": "secret_access_event",
    "operation": "secret.resolve",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/secrets/generate-password",
    "routeKey": "POST /secrets/generate-password",
    "entity": "secret_record",
    "operation": null,
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/secrets/import",
    "routeKey": "POST /secrets/import",
    "entity": "secret_record",
    "operation": null,
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/secrets/export",
    "routeKey": "POST /secrets/export",
    "entity": "secret_record",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/runtime/executions",
    "routeKey": "GET /runtime/executions",
    "entity": "runtime_execution_context",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/runtime/executions/:id",
    "routeKey": "GET /runtime/executions/:id",
    "entity": "runtime_execution_context",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/runtime/instances",
    "routeKey": "GET /runtime/instances",
    "entity": "runtime_instance",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/runtime/instances/:id",
    "routeKey": "GET /runtime/instances/:id",
    "entity": "runtime_instance",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/runtime/instances/:id/processes",
    "routeKey": "GET /runtime/instances/:id/processes",
    "entity": "runtime_process_identity",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/runtime/instances/:id/connections",
    "routeKey": "GET /runtime/instances/:id/connections",
    "entity": "runtime_ipc_connection",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/runtime/instances/:id/calls",
    "routeKey": "GET /runtime/instances/:id/calls",
    "entity": "runtime_ipc_call",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/runtime/instances/:id/sandbox",
    "routeKey": "GET /runtime/instances/:id/sandbox",
    "entity": "runtime_instance",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/runtime/instances/:id/cleanup",
    "routeKey": "GET /runtime/instances/:id/cleanup",
    "entity": "runtime_cleanup_operation",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/runtime/instances/:id/drain",
    "routeKey": "POST /runtime/instances/:id/drain",
    "entity": "runtime_instance",
    "operation": "runtime.drain",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/runtime/instances/:id/restart",
    "routeKey": "POST /runtime/instances/:id/restart",
    "entity": "runtime_instance",
    "operation": "runtime.instance.restart",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/runtime/instances/:id/reconcile",
    "routeKey": "POST /runtime/instances/:id/reconcile",
    "entity": "runtime_instance",
    "operation": "runtime.instance.reconcile",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/runtime/instances/:id/verify-boundary",
    "routeKey": "POST /runtime/instances/:id/verify-boundary",
    "entity": "runtime_instance",
    "operation": "runtime.boundary.verify",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/runtime/boundary/evidence",
    "routeKey": "GET /runtime/boundary/evidence",
    "entity": "runtime_process_identity",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/bindings",
    "routeKey": "GET /bindings",
    "entity": "binding_set",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/bindings/:id",
    "routeKey": "GET /bindings/:id",
    "entity": "binding_set",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/bindings/preview",
    "routeKey": "POST /bindings/preview",
    "entity": "binding_set",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/bindings/test",
    "routeKey": "POST /bindings/test",
    "entity": "binding_set",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/external/targets",
    "routeKey": "GET /external/targets",
    "entity": "external_target",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/external/targets",
    "routeKey": "POST /external/targets",
    "entity": "external_target",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/external/targets/:id",
    "routeKey": "GET /external/targets/:id",
    "entity": "external_target",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PATCH",
    "path": "/external/targets/:id",
    "routeKey": "PATCH /external/targets/:id",
    "entity": "external_target",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/external/targets/:id/test",
    "routeKey": "POST /external/targets/:id/test",
    "entity": "external_target",
    "operation": "mcp.tools.call",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/external/targets/:id/circuit/open",
    "routeKey": "POST /external/targets/:id/circuit/open",
    "entity": "external_target",
    "operation": "monitor.state.transition",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/external/targets/:id/circuit/close",
    "routeKey": "POST /external/targets/:id/circuit/close",
    "entity": "external_target",
    "operation": "monitor.state.transition",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/external/auth-bindings",
    "routeKey": "GET /external/auth-bindings",
    "entity": "external_auth_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/external/auth-bindings",
    "routeKey": "POST /external/auth-bindings",
    "entity": "external_auth_binding",
    "operation": "secret.bind",
    "mutating": true
  },
  {
    "method": "PATCH",
    "path": "/external/auth-bindings/:id",
    "routeKey": "PATCH /external/auth-bindings/:id",
    "entity": "external_auth_binding",
    "operation": "secret.bind",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/external/target-bindings",
    "routeKey": "GET /external/target-bindings",
    "entity": "external_target_binding",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/external/target-bindings",
    "routeKey": "POST /external/target-bindings",
    "entity": "external_target_binding",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "DELETE",
    "path": "/external/target-bindings/:id",
    "routeKey": "DELETE /external/target-bindings/:id",
    "entity": "external_target_binding",
    "operation": "component.deregister",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/external/requests",
    "routeKey": "GET /external/requests",
    "entity": "external_request_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/webhooks",
    "routeKey": "GET /webhooks",
    "entity": "webhook_endpoint",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/webhooks/test",
    "routeKey": "POST /webhooks/test",
    "entity": "webhook_endpoint",
    "operation": "mcp.tools.call",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/monitoring/overview",
    "routeKey": "GET /monitoring/overview",
    "entity": "monitoring_profile",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/monitoring/probes",
    "routeKey": "GET /monitoring/probes",
    "entity": "monitoring_probe",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/monitoring/state-history",
    "routeKey": "GET /monitoring/state-history",
    "entity": "component_state_history",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/monitoring/profiles",
    "routeKey": "GET /monitoring/profiles",
    "entity": "monitoring_profile",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PUT",
    "path": "/monitoring/profiles/:componentId",
    "routeKey": "PUT /monitoring/profiles/:componentId",
    "entity": "monitoring_profile",
    "operation": "monitor.state.transition",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/monitoring/probe/run",
    "routeKey": "POST /monitoring/probe/run",
    "entity": "monitoring_probe",
    "operation": "monitor.probe.request",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/alerts",
    "routeKey": "GET /alerts",
    "entity": "operational_alert",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/alerts/:id",
    "routeKey": "GET /alerts/:id",
    "entity": "operational_alert",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/alerts/:id/acknowledge",
    "routeKey": "POST /alerts/:id/acknowledge",
    "entity": "operational_alert",
    "operation": "monitor.alert.update",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/alerts/:id/suppress",
    "routeKey": "POST /alerts/:id/suppress",
    "entity": "operational_alert",
    "operation": "monitor.alert.update",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/alerts/:id/close",
    "routeKey": "POST /alerts/:id/close",
    "entity": "operational_alert",
    "operation": "monitor.alert.close",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/alerts/:id/deliveries",
    "routeKey": "GET /alerts/:id/deliveries",
    "entity": "alert_delivery",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/alerts/channels/test",
    "routeKey": "POST /alerts/channels/test",
    "entity": "operational_alert",
    "operation": "monitor.probe.request",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/workers/heartbeats",
    "routeKey": "GET /workers/heartbeats",
    "entity": "platform_worker_heartbeat",
    "operation": "monitor.heartbeat.observe",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/audit/events",
    "routeKey": "GET /audit/events",
    "entity": "audit_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/audit/events/:id",
    "routeKey": "GET /audit/events/:id",
    "entity": "audit_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/audit/integrity",
    "routeKey": "GET /audit/integrity",
    "entity": "audit_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/audit/integrity/verify",
    "routeKey": "POST /audit/integrity/verify",
    "entity": "audit_event",
    "operation": null,
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/audit/archive",
    "routeKey": "GET /audit/archive",
    "entity": "audit_archive_outbox",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/logs",
    "routeKey": "GET /logs",
    "entity": "debug_log_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/logs/stream",
    "routeKey": "GET /logs/stream",
    "entity": "debug_log_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/logs/correlations/:correlationId",
    "routeKey": "GET /logs/correlations/:correlationId",
    "entity": "debug_log_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/logs/export",
    "routeKey": "POST /logs/export",
    "entity": "debug_log_event",
    "operation": "audit.archive.enqueue",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/config/settings",
    "routeKey": "GET /config/settings",
    "entity": "operational_setting",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/config/settings/:key",
    "routeKey": "GET /config/settings/:key",
    "entity": "operational_setting",
    "operation": null,
    "mutating": false
  },
  {
    "method": "PUT",
    "path": "/config/settings/:key",
    "routeKey": "PUT /config/settings/:key",
    "entity": "operational_setting",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/config/settings/:key/reset",
    "routeKey": "POST /config/settings/:key/reset",
    "entity": "operational_setting",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/config/validate",
    "routeKey": "POST /config/validate",
    "entity": "operational_setting",
    "operation": "component.validate",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/config/apply",
    "routeKey": "POST /config/apply",
    "entity": "configuration_apply_run",
    "operation": "generation.activation.switch",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/config/export",
    "routeKey": "POST /config/export",
    "entity": "operational_setting",
    "operation": "audit.archive.enqueue",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/config/import",
    "routeKey": "POST /config/import",
    "entity": "operational_setting",
    "operation": "component.revision.publish",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/releases",
    "routeKey": "GET /releases",
    "entity": "application_release",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/releases/:id",
    "routeKey": "GET /releases/:id",
    "entity": "application_release",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/releases/:id/rollback",
    "routeKey": "POST /releases/:id/rollback",
    "entity": "application_release",
    "operation": "component.rollback",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/deployments",
    "routeKey": "GET /deployments",
    "entity": "deployment_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/backups",
    "routeKey": "GET /backups",
    "entity": "backup_record",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/backups",
    "routeKey": "POST /backups",
    "entity": "backup_record",
    "operation": "audit.archive.enqueue",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/backups/:id/verify",
    "routeKey": "POST /backups/:id/verify",
    "entity": "backup_record",
    "operation": "audit.integrity.verify",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/acceptance-runs",
    "routeKey": "GET /acceptance-runs",
    "entity": "production_acceptance_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/maintenance/restart-service",
    "routeKey": "POST /maintenance/restart-service",
    "entity": "runtime_instance",
    "operation": "runtime.instance.restart",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/system/health",
    "routeKey": "GET /system/health",
    "entity": "application_deployment_head",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/system/readiness",
    "routeKey": "GET /system/readiness",
    "entity": "application_deployment_head",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/system/version",
    "routeKey": "GET /system/version",
    "entity": "application_deployment_head",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/self-tests/catalog",
    "routeKey": "GET /self-tests/catalog",
    "entity": "self_test_catalog_entry",
    "operation": "selfTest.catalog.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/self-tests/fault-catalog",
    "routeKey": "GET /self-tests/fault-catalog",
    "entity": "self_test_run",
    "operation": "selfTest.catalog.list",
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/self-tests/models",
    "routeKey": "GET /self-tests/models",
    "entity": "self_test_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/self-tests/runs",
    "routeKey": "POST /self-tests/runs",
    "entity": "self_test_run",
    "operation": "selfTest.run.start",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/self-tests/runs",
    "routeKey": "GET /self-tests/runs",
    "entity": "self_test_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/self-tests/runs/:id",
    "routeKey": "GET /self-tests/runs/:id",
    "entity": "self_test_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/self-tests/runs/:id/events",
    "routeKey": "GET /self-tests/runs/:id/events",
    "entity": "self_test_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/self-tests/runs/:id/history",
    "routeKey": "GET /self-tests/runs/:id/history",
    "entity": "self_test_run",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/self-tests/runs/:id/evidence",
    "routeKey": "GET /self-tests/runs/:id/evidence",
    "entity": "self_test_run",
    "operation": "selfTest.evidence.read",
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/self-tests/runs/:id/replay",
    "routeKey": "POST /self-tests/runs/:id/replay",
    "entity": "self_test_run",
    "operation": "selfTest.registeredElement.run",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/self-tests/runs/:id/shrink",
    "routeKey": "POST /self-tests/runs/:id/shrink",
    "entity": "self_test_run",
    "operation": "selfTest.registeredElement.run",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/self-tests/runs/:id/cancel",
    "routeKey": "POST /self-tests/runs/:id/cancel",
    "entity": "self_test_run",
    "operation": "selfTest.run.cancel",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/self-tests/runs/:id/cleanup",
    "routeKey": "POST /self-tests/runs/:id/cleanup",
    "entity": "self_test_run",
    "operation": "selfTest.run.cleanup",
    "mutating": true
  },
  {
    "method": "GET",
    "path": "/system/capabilities",
    "routeKey": "GET /system/capabilities",
    "entity": "application_deployment_head",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/system/recovery",
    "routeKey": "GET /system/recovery",
    "entity": "platform_incarnation",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/system/closure",
    "routeKey": "GET /system/closure",
    "entity": "activation_head",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/authority/lineages/:id",
    "routeKey": "GET /authority/lineages/:id",
    "entity": "authority_lineage",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/authority/lineages/:id/graph",
    "routeKey": "GET /authority/lineages/:id/graph",
    "entity": "authority_lineage",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/operation-intents/:id",
    "routeKey": "GET /operation-intents/:id",
    "entity": "operation_intent",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/operation-contexts/:id",
    "routeKey": "GET /operation-contexts/:id",
    "entity": "operation_context",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/operation-contexts/:id/action-plans",
    "routeKey": "GET /operation-contexts/:id/action-plans",
    "entity": "semantic_action_plan",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/operation-contexts/:id/value-derivations",
    "routeKey": "GET /operation-contexts/:id/value-derivations",
    "entity": "value_derivation",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/operation-contexts/:id/secret-uses",
    "routeKey": "GET /operation-contexts/:id/secret-uses",
    "entity": "secret_use_context",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/provenance/content/:id",
    "routeKey": "GET /provenance/content/:id",
    "entity": "content_provenance",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/provenance/content/:id/graph",
    "routeKey": "GET /provenance/content/:id/graph",
    "entity": "content_provenance",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agentic-security/events",
    "routeKey": "GET /agentic-security/events",
    "entity": "agentic_security_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "GET",
    "path": "/agentic-security/events/:id",
    "routeKey": "GET /agentic-security/events/:id",
    "entity": "agentic_security_event",
    "operation": null,
    "mutating": false
  },
  {
    "method": "POST",
    "path": "/agentic-security/self-tests",
    "routeKey": "POST /agentic-security/self-tests",
    "entity": "agentic_security_event",
    "operation": "agentic.security.event.record",
    "mutating": true
  },
  {
    "method": "POST",
    "path": "/agentic-security/evidence/export",
    "routeKey": "POST /agentic-security/evidence/export",
    "entity": "agentic_security_event",
    "operation": "agentic.security.evidence.export",
    "mutating": true
  }
] as const;
export type SsotEntityName = typeof SSOT_ENTITY_NAMES[number];
export type SsotRoute = typeof SSOT_ROUTES[number];
