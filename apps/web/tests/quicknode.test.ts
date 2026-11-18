// Unit tests for QuickNode webhook verification and log extraction. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { decodeBody, extractLogs, signPayload, verifyQuickNodeSignature } from "../lib/quicknode-signature.ts";

const secret = "qnsec_test_token";
const nonce = "abc123";
const now = 1_763_500_000;
const timestamp = String(now);
const payload = JSON.stringify({ data: [[{ address: "0x1", topics: [], data: "0x", transactionHash: "0xaa", logIndex: "0x0", blockNumber: "0x10" }]] });

test("accepts a correctly signed delivery", () => {
  const signature = signPayload(secret, nonce, timestamp, payload);
  assert.deepEqual(verifyQuickNodeSignature({ secret, nonce, timestamp, signature, payload, nowSeconds: now }), { ok: true });
});

test("rejects a wrong secret, a tampered body, and missing headers", () => {
  const signature = signPayload("other", nonce, timestamp, payload);
  assert.equal(verifyQuickNodeSignature({ secret, nonce, timestamp, signature, payload, nowSeconds: now }).ok, false);

  const good = signPayload(secret, nonce, timestamp, payload);
  const tampered = verifyQuickNodeSignature({ secret, nonce, timestamp, signature: good, payload: payload + " ", nowSeconds: now });
  assert.equal(tampered.ok, false);

  const missing = verifyQuickNodeSignature({ secret, nonce: null, timestamp, signature: good, payload, nowSeconds: now });
  assert.deepEqual(missing.ok ? null : missing.status, 400);
});

test("rejects stale timestamps (replay protection)", () => {
  const signature = signPayload(secret, nonce, timestamp, payload);
  const r = verifyQuickNodeSignature({ secret, nonce, timestamp, signature, payload, nowSeconds: now + 3600 });
  assert.equal(r.ok, false);
});

test("gzipped bodies are verified against the decoded JSON", () => {
  const raw = gzipSync(Buffer.from(payload));
  const decoded = decodeBody(raw, "gzip");
  assert.equal(decoded, payload);
  const signature = signPayload(secret, nonce, timestamp, decoded);
  assert.equal(verifyQuickNodeSignature({ secret, nonce, timestamp, signature, payload: decoded, nowSeconds: now }).ok, true);
});

test("extractLogs finds logs at any nesting depth and parses hex numbers", () => {
  const logs = extractLogs({
    metadata: { dataset: "logs" },
    data: [
      [
        { address: "0xC0", topics: ["0x01"], data: "0x", transactionHash: "0xt1", logIndex: "0x2", blockNumber: "0x1f" },
      ],
      { logs: [{ address: "0xC0", topics: ["0x02"], data: "0x", transactionHash: "0xt2", logIndex: 0, blockNumber: 32 }] },
    ],
  });
  assert.equal(logs.length, 2);
  assert.equal(logs[0].logIndex, 2);
  assert.equal(logs[0].blockNumber, 31n);
  assert.equal(logs[1].blockNumber, 32n);
});
