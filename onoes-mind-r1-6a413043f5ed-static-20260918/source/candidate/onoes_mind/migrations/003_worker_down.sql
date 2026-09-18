DROP TRIGGER IF EXISTS neurons_immutable_identity;
DROP TABLE IF EXISTS capability_registry;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS stage_executions;
DROP TABLE IF EXISTS work_items;
DROP TABLE IF EXISTS neurons;
DELETE FROM schema_migrations WHERE version=3;
