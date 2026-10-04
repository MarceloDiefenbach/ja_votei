# Publicação automática de posts (rotina a cada 30 minutos)

**Para PARAR a rotina:** crie o arquivo `apps/api/content/blog/_STOP` (`touch apps/api/content/blog/_STOP`) ou desative a rotina "Post do blog a cada 30 min" no Maestri. Apague o arquivo para retomar.

## O que fazer em cada disparo (1 post por vez)

1. Veja a lista de posts existentes recebida no disparo (e `ls apps/api/content/blog`). Escolha UM tema novo, útil e diferente de todos os existentes (nada de variação do mesmo assunto).
2. **Se não houver mais tema realmente novo e útil, NÃO publique nada**: apenas responda "sem tema novo" e pare. Prefira não publicar a publicar texto repetido ou fraco.
3. Escreva o post em `apps/api/content/blog/<slug>.md` (slug em kebab-case, sem acentos), no formato dos posts existentes. Não coloque `draft`. `date` = a data de HOJE (formato AAAA-MM-DD). `tags`: 3 a 5, em português correto.
4. Rode `python3 apps/api/scripts/check-post.py apps/api/content/blog/<slug>.md`. Se der ERRO, corrija o texto e rode de novo. Se não conseguir deixar `OK` em 2 tentativas, apague o arquivo e pare, sem commit.
5. Só então: `git pull --rebase origin main`, `git add apps/api/content/blog/<slug>.md` (somente esse arquivo), `git commit` com a mensagem `feat(blog): novo post <slug>` + a linha de co-autoria padrão, e `git push origin main`. Se o push falhar, faça `git pull --rebase` e tente uma vez mais; se falhar de novo, pare e avise.
6. Não mexa em nenhum outro arquivo. Não rode deploy. Não publique se `git status` mostrar mudanças não relacionadas na pasta de posts.

## Regras de conteúdo (obrigatórias)

- Português do Brasil correto, frases simples e completas. 600 a 900 palavras, subtítulos `##` (nunca `#` no corpo), listas, e uma seção `## Perguntas frequentes` com 3 a 4 perguntas em negrito e resposta curta.
- **Apartidário.** Nunca peça voto nem elogie/critique candidato, partido, governo ou pessoa pública. Não cite nomes de políticos.
- **Só conceito e utilidade prática. Sem afirmar regra legal específica**: nada de datas, prazos, valores, multas, números de artigo ou de lei, horários, percentuais. Quando o tema depender de regra, escreva o conceito e "confira no site do TSE (tse.jus.br)". Em dúvida sobre um fato, **não afirme**.
- Nada de repetir linhas ou parágrafos para encher. Nada de palavras em outro idioma.
- No fim, uma frase discreta convidando a criar a foto "Eu já votei" no Já Votei. Sem exagero.
- Temas bons: educação cívica, como o poder funciona (conceitos), mídia e checagem, participação, convivência, hábitos de informação, uso seguro da internet. Temas ruins: qualquer coisa que exija regra eleitoral exata, previsão de resultado, opinião sobre candidatos, saúde ou direito individual.
