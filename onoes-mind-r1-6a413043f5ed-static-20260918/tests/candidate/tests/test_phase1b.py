import json
import tempfile
import unittest
from pathlib import Path

from onoes_mind import Ledger, LedgerError


class Phase1BTests(unittest.TestCase):
    def setUp(self):
        self.ledger = Ledger()
        self.tokens = {}
        for principal in ("tripp", "echo", "cyony", "operator"):
            self.ledger.create_principal(principal)
            self.tokens[principal] = self.ledger.issue_credential(principal, principal + "-token")

    def tearDown(self):
        self.ledger.close()

    def env(self, event_id, claim="durable provenance fact", **extra):
        return {"event_id": event_id, "kind": "project_fact", "claim": claim,
                "project_id": "onoes-mind", "evidence_refs": [{
                    "type": "repository", "ref": "README.md", "content_hash": "sha256:abc"
                }], **extra}

    def test_receipt_and_provenance_are_durable_and_recalled(self):
        result = self.ledger.remember(self.tokens["tripp"], self.env("b1"))
        self.assertTrue(result["receipt_id"])
        row = self.ledger.db.execute("SELECT * FROM receipts WHERE receipt_id=?", (result["receipt_id"],)).fetchone()
        self.assertEqual(row["record_id"], result["record_id"])
        self.assertEqual(self.ledger.db.execute("SELECT COUNT(*) FROM provenance_refs").fetchone()[0], 1)
        found = self.ledger.search(self.tokens["tripp"], "durable")
        self.assertEqual(found[0]["provenance"][0]["content_hash"], "sha256:abc")

    def test_fts_input_is_bounded_and_syntax_is_not_interpreted(self):
        self.ledger.remember(self.tokens["tripp"], self.env("b2", claim="alpha beta"))
        self.assertEqual(self.ledger.search(self.tokens["tripp"], "alpha OR beta"), [])
        self.assertEqual(self.ledger.search(self.tokens["tripp"], "x " * 40), [])
        self.assertLessEqual(len(self.ledger.search(self.tokens["tripp"], "alpha", limit=999)), 20)

    def test_operator_purge_leaves_opaque_tombstone_and_deletion_chain(self):
        with tempfile.TemporaryDirectory() as folder:
            deletion = Path(folder) / "deletions.jsonl"
            ledger = Ledger(Path(folder) / "ledger.sqlite", deletion_ledger_path=deletion)
            for principal in ("tripp", "operator"):
                ledger.create_principal(principal)
            token = ledger.issue_credential("tripp", "tripp-token")
            operator = ledger.issue_credential("operator", "operator-token")
            result = ledger.remember(token, self.env("b3"))
            ledger.purge(operator, result["record_id"], confirmation="PURGE:" + result["record_id"])
            self.assertEqual(ledger.search(token, "durable"), [])
            self.assertTrue(ledger.verify_deletion_ledger())
            entry = json.loads(deletion.read_text().splitlines()[-1])
            self.assertNotIn("durable", json.dumps(entry))
            self.assertEqual(ledger.db.execute("SELECT state FROM memory_records").fetchone()[0], "purged")
            ledger.close()

    def test_restore_requires_newer_ledger_and_applies_deletions_before_open(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            deletion = root / "deletions.jsonl"
            source = Ledger(root / "source.sqlite", deletion_ledger_path=deletion)
            source.create_principal("tripp"); source.create_principal("operator")
            token = source.issue_credential("tripp", "tripp-token")
            operator = source.issue_credential("operator", "operator-token")
            result = source.remember(token, self.env("b4"))
            snapshot = root / "snapshot.sqlite"
            source.backup(snapshot)
            with self.assertRaises(LedgerError):
                Ledger.restore(snapshot, root / "blocked.sqlite", deletion)
            source.purge(operator, result["record_id"], confirmation="PURGE:" + result["record_id"])
            source.close()
            restored = Ledger.restore(snapshot, root / "restored.sqlite", deletion)
            self.assertEqual(restored.db.execute("SELECT state FROM memory_records").fetchone()[0], "purged")
            restored.close()

    def test_synthetic_agents_are_fixed_and_isolated(self):
        for agent in ("tripp", "echo", "cyony"):
            self.assertEqual(self.ledger.synthetic_fixture(agent), {
                "agent_id": agent, "event_id": "fixture-" + agent,
                "claim": "synthetic " + agent + " fixture", "scope": "agent/" + agent + "/private"
            })
        self.ledger.remember(self.tokens["tripp"], self.env("b5", claim="synthetic tripp fixture"))
        self.assertEqual(self.ledger.search(self.tokens["echo"], "synthetic"), [])

