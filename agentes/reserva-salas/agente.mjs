/**
 * Agente de exemplo: reserva de salas de reunião. Mostra o que um agente do template precisa ter:
 *   - criar() devolve um McpServer novo a cada requisição (o servidor é stateless; o estado mora fora dele);
 *   - instructions: o que o agente faz, em uma frase no começo (vira o resumo no catálogo) e o fluxo;
 *   - ferramentas de consulta com readOnlyHint: true (o agente pessoal chama sozinho);
 *   - ferramentas de compromisso com destructiveHint: true (o agente pessoal só chama depois que a pessoa confirma);
 *   - erros como resultado com isError: true e uma mensagem que diga o que fazer.
 * Os dados ficam em memória: somem quando o serviço reinicia. Um agente de verdade usa um banco ou uma API.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const CONSULTA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const COMPROMISSO = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

const SALAS = [
  { id: "ipe", nome: "Sala Ipê", lugares: 6, recursos: ["TV", "videoconferência"] },
  { id: "buriti", nome: "Sala Buriti", lugares: 12, recursos: ["projetor", "quadro branco"] },
  { id: "auditorio", nome: "Auditório", lugares: 40, recursos: ["projetor", "som", "palco"] },
];
const HORARIOS = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"];

// Estado do processo (compartilhado entre requisições): reservas por "sala|data|hora".
const reservas = new Map();
let proximo = 1;

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data, AAAA-MM-DD");
const json = (dados) => ({ content: [{ type: "text", text: JSON.stringify(dados) }], structuredContent: dados });
const erro = (mensagem) => ({ content: [{ type: "text", text: mensagem }], isError: true });

export function criar() {
  const servidor = new McpServer(
    { name: "Reserva de Salas", version: "1.0.0" },
    {
      instructions:
        "Reserva salas de reunião da empresa. Fluxo: listar_salas → disponibilidade → reservar. " +
        "reservar e cancelar são compromissos: confirme com a pessoa antes.",
    },
  );

  servidor.registerTool(
    "listar_salas",
    {
      title: "Listar salas",
      description: "As salas, com lugares e recursos. Filtre por número mínimo de lugares.",
      inputSchema: { lugares: z.number().int().min(1).max(500).optional().describe("Mínimo de lugares") },
      annotations: CONSULTA,
    },
    async ({ lugares }) => json({ salas: SALAS.filter((s) => !lugares || s.lugares >= lugares) }),
  );

  servidor.registerTool(
    "disponibilidade",
    {
      title: "Ver horários livres",
      description: "Horários livres de uma sala numa data (blocos de 1 hora).",
      inputSchema: { sala: z.string().describe("id da sala (de listar_salas)"), data },
      annotations: CONSULTA,
    },
    async ({ sala, data }) => {
      if (!SALAS.some((s) => s.id === sala)) return erro(`Sala "${sala}" não existe. Use listar_salas.`);
      return json({ sala, data, livres: HORARIOS.filter((h) => !reservas.has(`${sala}|${data}|${h}`)) });
    },
  );

  servidor.registerTool(
    "reservar",
    {
      title: "Reservar sala",
      description: "Reserva uma sala num horário livre. Compromisso: confirme com a pessoa antes. Devolve o código da reserva.",
      inputSchema: {
        sala: z.string(),
        data,
        hora: z.enum(HORARIOS).describe("Início do bloco de 1 hora"),
        responsavel: z.string().min(2).describe("Quem reserva (nome ou @endereço)"),
        assunto: z.string().max(200).optional(),
      },
      annotations: COMPROMISSO,
    },
    async ({ sala, data, hora, responsavel, assunto }) => {
      if (!SALAS.some((s) => s.id === sala)) return erro(`Sala "${sala}" não existe. Use listar_salas.`);
      const chave = `${sala}|${data}|${hora}`;
      if (reservas.has(chave)) return erro(`A sala ${sala} já está reservada em ${data} às ${hora}. Veja outro horário em disponibilidade.`);
      const reserva = { codigo: `RS-${String(proximo++).padStart(4, "0")}`, sala, data, hora, responsavel, assunto: assunto ?? null };
      reservas.set(chave, reserva);
      return json({ reserva, status: "confirmada" });
    },
  );

  servidor.registerTool(
    "cancelar",
    {
      title: "Cancelar reserva",
      description: "Cancela uma reserva pelo código. Compromisso: confirme com a pessoa antes.",
      inputSchema: { codigo: z.string().describe("Código devolvido por reservar (ex.: RS-0001)") },
      annotations: COMPROMISSO,
    },
    async ({ codigo }) => {
      const achada = [...reservas].find(([, r]) => r.codigo === codigo);
      if (!achada) return erro(`Reserva ${codigo} não encontrada.`);
      reservas.delete(achada[0]);
      return json({ codigo, status: "cancelada" });
    },
  );

  return servidor;
}
