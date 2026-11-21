# tools/balance/resume.sh: copied from work/cw/C1/resume.sh (X6, Nov 20) so the balance benches and their test
# fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
# C1b: run runc1.mjs for every character, skipping seeds already in the output file (restarts).
# bash tools/balance/resume.sh TREE out.jsonl tide seeds pick [chars]
#   TREE: a snapshot to bench, or - for this repo. out.jsonl is read and written where you run it.
T=$1; OUT=$2; TIDE=$3; N=$4; PICK=$5; CHARS=${6:-lamplighter harpooner punter bog_warden drowned_man tide_priest}
D=$(cd "$(dirname "$0")" && pwd)
[ "$T" = "-" ] && T=
for ch in $CHARS; do
  done=$( (grep -o "\"ch\":\"$ch\"" "$OUT" 2>/dev/null || true) | wc -l)
  [ "$done" -ge "$N" ] && continue
  TREE=$T node "$D/runc1.mjs" --chars $ch --from $done --seeds $((N-done)) --tide $TIDE --pick $PICK --out "$OUT"
done
