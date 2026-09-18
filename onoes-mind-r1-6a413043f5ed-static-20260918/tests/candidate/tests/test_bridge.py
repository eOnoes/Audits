import json
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

from onoes_mind import BridgeClient, BridgeError, BridgeServer, Ledger


KEY = b"bridge-test-key"


def _echo_process(address):
    script = """
import json, sys
from onoes_mind import BridgeClient
c = BridgeClient((sys.argv[1], int(sys.argv[2])), agent_id='echo', runtime_instance_id='echo-p1', auth_key=b'bridge-test-key')
started = c.call('start_task', {'task_id': 'task-echo-stop', 'objective': 'deterministic local handoff'}, request_id='echo-start')
claim = c.call('claim_task', request_id='echo-claim')['claim']
heartbeat = c.call('heartbeat', {'stage_execution_id': claim['stage_execution_id'], 'lease_version': claim['lease_version']}, request_id='echo-heartbeat')
stopped = c.call('stop_task', {'stage_execution_id': claim['stage_execution_id'], 'lease_version': claim['lease_version']}, request_id='echo-stop')
print(json.dumps({'started': started, 'claim': claim, 'heartbeat': heartbeat, 'stopped': stopped}, sort_keys=True))
"""
    return subprocess.run([sys.executable, "-c", script, address[0], str(address[1])], capture_output=True, text=True, check=True)


def test_authenticated_process_boundary_and_capability_negotiation():
    ledger = Ledger()
    server = BridgeServer(ledger, auth_key=KEY)
    server.start()
    try:
        client = BridgeClient(server.address, agent_id="echo", runtime_instance_id="echo-test", auth_key=KEY)
        result = client.call("negotiate", capabilities=["task.start", "native_store.write", "task.complete"], request_id="negotiation-1")
        assert result["capabilities"] == ["task.complete", "task.start"]
        assert client.call("negotiate", capabilities=["task.start", "native_store.write", "task.complete"], request_id="negotiation-1") == result
        with pytest.raises(BridgeError, match="replay divergence"):
            client.call("negotiate", capabilities=["task.start"], request_id="negotiation-1")
        with pytest.raises(BridgeError, match="authentication failed"):
            BridgeClient(server.address, agent_id="echo", runtime_instance_id="bad", auth_key=b"wrong").call("negotiate", request_id="bad-auth")
        with pytest.raises(BridgeError, match="forbidden field"):
            client.call("start_task", {"task_id": "bad", "objective": "x", "command": "do-not-run"}, request_id="denied-command")
        with pytest.raises(BridgeError, match="payload structure"):
            client.call("start_task", {"task_id": "bad", "objective": [[[[[[[[[["deep"]]]]]]]]]]}, request_id="denied-depth")
        with pytest.raises(BridgeError, match="lease_seconds"):
            client.call("claim_task", {"lease_seconds": 3601}, request_id="denied-lease")
    finally:
        server.close()
        ledger.close()


def test_echo_stop_tripp_resume_is_deterministic_and_fenced():
    db_path = Path.cwd() / (".bridge-test-" + uuid.uuid4().hex + ".sqlite")
    ledger = Ledger(db_path)
    ledger.create_principal("operator")
    ledger.create_principal("echo")
    ledger.create_principal("tripp")
    server = BridgeServer(ledger, auth_key=KEY)
    server.start()
    try:
        echo = _echo_process(server.address)
        evidence = json.loads(echo.stdout)
        claim = evidence["claim"]
        assert evidence["started"]["state"] == "PENDING"
        assert evidence["heartbeat"]["stage"]["lease_owner"] == "echo"
        assert evidence["stopped"]["stop"]["state"] == "RETRY_WAIT"

        tripp = BridgeClient(server.address, agent_id="tripp", runtime_instance_id="tripp-p1", auth_key=KEY)
        resumed = tripp.call("claim_task", {"lease_seconds": 60}, request_id="tripp-claim")["claim"]
        assert resumed["stage_execution_id"] != claim["stage_execution_id"]
        with pytest.raises(BridgeError, match="stale lease"):
            BridgeClient(server.address, agent_id="echo", runtime_instance_id="echo-p1", auth_key=KEY).call(
                "complete_task", {"stage_execution_id": claim["stage_execution_id"], "lease_version": claim["lease_version"], "result": {"late": True}}, request_id="echo-late-complete")
        completed = tripp.call("complete_task", {"stage_execution_id": resumed["stage_execution_id"], "lease_version": resumed["lease_version"], "result": {"verdict": "PASS"}}, request_id="tripp-complete")["completion"]
        assert completed["receipt_id"]
        assert ledger.get_work("task-echo-stop")["current_state"] == "COMPLETED"
        assert ledger.db.execute("SELECT COUNT(*) FROM receipts WHERE work_code='task-echo-stop'").fetchone()[0] == 1
    finally:
        server.close()
        ledger.close()
        for path in (db_path, Path(str(db_path) + "-wal"), Path(str(db_path) + "-shm"), Path(str(db_path) + ".deletions.jsonl")):
            path.unlink(missing_ok=True)
