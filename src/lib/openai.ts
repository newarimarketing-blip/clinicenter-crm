import OpenAI from "openai";

let client: OpenAI | null = null;
export const openai = () => (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

export async function transcribe(base64: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  const file = new File([buf], "audio.ogg", { type: "audio/ogg" });
  const r = await openai().audio.transcriptions.create({ file, model: "gpt-4o-mini-transcribe", language: "pt" });
  return r.text.trim();
}

export async function describeImage(base64: string, mime = "image/jpeg"): Promise<string> {
  const r = await openai().chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 120,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Descreva em uma frase curta, em português, o que a imagem mostra. Se for exame, receita, encaminhamento ou comprovante, diga apenas o tipo de documento (não transcreva dados pessoais)." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
  });
  return r.choices[0]?.message?.content?.trim() ?? "imagem";
}
