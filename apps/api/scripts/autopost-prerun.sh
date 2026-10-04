cd "$MAESTRI_WORKSPACE_DIR" 2>/dev/null || cd /Users/marcelodiefenbach/Desktop/PROJETOS/ja_votei || exit 1
[ -f apps/api/content/blog/_STOP ] && exit 1
[ "$(git branch --show-current)" = "main" ] || exit 1
[ -z "$(git status --porcelain apps/api/content/blog | grep -v '_AUTOPOST')" ] || exit 1
echo "Hoje: $(date +%F)"
echo "Posts existentes ($(ls apps/api/content/blog/*.md | grep -vc '/_')):"
ls apps/api/content/blog/*.md | grep -v '/_' | sed 's#.*/##; s#\.md$##' | sort | tr '\n' ' '
