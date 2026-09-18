"""Regression checks for the September audit; synthetic data only."""
import json
import socket
import sqlite3
from unittest.mock import patch

import pytest

from onoes_mind import BridgeClient, BridgeServer, Ledger, LedgerError
from onoes_mind.bridge import PROTOCOL_VERSION, RUNTIME_FAMILY, _mac


@pytest.fixture
def ledger():
    instance = Ledger()
    for principal in ('operator', 'echo', 'cyony'):
        instance.create_principal(principal)
    yield instance
    instance.close()


def request(key):
    envelope = {
        'protocol_version': PROTOCOL_VERSION, 'request_id': 'audit-negotiation',
        'runtime_identity': {'agent_id': 'echo', 'runtime_family': RUNTIME_FAMILY,
                             'runtime_instance_id': 'synthetic-audit'},
        'capabilities': ['task.start'], 'operation': 'negotiate', 'payload': {},
    }
    envelope['auth'] = {'mac': _mac(envelope, key)}
    return envelope


def send(address, envelope):
    with socket.create_connection(address, timeout=3) as connection:
        connection.sendall(json.dumps(envelope).encode() + b'\n')
        return json.loads(connection.makefile('rb').readline())


@pytest.mark.parametrize('bad_auth', [None, {}, {'mac': 'invalid'}, {'mac': 123}])
def test_cached_replay_authenticates_before_returning_response(ledger, bad_auth):
    key = b'synthetic-audit-bridge-key'
    server = BridgeServer(ledger, auth_key=key)
    server.start()
    try:
        envelope = request(key)
        first = send(server.address, envelope)
        assert first['ok']
        assert send(server.address, envelope) == first
        envelope['auth'] = bad_auth
        denied = send(server.address, envelope)
        assert denied == {'ok': False, 'error': 'authentication failed'}
    finally:
        server.close()


def test_cached_replay_rechecks_current_key(ledger):
    server = BridgeServer(ledger, auth_key=b'synthetic-before-key')
    server.start()
    try:
        envelope = request(server.auth_key)
        assert send(server.address, envelope)['ok']
        server.auth_key = b'synthetic-after-key'
        assert send(server.address, envelope)['ok'] is False
        envelope['auth'] = {'mac': _mac(envelope, server.auth_key)}
        assert send(server.address, envelope)['ok']
    finally:
        server.close()


def claim(ledger):
    ledger.create_work_item('audit-task', 'operator', 'onoes-mind', 'audit', 'audit-task')
    ledger.add_stage('audit-task', 'main', 1, 'audit', input_context_ref='artifact:input')
    return ledger.claim_stage('echo', lease_seconds=60)


@pytest.mark.parametrize('operation', ['complete', 'heartbeat', 'fail'])
@pytest.mark.parametrize('offset', [0, 1])
def test_expiry_fences_mutation_without_recovery(ledger, operation, offset):
    stage = claim(ledger)
    before = '\n'.join(ledger.db.iterdump())
    args = (stage['stage_execution_id'], 'echo', stage['lease_version'])
    with patch('onoes_mind.ledger.time.time', return_value=stage['lease_expires_at'] + offset):
        with pytest.raises(LedgerError, match='stale lease'):
            if operation == 'complete':
                ledger.complete_stage(*args, {'result': 'synthetic'})
            elif operation == 'heartbeat':
                ledger.heartbeat(*args)
            else:
                ledger.fail_stage(*args, 'interrupted', retryable=True)
    assert '\n'.join(ledger.db.iterdump()) == before


@pytest.mark.parametrize('operation', ['complete', 'fail'])
def test_expiry_is_rechecked_inside_write_transaction(ledger, operation):
    stage = claim(ledger)
    before = '\n'.join(ledger.db.iterdump())
    deadline = stage['lease_expires_at']
    args = (stage['stage_execution_id'], 'echo', stage['lease_version'])
    with patch('onoes_mind.ledger.time.time', side_effect=[deadline - 1, deadline]):
        with pytest.raises(LedgerError, match='stale lease'):
            if operation == 'complete':
                ledger.complete_stage(*args, {'result': 'synthetic'})
            else:
                ledger.fail_stage(*args, 'interrupted', retryable=True)
    assert '\n'.join(ledger.db.iterdump()) == before


@pytest.mark.parametrize('recovery', [False, True])
def test_retry_transition_is_atomic_and_preserves_input(ledger, recovery):
    stage = claim(ledger)
    ledger.db.execute("CREATE TEMP TRIGGER deny_retry BEFORE INSERT ON stage_executions WHEN NEW.attempt_no=2 BEGIN SELECT RAISE(ABORT, 'injected retry failure'); END")
    before = '\n'.join(ledger.db.iterdump())
    with pytest.raises(sqlite3.IntegrityError, match='injected retry failure'):
        if recovery:
            ledger.recover_expired_leases(now=stage['lease_expires_at'])
        else:
            ledger.fail_stage(stage['stage_execution_id'], 'echo', stage['lease_version'], 'interrupted', retryable=True, backoff_seconds=0)
    assert '\n'.join(ledger.db.iterdump()) == before
    ledger.db.execute('DROP TRIGGER deny_retry')
    if recovery:
        assert ledger.recover_expired_leases(now=stage['lease_expires_at']) == 1
    else:
        ledger.fail_stage(stage['stage_execution_id'], 'echo', stage['lease_version'], 'interrupted', retryable=True, backoff_seconds=0)
    next_stage = ledger.claim_stage('cyony', now=stage['lease_expires_at'] + 1)
    assert next_stage['input_context_ref'] == 'artifact:input'


@pytest.mark.parametrize('payload_kind', ['value', 'nested', 'key'])
def test_worker_secret_rejection_has_no_durable_side_effects(ledger, payload_kind):
    stage = claim(ledger)
    secret = 'sk-' + 'SyntheticAuditOnly' * 2
    payload = {'value': secret} if payload_kind == 'value' else ({'nested': [{'value': secret}]} if payload_kind == 'nested' else {secret: 'value'})
    before = '\n'.join(ledger.db.iterdump())
    with pytest.raises(LedgerError, match='credential-like content') as error:
        ledger.complete_stage(stage['stage_execution_id'], 'echo', stage['lease_version'], payload)
    assert secret not in str(error.value)
    assert '\n'.join(ledger.db.iterdump()) == before
    result = ledger.complete_stage(stage['stage_execution_id'], 'echo', stage['lease_version'], {'result': 'sanitized'})
    assert result['receipt_id']


@pytest.mark.parametrize('state,expected', [('active', 'BLOCKED'), ('promoted', 'BLOCKED'), ('purged', 'PASS')])
def test_integrity_requires_current_revision_for_live_records(ledger, state, expected):
    token = ledger.issue_credential('echo', 'synthetic-audit-token')
    record = ledger.remember(token, {'event_id': 'audit-memory', 'claim': 'synthetic fact', 'kind': 'knowledge', 'project_id': 'onoes-mind'})['record_id']
    assert ledger.integrity_report()['status'] == 'PASS'
    ledger.db.execute('UPDATE memory_records SET state=? WHERE record_id=?', (state, record))
    ledger.db.execute('DELETE FROM memory_revisions WHERE record_id=?', (record,))
    assert ledger.integrity_report()['status'] == expected
