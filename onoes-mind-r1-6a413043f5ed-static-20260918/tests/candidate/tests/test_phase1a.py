import tempfile
import unittest
from pathlib import Path

from onoes_mind import Ledger, LedgerError


class Phase1ATests(unittest.TestCase):
    def setUp(self):
        self.ledger = Ledger()
        self.tokens = {}
        for principal in ("tripp", "echo", "cyony", "operator"):
            self.ledger.create_principal(principal)
            self.tokens[principal] = self.ledger.issue_credential(principal, principal + "-token")

    def tearDown(self):
        self.ledger.close()

    def env(self, event_id, claim="SQLite is canonical", **extra):
        return {"event_id": event_id, "kind": "project_fact", "claim": claim, "project_id": "onoes-mind", **extra}

    def test_server_identity_and_private_scope(self):
        result = self.ledger.remember(self.tokens["tripp"], self.env("e1", requested_visibility="shared"))
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(self.ledger.search(self.tokens["echo"], "SQLite"), [])
        self.assertEqual(len(self.ledger.search(self.tokens["tripp"], "SQLite")), 1)

    def test_forged_private_scope_hint_cannot_select_another_agent(self):
        result = self.ledger.remember(self.tokens["tripp"], self.env("e1b", requested_visibility="agent/echo/private"))
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(self.ledger.search(self.tokens["echo"], "SQLite"), [])

    def test_operator_shared_read(self):
        result = self.ledger.remember(self.tokens["operator"], self.env("e2", requested_visibility="shared"))
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(len(self.ledger.search(self.tokens["echo"], "SQLite")), 1)

    def test_secret_rejected_without_content_persistence(self):
        secret = "sk-" + "abcdefghijklmnopqrstuvwxyz123456"
        result = self.ledger.remember(self.tokens["tripp"], self.env("e3", claim=f"use {secret}"))
        self.assertEqual(result["status"], "rejected_secret")
        retry = self.ledger.remember(self.tokens["tripp"], self.env("e3", claim=f"use {secret}"))
        self.assertEqual(retry["status"], "rejected_secret")
        self.assertEqual(self.ledger.db.execute("SELECT COUNT(*) FROM memory_records").fetchone()[0], 0)
        self.assertEqual(self.ledger.db.execute("SELECT COUNT(*) FROM memory_fts").fetchone()[0], 0)
        self.assertNotIn("sk-", str(dict(self.ledger.db.execute("SELECT * FROM secret_incidents").fetchone())))

    def test_first_write_wins_duplicate_and_divergence(self):
        self.assertEqual(self.ledger.remember(self.tokens["tripp"], self.env("e4"))["status"], "accepted")
        self.assertEqual(self.ledger.remember(self.tokens["tripp"], self.env("e4"))["status"], "accepted")
        self.assertEqual(self.ledger.remember(self.tokens["tripp"], self.env("e4", claim="changed"))["status"], "idempotent_replay_divergence")
        self.assertEqual(self.ledger.db.execute("SELECT COUNT(*) FROM memory_records").fetchone()[0], 1)

    def test_rotation_rejects_old_token(self):
        self.ledger.rotate_credentials("tripp")
        with self.assertRaises(LedgerError):
            self.ledger.authenticate(self.tokens["tripp"])

    def test_migration_rollback(self):
        with tempfile.TemporaryDirectory() as folder:
            ledger = Ledger(Path(folder) / "ledger.sqlite")
            ledger.rollback()
            self.assertFalse(ledger._table_exists("principals"))
            ledger.close()

    def test_audit_chain_is_verifiable(self):
        self.ledger.remember(self.tokens["tripp"], self.env("e5"))
        self.assertTrue(self.ledger.verify_audit_chain())


if __name__ == "__main__":
    unittest.main()
