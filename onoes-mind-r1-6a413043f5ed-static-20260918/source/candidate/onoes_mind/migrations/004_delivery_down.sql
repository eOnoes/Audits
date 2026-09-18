DROP TABLE IF EXISTS delivery_receipts;
DROP TABLE IF EXISTS a2a_nonces;
DROP TABLE IF EXISTS inbox_messages;
DROP TABLE IF EXISTS outbox_messages;
DROP TABLE IF EXISTS a2a_permissions;
DROP TABLE IF EXISTS a2a_agents;
DELETE FROM schema_migrations WHERE version=4;
