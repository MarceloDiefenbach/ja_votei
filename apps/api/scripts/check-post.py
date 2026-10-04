#!/usr/bin/env python3
"""Verificador de post do blog. Uso: python3 apps/api/scripts/check-post.py <arquivo.md> [...]
Sai com código 1 se algum post tiver problema (o publicador automático NÃO deve fazer push nesse caso)."""
import re, sys, os, glob

BLOG = os.path.join(os.path.dirname(__file__), "../content/blog")
OK_EXTRA = set("áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÉÈÊÍÓÒÔÕÚÇ“”‘’«»–—…•·°ªº§")
FOREIGN = re.compile(r"\b(the|and|should|with|computer|verify|gradient|relating|documentation|retain|peace|anybody|attitudes|happen|information|información|treat|voter|vaccination|tutto|certaines|peticiones|proposes|personal|electoral|representatives)\b", re.I)
RISK = re.compile(r"multa|\bart\.? ?\d|artigo \d|\blei n[º°.]|\blei \d|r\$ ?\d|\d{1,2} de (janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)|\b\d+ (dias|anos|horas|meses)\b", re.I)

def check(path):
    errs = []
    raw = open(path, encoding="utf8").read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)
    if not m:
        return ["sem frontmatter"]
    head = dict(l.split(":", 1) for l in m.group(1).split("\n") if ":" in l)
    head = {k.strip(): v.strip().strip('"') for k, v in head.items()}
    body = m.group(2)
    slug = os.path.basename(path)[:-3]
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug): errs.append("slug inválido (kebab-case sem acentos)")
    t, d = head.get("title", ""), head.get("description", "")
    if not t or len(t) > 60: errs.append(f"title ausente ou > 60 chars ({len(t)})")
    if not 120 <= len(d) <= 160: errs.append(f"description fora de 120-160 chars ({len(d)})")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", head.get("date", "")): errs.append("date inválida (AAAA-MM-DD)")
    if "draft" in head: errs.append("campo draft não deve existir em post publicado")
    tags = [x.strip() for x in head.get("tags", "").strip("[]").split(",") if x.strip()]
    if not 3 <= len(tags) <= 5: errs.append("tags: use de 3 a 5")
    words = len(body.split())
    if words < 550 or words > 950: errs.append(f"palavras fora de 550-950 ({words})")
    if re.search(r"^# ", body, re.M): errs.append("não use # no corpo")
    if not re.search(r"^## Perguntas frequentes", body, re.M): errs.append('falta "## Perguntas frequentes"')
    if "Já Votei" not in body: errs.append("falta o convite discreto ao Já Votei")
    if len(re.findall(r"^## ", body, re.M)) < 3: errs.append("poucos subtítulos (##)")
    for i, line in enumerate(raw.split("\n"), 1):
        for ch in set(line):
            if ord(ch) > 127 and ch not in OK_EXTRA and not ch.isspace(): errs.append(f"linha {i}: caractere estranho {ch!r}")
        if FOREIGN.search(line) and not line.startswith(("title:", "description:", "tags:")): errs.append(f"linha {i}: palavra estrangeira {FOREIGN.search(line).group(0)!r}")
        if re.search(r"\b(\w{3,})\s+\1\b", line, re.I): errs.append(f"linha {i}: palavra repetida")
        if re.search(r"[a-zà-ú]{2}[A-Z]{2,}|\w_\w", line): errs.append(f"linha {i}: texto colado/estranho")
        if re.search(r"\.\.(?!\.)", line): errs.append(f"linha {i}: ponto duplo")
        if RISK.search(line) and not line.startswith(("date:",)): errs.append(f"linha {i}: número/data/lei/valor ({RISK.search(line).group(0)!r}); trate só o conceito e mande conferir no TSE")
    longs = [l.strip() for l in body.split("\n") if len(l.strip()) > 40]
    if len(longs) != len(set(longs)): errs.append("há linhas longas repetidas")
    # título/slug não pode já existir
    for other in glob.glob(os.path.join(BLOG, "*.md")):
        if os.path.abspath(other) == os.path.abspath(path) or os.path.basename(other).startswith("_"): continue
        o = open(other, encoding="utf8").read()
        if re.search(r"^title: " + re.escape(t) + r"$", o, re.M): errs.append(f"título já existe em {os.path.basename(other)}")
    return errs

bad = 0
for p in sys.argv[1:]:
    e = check(p)
    print(("OK    " if not e else "ERRO  ") + os.path.basename(p))
    for x in e: print("   - " + x)
    bad += bool(e)
sys.exit(1 if bad else 0)
