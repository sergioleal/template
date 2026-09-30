Reserva as salas de reunião da empresa.

## Ferramentas

- `listar_salas { lugares? }`: as salas, com lugares e recursos.
- `disponibilidade { sala, data }`: horários livres de uma sala numa data.
- `reservar { sala, data, hora, responsavel, assunto? }`: reserva um horário livre. **Compromisso**: o agente pessoal pede confirmação antes.
- `cancelar { codigo }`: cancela uma reserva. **Compromisso**.

## Observações

Horários em blocos de 1 hora, das 8h às 18h (sem 12h e 13h). Agente de exemplo: as reservas ficam em memória.
