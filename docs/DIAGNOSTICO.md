# Diagnóstico do fluxo atual — Clinicenter Agendamento Inteligente (n8n)

## Como o fluxo funciona hoje
Webhook Evolution → extrai telefone → consulta/cria `dados_cliente` → filtra mensagem do humano (pausa) → debounce no Redis (espera 25 s) → espera 15 s ("gerente") → lê o setor → agente **Marcelia** (gpt-4.1 + 5 tools) → um 2º LLM só para fatiar o texto → envia mensagem por mensagem com 4,2 s de delay + 10 s de espera entre cada → grava histórico em 3 lugares.

## Bugs que afetam vendas (corrigir primeiro)

| # | Problema | Efeito |
|---|----------|--------|
| 1 | O gatilho de pausa é "resposta **contém** `55`". O telefone da clínica (`88 99660-8355`), preços (R$ 155) e horários caem nessa regra. | A IA se pausa sozinha e o lead fica sem resposta. |
| 2 | O endereço no sub-agente "Cerebro" é *Rua Sergipe 2025, Savassi, Belo Horizonte*. O prompt diz *R. Divino Salvador, 187, Barbalha*. | Pode mandar o paciente para outra cidade. |
| 3 | `Code in JavaScript` espera JSON com `intencao`, `score` e `especialidade`, mas a Marcelia responde texto puro. | `intencao`, `score` e `especialidade` ficam sempre vazios. Hoje não dá para saber qual especialidade gerou lead. |
| 4 | `criar_reuniao` envia `Remotejid = $('Dados').item.json.email`, que não existe. A descrição cita uma tool `agendar_reuniao`, que também não existe. | Agendamentos podem falhar ou ficar sem vínculo com o paciente. |
| 5 | Números fixos no fluxo (`5588981014974`, `5588996544951`), inclusive em `Delete Memory1`. | Quebra ao trocar de número e expõe dado pessoal no JSON. |
| 6 | O `Set` do debounce remove mensagens iguais ("sim", "sim"). | Perde confirmações repetidas. |
| 7 | A tool `consultar_horarios` exige 3 opções, mas a grade da Dra. Priscilla (seg 15–17h, 30 min) pode ter menos de 3 vagas. | O agente repete chamadas ou inventa. |
| 8 | Texto de pressão: "Estes são os horários mais disputados". | Escassez artificial em saúde é risco ético (CFM) e de reputação. Sugestão: manter só quando for verdade (vagas reais). |

## Gargalos de velocidade (latência até a primeira resposta)

| Etapa | Tempo fixo |
|-------|-----------|
| Debounce Redis | 25 s |
| "Espera gerente Geral" | 15 s |
| LLM de fatiamento (gpt-4.1-mini) | ~1–2 s |
| Delay do envio por mensagem | 4,2 s |
| Espera entre mensagens | 10 s (o nó se chama "1 segundo") |
| Marcelia (gpt-4.1 + Cerebro como 2º agente + tools) | 4–10 s |

**Resultado: 45–55 s antes da 1ª resposta e mais 14 s por mensagem adicional.** Um lead de WhatsApp espera uma resposta em menos de 10 s.

Outros custos desnecessários:
- O classificador de setor usa gpt-4.1 completo para devolver uma palavra, em paralelo a uma espera fixa de 15 s. Vira **uma tool** (`atualizar_lead`) dentro da mesma chamada da Marcelia.
- "Cerebro" é um agente inteiro só para responder o endereço. Vai para o prompt/tabela.
- O fatiamento por LLM pode reescrever ou omitir horários. Vira uma função determinística.
- O histórico é gravado em `n8n_chat_histories`, `n8n_chat_histories_gerente` e `chat_messages`. Vira uma só tabela `messages`.
- Redis só serve para debounce. O Postgres resolve com uma checagem de "chegou mensagem mais nova?".

## O que não existe e o CRM precisa
- Etapa do funil (novo → qualificado → horário oferecido → agendado → compareceu / perdido).
- Especialidade de interesse e convênio por lead.
- Origem do lead e motivo de perda.
- Aprendizado: nada mede o que converte, e o prompt é um texto fixo dentro do nó.

## O que foi preservado
Evolution API como canal, Supabase como banco, a persona Marcelia, a lógica de convênios (Dr. Gledson só particular, anexo de redirecionamento), as grades de horário e os preços, a pausa quando um humano assume e a reativação com "Atendimento finalizado".

## Pontos para confirmar com a clínica
Os preços, horários e convênios foram copiados do prompt atual e estão em `lib/clinic-config.ts`. Confirme se estão em dia. Dados de saúde exigem atenção à LGPD: o schema usa RLS e não guarda nada clínico, só a intenção de agendamento.

## Metas após a migração
- 1ª resposta em **6–12 s** (debounce de 6 s + 1 chamada de LLM).
- Custo por conversa cerca de 60% menor (um modelo no lugar de quatro chamadas).
- 100% dos leads com especialidade, etapa e score preenchidos.

## Análise dos workflows de agenda (Consultar Horários e Horário Real)

**Bugs encontrados**
- O reagendamento nunca funcionou: o nó de atualização usa `{{ json.id }}` (sem `$`) e lê `query.start/end`, enquanto a ferramenta envia `startTime/endTime`.
- O texto de reagendamento devolve um "link da reunião" (`hangoutLink`), que não existe numa clínica.
- Os cálculos de horário usam o fuso do servidor (`getTimezoneOffset`) e só depois colam `-03:00`. Em servidor UTC os horários ficam errados.
- A mensagem de "horário indisponível" diz "segunda a sexta, 9h às 17h", que não é a grade de nenhum profissional.
- O workflow "Normalizar Ano" empurra datas passadas para o dia seguinte, o que mascara o modelo errando o ano em vez de corrigir a causa.
- A checagem de "já tem evento" exige e-mail de convidado, mas os eventos são criados sem convidados; a checagem nunca dispara.
- O fluxo está copiado quatro vezes, uma por profissional.
- O workflow de horários devolve sempre os 3 primeiros horários, quase sempre do mesmo dia.

**O que mudou no sistema novo**
- Um único código para os quatro profissionais, com fuso fixo de Fortaleza.
- Horário escolhido é revalidado contra a agenda antes de criar o evento.
- Bloqueia consulta duplicada com o mesmo profissional e oferece reagendar.
- Reagendar cria o novo horário antes de cancelar o antigo.
- Cancelar acha também eventos criados à mão na agenda, pelo link do WhatsApp na descrição.
- Mantém a convenção da equipe: título do evento = nome do paciente; descrição com o link do WhatsApp.
- Horários espalhados: no máximo 2 por dia, em dias diferentes.

**Divergências entre o prompt e os workflows (confirmar)**
| Profissional | Prompt do agente | Workflow que rodava |
|---|---|---|
| Dra. Priscilla | segunda 15h–17h, de 30 em 30 min | segunda 14h–17h, de 60 em 60 min |
| Dra. Maraysa | segunda 14h–17h, de 30 em 30 min | segunda 14h–17h, de 60 em 60 min |
| Dra. Fernanda | sábado 8h–12h, de 45 em 45 min | sábado 8h–12h, de 60 em 60 min |
| Dr. Gledson | seg 16–18h, qua 14–17h, sex 14–17h | seg 16–21h, qua 14–21h, sex 14–18h, de 60 em 60 min |
