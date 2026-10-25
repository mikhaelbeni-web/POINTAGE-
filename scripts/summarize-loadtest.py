#!/usr/bin/env python3
"""Résume un fichier de résultats (une ligne JSON par passage) : médiane des passages, par version."""
import json, sys, statistics as st
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip().startswith("{")]
by = {}
for r in rows: by.setdefault(r["label"].split(" ")[0], []).append(r)
def med(rs, path):
    v = []
    for r in rs:
        x = r
        for k in path: x = x[k]
        v.append(x)
    return st.median(v)
print(f"{'':8} {'arrivée p50':>12} {'arrivée p95':>12} {'départ p50':>11} {'départ p95':>11} {'calculs diff. (s)':>18} {'doublons':>9} {'pointages':>10}")
for lab, rs in by.items():
    print(f"{lab:8} {med(rs,['arrival','p50']):>10.0f}ms {med(rs,['arrival','p95']):>10.0f}ms {med(rs,['departure','p50']):>9.0f}ms {med(rs,['departure','p95']):>9.0f}ms {med(rs,['backgroundSettleMs'])/1000:>17.1f} {sum(r['duplicates'] for r in rs):>9} {min(r['punchDocs'] for r in rs):>5}/{rs[0]['expectedPunchDocs']}")
print(f"passages par version : { {k: len(v) for k, v in by.items()} }")
