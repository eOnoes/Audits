CREATE TABLE receipts(receipt_id TEXT PRIMARY KEY,event_id TEXT NOT NULL,principal_id TEXT NOT NULL REFERENCES principals,status TEXT NOT NULL,record_id TEXT,payload_hash TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE provenance_refs(provenance_id INTEGER PRIMARY KEY,record_id TEXT NOT NULL REFERENCES memory_records,revision_id INTEGER,evidence_type TEXT NOT NULL,locator TEXT NOT NULL,content_hash TEXT NOT NULL);
CREATE TABLE deletion_tombstones(tombstone_id TEXT PRIMARY KEY,record_id TEXT NOT NULL UNIQUE,opaque_fingerprint TEXT NOT NULL,purged_at TEXT NOT NULL);
