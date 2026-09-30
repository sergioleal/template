/**
 * Identificadores de agente no formato ISIN (ISO 6166), sem vínculo com ISINs reais:
 *   2 letras de prefixo + 9 alfanuméricos + 1 dígito verificador (Luhn sobre a expansão A=10…Z=35).
 * O prefixo deve ser um código ISO 3166 de uso privado (AA, QM–QZ, XA–XZ, ZZ) para não colidir com ISINs de verdade.
 */

export const AGENT_ID_LENGTH = 12;

// Na geração evitamos I e O (confundíveis com 1 e 0); na validação aceitamos qualquer caractere ISIN.
const GENERATION_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ID_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const PREFIX_PATTERN = /^[A-Z]{2}$/;

function expand(body: string): string {
  let out = "";
  for (const ch of body) {
    const code = ch.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  return out;
}

/** Calcula o dígito verificador para os 11 primeiros caracteres. */
export function checkDigit(body: string): number {
  const digits = expand(body);
  let sum = 0;
  // Dobramos a partir do dígito mais à direita, pois o verificador será anexado depois dele.
  for (let i = digits.length - 1, pos = 0; i >= 0; i--, pos++) {
    let d = digits.charCodeAt(i) - 48;
    if (pos % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** Normaliza entrada do usuário: remove espaços/hífens e passa para maiúsculas. */
export function normalizeAgentId(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidAgentId(id: string): boolean {
  if (!ID_PATTERN.test(id)) return false;
  return checkDigit(id.slice(0, 11)) === Number(id[11]);
}

/**
 * Federação: os 2 primeiros caracteres do corpo identificam o nó que gerou o ID, para cada nó
 * gerar IDs sem coordenação e sem colidir com os demais:
 *   ZZ  K7  Q2M9XH4  2
 *   │   │   │        └─ dígito verificador
 *   │   │   └─ 7 aleatórios
 *   │   └─ código do nó (atribuído pelo hub)
 *   └─ prefixo
 * IDs antigos (sem código de nó) continuam válidos: o hub nunca atribui a um nó um código que já
 * apareça nessa posição em algum ID existente. O código indica quem gerou o ID, não quem é o dono
 * hoje — a autoridade sobre o agente fica registrada no hub.
 */
export const NODE_CODE_PATTERN = /^[0-9A-HJ-NP-Z]{2}$/;

export const isValidNodeCode = (code: string) => NODE_CODE_PATTERN.test(code);

/** Código de nó embutido no ID (posições 3–4). */
export const nodeCodeOf = (id: string) => id.slice(2, 4);

function randomChars(count: number): string {
  const n = GENERATION_ALPHABET.length;
  // Amostragem por rejeição para distribuição uniforme.
  const limit = 256 - (256 % n);
  let out = "";
  const buf = new Uint8Array(32);
  while (out.length < count) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && out.length < count) out += GENERATION_ALPHABET[b % n];
    }
  }
  return out;
}

export const randomNodeCode = () => randomChars(2);

export function generateAgentId(prefix: string, nodeCode?: string): string {
  if (!PREFIX_PATTERN.test(prefix)) throw new Error(`Prefixo de ID inválido: ${prefix}`);
  if (nodeCode !== undefined && !isValidNodeCode(nodeCode)) throw new Error(`Código de nó inválido: ${nodeCode}`);
  const body = prefix + (nodeCode ?? "") + randomChars(9 - (nodeCode?.length ?? 0));
  return body + checkDigit(body);
}
