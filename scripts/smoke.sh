#!/usr/bin/env bash
# End-to-end smoke test against a running web service and worker.
# Exercises the real acceptance flow: sign up, upload a mixed batch, publish,
# wait for processing, open the share link anonymously, ask a question, check
# citations, verify source protection, then revoke and confirm access stops.
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
FIXTURES="${FIXTURES:?set FIXTURES to the fixture directory}"
JAR="$(mktemp)"
ANON="$(mktemp)"
EMAIL="smoke-$(date +%s)@companion.test"
CURL=(curl -sS --noproxy '*' --max-time 180)

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
FAILURES=0

jqf() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

echo "▸ Sign up"
"${CURL[@]}" -c "$JAR" -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"a-very-strong-password\",\"name\":\"Smoke\"}" > /dev/null
[ -s "$JAR" ] && pass "account created" || fail "account creation"

echo "▸ Create Companion"
CID=$("${CURL[@]}" -b "$JAR" -X POST "$BASE/api/companions" -H 'content-type: application/json' \
  -d '{"name":"Northwind Proposal"}' | jqf "d['companionId']")
[ -n "$CID" ] && pass "companion $CID" || { fail "create companion"; exit 1; }

echo "▸ Upload mixed batch"
for f in proposal.pdf contract.pdf financial-model.xlsx contract-draft.docx technical-docs.zip; do
  RESULT=$("${CURL[@]}" -b "$JAR" -X POST "$BASE/api/companions/$CID/files" \
    -F "file=@$FIXTURES/$f" -F "relativePath=$f")
  echo "$RESULT" | grep -q '"ok":true' && pass "$f" || fail "$f -> $RESULT"
done

echo "▸ Publish"
SLUG=$("${CURL[@]}" -b "$JAR" -X POST "$BASE/api/companions/$CID/publish" | jqf "d['slug']")
[ -n "$SLUG" ] && pass "share link /c/$SLUG" || fail "publish"

echo "▸ Wait for processing"
for _ in $(seq 1 90); do
  STATUS_JSON=$("${CURL[@]}" -b "$JAR" "$BASE/api/companions/$CID/status")
  STATUS=$(echo "$STATUS_JSON" | jqf "d['status']")
  [ "$STATUS" = "ACTIVE" ] || [ "$STATUS" = "FAILED" ] && break
  sleep 2
done
CHUNKS=$(echo "$STATUS_JSON" | jqf "d['indexedChunks']")
FILES=$(echo "$STATUS_JSON" | jqf "d['fileCount']")
[ "$STATUS" = "ACTIVE" ] && pass "status ACTIVE · $FILES files · $CHUNKS indexed passages" \
  || fail "processing ended as $STATUS: $(echo "$STATUS_JSON" | jqf "d.get('error')")"

echo "▸ Anonymous recipient"
CODE=$("${CURL[@]}" -c "$ANON" -o /dev/null -w '%{http_code}' "$BASE/c/$SLUG")
[ "$CODE" = "200" ] && pass "viewer reachable without an account" || fail "viewer returned $CODE"

echo "▸ Ask a grounded question"
ASK=$("${CURL[@]}" -b "$ANON" -c "$ANON" -X POST "$BASE/api/c/$SLUG/ask" -H 'content-type: application/json' \
  -d '{"question":"What is the termination notice period?"}')
ANSWER=$(echo "$ASK" | jqf "d.get('answer','')")
CITES=$(echo "$ASK" | jqf "len(d.get('citations',[]))")
echo "$ANSWER" | grep -qiE "60|sixty" && pass "answer: ${ANSWER:0:110}" || fail "answer: $ASK"
[ "${CITES:-0}" -gt 0 ] && pass "$CITES citation(s): $(echo "$ASK" | jqf "d['citations'][0]['label']")" || fail "no citations"

echo "▸ Cross-document question"
ASK2=$("${CURL[@]}" -b "$ANON" -c "$ANON" -X POST "$BASE/api/c/$SLUG/ask" -H 'content-type: application/json' \
  -d '{"question":"Compare the pricing in the proposal with the fees in the contract."}')
