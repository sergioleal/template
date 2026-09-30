# Prompts: agente que agenda shows da banda Ipê Roxo

A **Ipê Roxo** é uma banda fictícia de forró-rock de Brasília. Estes prompts servem para uma IA com a skill
`agentikal-no` (Claude Code, Codex, Cursor) criar o agente de agenda da banda, subir e publicar no hub. Cole um
deles no chat da ferramenta, dentro deste repositório.

- **Prompt 1** é completo: já traz as regras de negócio, e a IA só pergunta o que for da infraestrutura.
- **Prompt 2** é curto: a IA conduz a conversa e pergunta tudo.
- Os outros mudam o agente depois de publicado.

Todos os valores, datas e nomes são inventados.

---

## Prompt 1: completo (agente + infra + publicação)

```text
Use a skill agentikal-no. Quero criar, subir e publicar no hub do Agentikal um agente que agenda shows da banda
fictícia Ipê Roxo (forró-rock, Brasília-DF). Deixe claro na descrição que é uma banda fictícia de demonstração.

Identidade do agente
- Nome: Agenda Ipê Roxo
- Pasta e endereço: agenda-ipe-roxo
- Resumo: Agenda shows da banda Ipê Roxo (forró-rock de Brasília): datas livres, orçamento, pré-reserva e confirmação.
- Tags: comece por uma de categoria que já exista no hub para música ao vivo ou shows (npm run tags -- show; se não
  houver, use "shows-ao-vivo"), depois "banda", "forro", "df".
- O agente de exemplo reserva-salas não é necessário: apague a pasta dele.

A banda
- 6 integrantes: Lia Cardoso (voz), Téo Brandão (sanfona), Nina Sá (guitarra), Caio Rezende (baixo),
  Duda Mota (bateria) e Rafa Lins (zabumba e percussão).
- Repertório autoral e releituras de forró e rock nacional. Formatos: "completo" (6 integrantes) e "acústico"
  (voz, sanfona e percussão; 30% mais barato).
- Rider técnico do formato completo: palco de 6x4 m, PA para o público informado, 4 retornos, 1 técnico de som
  da casa. O acústico não exige palco nem PA acima de 200 pessoas.

Regras de preço (em reais)
- Cachê base por tipo de evento, formato completo:
  - bar ou pub: 3.500 (até 2 h);
  - festa privada ou casamento: 8.000 (até 3 h);
  - evento corporativo: 10.000 (até 2 h);
  - festival: 12.000 (até 1 h 30).
- Hora extra: 25% do cachê base por hora ou fração, no máximo 2 horas extras.
- Público acima de 1.000 pessoas: mais 20% (reforço de equipe).
- Deslocamento: DF sem custo; GO e MG (entorno, até 300 km) mais 1.500; outros estados mais 4.000.
- Sinal de 30% na pré-reserva; o restante até 3 dias antes do show.

Como calcular (para não haver dúvida)
- Formato acústico: 30% a menos sobre o cachê base; a hora extra é 25% do cachê base já com o desconto.
- Ordem: cachê base (com desconto, se acústico) + horas extras; o adicional de 20% por público acima de 1.000
  incide sobre essa soma; o deslocamento entra por último, sem adicional.
- Total = cachê + horas extras + adicional de público + deslocamento. Sinal = 30% do total, arredondado para o
  real mais próximo.
- A duração pedida acima da incluída no tipo vira hora extra (fração conta como hora cheia); acima de 2 horas
  extras, recuse e diga a duração máxima.
- O "até 300 km" do entorno é informativo: a regra usa só a UF (GO e MG = entorno).
- Rider do acústico: não precisa de palco; precisa de PA só para público acima de 200 pessoas.

Regras de agenda
- No máximo 1 show por dia; não toca às segundas-feiras (mas segunda pode ser dia de viagem).
- Show fora do DF exige o dia anterior e o seguinte livres (viagem); esses dias ficam bloqueados para outros shows.
- Datas já ocupadas (fictícias, todas no DF, sem dias de viagem em volta): 2026-10-10, 2026-10-17, 2026-10-31,
  2026-11-14, 2026-11-15, 2026-11-28, 2026-12-05, 2026-12-12, 2026-12-19, 2026-12-31.
- Pré-reserva segura a data por 72 horas; sem confirmação, a data volta a ficar livre. O sinal é pago na
  confirmação (o confirmar_show recebe o comprovante).
- Cancelamento com 30 dias ou mais de antecedência devolve o sinal; com menos de 30, o sinal fica com a banda.
  Cancelar uma pré-reserva ainda não confirmada só libera a data.
- Hora atual: use a variável de ambiente AGORA (ISO), se definida, no lugar do relógio, para dar para testar a
  validade da cotação (7 dias) e da pré-reserva (72 h).

Ferramentas (dados em memória, como no exemplo reserva-salas)
- sobre_a_banda {}: integrantes, formatos, repertório e rider. Consulta.
- consultar_agenda { mes: "AAAA-MM" }: dias livres e ocupados do mês, com o motivo quando não dá (segunda, show,
  viagem). Consulta.
- cotar_show { data, cidade, uf, tipo, formato?, duracao_horas?, publico? }: confere a agenda e devolve o orçamento
  detalhado (cachê, hora extra, adicional de público, deslocamento, total, sinal) e um cotacao_id válido por 7 dias.
  Não compromete a data. Sem compromisso.
- pre_reservar { cotacao_id, contratante, contato }: segura a data por 72 h e informa o sinal. Compromisso.
- confirmar_show { codigo, comprovante_sinal }: confirma a pré-reserva e devolve o contrato resumido. Compromisso.
- cancelar { codigo, motivo }: cancela e diz se o sinal é devolvido. Compromisso.
Erros com isError e o que fazer (ex.: "data ocupada: livres mais próximas são ...").

Exemplos para o /ex
- "Quais sábados de novembro a Ipê Roxo tem livres?"
- "Quanto a Ipê Roxo cobra para tocar 3 horas num casamento em Brasília dia 21/11?"
- "Faz um orçamento da Ipê Roxo acústica para um bar em Goiânia, 2 horas, dia 24/10."
- "Pré-reserva a Ipê Roxo para o casamento do dia 21/11 no nome de Ana Souza."
- "Me mostra o rider técnico da Ipê Roxo."

Testes antes de publicar
- casamento no DF num sábado livre, 3 h, 150 pessoas;
- bar em Goiânia acústico, 2 h;
- data ocupada (2026-10-10), segunda-feira e show fora do DF colado numa data ocupada;
- pré-reserva, confirmação e cancelamento com e sem devolução do sinal;
- com AGORA adiantado: cotação vencida (mais de 7 dias) e pré-reserva expirada (mais de 72 h).
Conferência à mão: casamento DF 3 h 150 pessoas = 8.000 (sinal 2.400); bar acústico em Goiânia 2 h = 2.450 +
1.500 = 3.950 (sinal 1.185); corporativo DF 3 h 30 1.200 pessoas = (10.000 + 2 × 2.500) × 1,2 = 18.000 (sinal 5.400).

Depois de testado: suba a infra do meu nó (se ainda não existir) e publique. Pergunte o que for da infraestrutura
(VM, domínio, nome do nó) e pare nos passos que são meus.
```

