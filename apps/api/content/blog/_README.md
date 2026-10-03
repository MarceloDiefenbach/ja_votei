# Como criar um post

1. Crie um arquivo `nome-do-post.md` nesta pasta. O nome vira a URL: `/blog/nome-do-post`
   (use só letras minúsculas, números e hífen).
2. Comece com o frontmatter:

```
---
title: Título do post (até ~60 caracteres para caber no Google)
description: Resumo de 120 a 160 caracteres. Aparece no resultado de busca.
date: 2026-10-03
updated: 2026-10-10        (opcional)
image: /cards/card-pt.webp (opcional, imagem de compartilhamento; caminho em /public ou URL)
tags: [eleições, foto de campanha]
draft: true                (opcional: true = só aparece em desenvolvimento e fica noindex)
---
```

3. Escreva o texto em Markdown (`##` para subtítulos; use um `#` só no título, que já vem do frontmatter).
4. Faça o commit e o deploy. O post entra sozinho no `/blog`, no `/sitemap.xml` e no `/blog/rss.xml`.

Arquivos que começam com `_` (como este) são ignorados.
