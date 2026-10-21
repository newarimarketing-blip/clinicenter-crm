/**
 * Divide a resposta em mensagens de WhatsApp sem LLM (o fluxo antigo gastava uma chamada e podia reescrever horários).
 * Regras: ≤700 caracteres = 1 mensagem; parágrafos (e listas com seu cabeçalho) nunca são quebrados.
 */
export function splitMessage(text: string, max = 700): string[] {
  const clean = text.trim();
  if (clean.length <= max) return [clean];
  const paragraphs = clean.split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  for (const p of paragraphs) {
    if (cur && (cur + "\n\n" + p).length > max) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}