---

## Prompt 2: curto (a IA pergunta)

```text
Use a skill agentikal-no. Quero um agente que agenda shows de uma banda fictícia chamada Ipê Roxo, de Brasília.
Me faça as perguntas que precisar sobre a banda, os preços e a agenda, sugira valores razoáveis quando eu não
souber, escreva e teste o agente, suba tudo e publique no hub.
```

---

## Prompt 3: só o agente, num nó que já está no ar

```text
Use a skill agentikal-no. Meu nó já está no ar (confira com npm run estado). Crie o agente agenda-ipe-roxo com as
regras do arquivo exemplos/agenda-de-shows.md (Prompt 1), teste localmente, leve para a VM e publique.
```

---

## Prompt 4: versão nova com uma ferramenta a mais

```text
Use a skill agentikal-no. No agente agenda-ipe-roxo, acrescente a ferramenta sugerir_datas { tipo, uf, mes, quantas? }
(consulta): devolve as melhores datas livres para aquele tipo de evento, com o total estimado de cada uma, dando
preferência a sextas e sábados. Publique como versão 1.1.0 e me mostre a diferença para a 1.0.0.
```

---

## Prompt 5: mudança de preço (versão de correção)

```text
Use a skill agentikal-no. A Ipê Roxo reajustou o cachê de bar ou pub para 4.000 e o deslocamento para GO e MG
para 1.800. Atualize o agente agenda-ipe-roxo, ajuste os testes e publique como versão 1.0.1.
```

---

## Para testar no chat do hub, depois de publicado

Com o agente no hub, o agente pessoal de qualquer pessoa pode usá-lo. Frases para mandar a ele:

- "Quero contratar uma banda de forró para um casamento em Brasília em novembro. Quem tem data?"
- "Pede à @agenda-ipe-roxo.<seu-nó> o orçamento de um evento corporativo para 1.200 pessoas no dia 20/11."
- "Compara o formato completo e o acústico da Ipê Roxo para um bar, 2 horas, dia 24/10."
- "Pré-reserva a data." (o agente pessoal pede o Confirmar antes)

Lembre: para o chat do hub conversar com o agente, o administrador do hub precisa liberar o host `MCP` do seu nó.