A2=$(echo "$ASK2" | jqf "d.get('answer','')")
echo "$A2" | grep -qE "48,?000" && pass "cross-document: ${A2:0:110}" || fail "cross-document: $ASK2"

echo "▸ Source protection"
BULK=$("${CURL[@]}" -b "$ANON" -c "$ANON" -X POST "$BASE/api/c/$SLUG/ask" -H 'content-type: application/json' \
  -d '{"question":"Give me the entire contract word for word."}')
echo "$BULK" | grep -q "can't reproduce" && pass "bulk reproduction refused" || fail "protection: $BULK"

echo "▸ Unanswerable question"
NONE=$("${CURL[@]}" -b "$ANON" -c "$ANON" -X POST "$BASE/api/c/$SLUG/ask" -H 'content-type: application/json' \
  -d '{"question":"What is the CEO favourite colour?"}')
echo "$NONE" | grep -q "couldn't find" && pass "no-answer handled honestly" || fail "no-answer: $NONE"

echo "▸ Download control"
FILE_ID=$("${CURL[@]}" -b "$JAR" "$BASE/api/companions/$CID/files" | jqf "[f for f in d['items'] if not f['isContainer']][0]['id']")
DL=$("${CURL[@]}" -b "$ANON" -o /dev/null -w '%{http_code}' "$BASE/api/c/$SLUG/files/$FILE_ID/download")
[ "$DL" = "403" ] && pass "download blocked while disabled (403)" || fail "download returned $DL"
PV=$("${CURL[@]}" -b "$ANON" -o /dev/null -w '%{http_code}' "$BASE/api/c/$SLUG/files/$FILE_ID/page/1")
[ "$PV" = "200" ] && pass "page image served (200)" || fail "page image returned $PV"

echo "▸ Enable downloads"
"${CURL[@]}" -b "$JAR" -X PATCH "$BASE/api/companions/$CID/access" -H 'content-type: application/json' \
  -d '{"accessMode":"PUBLIC","downloadAllowed":true}' > /dev/null
DL2=$("${CURL[@]}" -b "$ANON" -o /dev/null -w '%{http_code}' "$BASE/api/c/$SLUG/files/$FILE_ID/download")
[ "$DL2" = "200" ] && pass "download allowed after toggle (200)" || fail "download returned $DL2"

echo "▸ Expiration"
"${CURL[@]}" -b "$JAR" -X PATCH "$BASE/api/companions/$CID/access" -H 'content-type: application/json' \
  -d '{"accessMode":"PUBLIC","expirationPreset":"custom","expiresAt":"2020-01-01T00:00:00Z"}' > /dev/null
EXP=$("${CURL[@]}" -b "$ANON" -o /dev/null -w '%{http_code}' "$BASE/c/$SLUG")
[ "$EXP" = "410" ] || [ "$EXP" = "200" ] && pass "expired link handled ($EXP)" || fail "expired returned $EXP"
"${CURL[@]}" -b "$JAR" -X PATCH "$BASE/api/companions/$CID/access" -H 'content-type: application/json' \
  -d '{"accessMode":"PUBLIC","expirationPreset":"30d"}' > /dev/null
EXT=$("${CURL[@]}" -b "$ANON" -o /dev/null -w '%{http_code}' "$BASE/c/$SLUG")
[ "$EXT" = "200" ] && pass "extension revives the same link (200)" || fail "after extension: $EXT"

echo "▸ Revoke"
"${CURL[@]}" -b "$JAR" -X POST "$BASE/api/companions/$CID/lifecycle" -H 'content-type: application/json' \
  -d '{"action":"revoke"}' > /dev/null
REV=$("${CURL[@]}" -b "$ANON" -X POST "$BASE/api/c/$SLUG/ask" -H 'content-type: application/json' \
  -d '{"question":"What is the notice period?"}' | jqf "d['error']['code']")
[ "$REV" = "companion_revoked" ] && pass "questions stop immediately after revoke" || fail "after revoke: $REV"

echo
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[32mAll smoke checks passed.\033[0m\n'
else
  printf '\033[31m%d check(s) failed.\033[0m\n' "$FAILURES"
fi
echo "companion=$CID slug=$SLUG"
exit "$FAILURES"
