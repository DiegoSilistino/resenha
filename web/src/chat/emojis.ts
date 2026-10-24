/**
 * Emojis do seletor de reações, com palavras de busca em português.
 * Uma lista enxuta (os mais usados em grupo de amigos) em vez de uma biblioteca de 500 KB.
 */
export interface EmojiCategory {
  id: string;
  label: string;
  emojis: (readonly [emoji: string, keywords: string])[];
}

/** Barra rápida quando a pessoa ainda não tem recentes. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"] as const;

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "rostos",
    label: "Rostos",
    emojis: [
      ["😂", "rindo chorando risada kkk"],
      ["🤣", "rolando de rir gargalhada kkkk"],
      ["😅", "sorriso nervoso suor ufa"],
      ["😆", "rindo muito haha"],
      ["😁", "sorrisão dentes"],
      ["😀", "feliz sorriso"],
      ["😊", "sorriso fofo contente"],
      ["🙂", "sorriso leve"],
      ["😉", "piscadinha"],
      ["😍", "apaixonado olhos coração"],
      ["🥰", "amor carinho"],
      ["😘", "beijo"],
      ["😎", "óculos estiloso de boa"],
      ["🤩", "estrela uau incrível"],
      ["🥳", "festa comemoração aniversário"],
      ["😇", "anjo inocente"],
      ["🤔", "pensando hmm dúvida"],
      ["🧐", "monóculo analisando"],
      ["🤨", "desconfiado sobrancelha"],
      ["😐", "sem expressão neutro"],
      ["😑", "sem paciência"],
      ["🙄", "revirando olhos aff"],
      ["😏", "sorriso malicioso"],
      ["😬", "constrangido ops"],
      ["😮", "surpreso uau nossa"],
      ["😯", "espantado"],
      ["😲", "chocado"],
      ["🤯", "explodiu a mente"],
      ["😳", "envergonhado corado"],
      ["🥺", "por favor carinha pidona"],
      ["😢", "triste choro lágrima"],
      ["😭", "chorando muito"],
      ["😤", "bufando bravo"],
      ["😡", "bravo raiva"],
      ["🤬", "xingando palavrão"],
      ["😱", "grito medo pânico"],
      ["😴", "dormindo sono zzz"],
      ["🥱", "bocejo sono tédio"],
      ["🤤", "babando"],
      ["🤢", "enjoado nojo"],
      ["🤮", "vomitando nojo"],
      ["🤧", "espirro gripe"],
      ["🥴", "tonto bêbado"],
      ["🤐", "boca fechada segredo"],
      ["🤫", "silêncio psiu"],
      ["🤭", "risadinha ops"],
      ["🫡", "continência sim senhor"],
      ["🫠", "derretendo"],
      ["💀", "caveira morri de rir"],
      ["☠️", "caveira perigo"],
      ["🤡", "palhaço"],
      ["👻", "fantasma"],
      ["🤖", "robô bot"],
      ["👽", "alien"],
      ["💩", "cocô"],
      ["🙈", "macaco não vi vergonha"],
    ],
  },
  {
    id: "gestos",
    label: "Gestos",
    emojis: [
      ["👍", "joinha positivo sim ok"],
      ["👎", "negativo não"],
      ["👏", "palmas aplausos"],
      ["🙌", "comemorando mãos para cima"],
      ["🙏", "por favor obrigado reza"],
      ["🤝", "aperto de mão acordo"],
      ["👊", "soco toca aqui"],
      ["✊", "punho força"],
      ["✌️", "paz vitória"],
      ["🤞", "dedos cruzados sorte"],
      ["🤟", "te amo rock"],
      ["🤘", "rock metal"],
      ["👌", "perfeito ok"],
      ["🤌", "italiano"],
      ["👀", "olhando de olho"],
      ["👋", "tchau oi aceno"],
      ["💪", "força músculo"],
      ["🫶", "coração com as mãos"],
      ["☝️", "um minuto atenção"],
      ["👉", "apontando"],
      ["🖕", "dedo"],
      ["🤦", "facepalm vergonha"],
      ["🤷", "sei lá dar de ombros"],
      ["🙋", "eu levantando a mão"],
    ],
  },
  {
    id: "coracoes",
    label: "Corações",
    emojis: [
      ["❤️", "coração amor vermelho"],
      ["🧡", "coração laranja"],
      ["💛", "coração amarelo"],
      ["💚", "coração verde"],
      ["💙", "coração azul"],
      ["💜", "coração roxo"],
      ["🖤", "coração preto"],
      ["🤍", "coração branco"],
      ["💔", "coração partido"],
      ["❤️‍🔥", "coração em chamas"],
      ["💕", "corações"],
      ["💯", "cem perfeito"],
      ["✨", "brilho"],
      ["⭐", "estrela"],
      ["🔥", "fogo top brabo"],
      ["💥", "explosão"],
      ["⚡", "raio rápido"],
      ["🎉", "festa parabéns confete"],
      ["🎊", "confete"],
      ["🏆", "troféu campeão"],
      ["🥇", "medalha ouro primeiro"],
      ["👑", "coroa rei"],
      ["💎", "diamante"],
      ["💰", "dinheiro grana"],
    ],
  },
  {
    id: "jogos",
    label: "Jogos e coisas",
    emojis: [
      ["🎮", "videogame controle jogo"],
      ["🕹️", "joystick fliperama"],
      ["🎯", "alvo na mosca"],
      ["🎲", "dado sorte"],
      ["♟️", "xadrez"],
      ["🃏", "carta coringa"],
      ["⚽", "futebol bola"],
      ["🏀", "basquete"],
      ["🏁", "bandeira chegada corrida"],
      ["🚀", "foguete bora"],
      ["💣", "bomba"],
      ["🔫", "pistola água"],
      ["🗡️", "espada"],
      ["🛡️", "escudo"],
      ["🎧", "fone música"],
      ["🎵", "música nota"],
      ["🎤", "microfone karaokê"],
      ["📺", "tv"],
      ["🍿", "pipoca filme"],
      ["📸", "foto câmera"],
      ["💻", "computador notebook"],
      ["⌨️", "teclado"],
      ["🖱️", "mouse"],
      ["📱", "celular"],
      ["⏰", "despertador horário"],
      ["⌛", "ampulheta esperando"],
      ["💡", "ideia lâmpada"],
      ["📌", "fixar alfinete"],
    ],
  },
  {
    id: "comida",
    label: "Comida",
    emojis: [
      ["🍕", "pizza"],
      ["🍔", "hambúrguer lanche"],
      ["🍟", "batata frita"],
      ["🌭", "cachorro quente"],
      ["🍣", "sushi japonês"],
      ["🍜", "lámen miojo"],
      ["🍩", "rosquinha donut"],
      ["🍫", "chocolate"],
      ["🍦", "sorvete"],
      ["🎂", "bolo aniversário"],
      ["☕", "café"],
      ["🍺", "cerveja"],
      ["🍻", "brinde cerveja"],
      ["🥂", "brinde taça"],
      ["🍷", "vinho"],
      ["🥤", "refrigerante"],
      ["🧉", "chimarrão mate"],
      ["🍉", "melancia"],
    ],
  },
  {
    id: "natureza",
    label: "Bichos e natureza",
    emojis: [
      ["🐶", "cachorro"],
      ["🐱", "gato"],
      ["🐸", "sapo"],
      ["🐵", "macaco"],
      ["🦆", "pato"],
      ["🐔", "galinha"],
      ["🐍", "cobra"],
      ["🦈", "tubarão"],
      ["🐐", "bode goat melhor"],
      ["🦄", "unicórnio"],
      ["🌈", "arco-íris"],
      ["☀️", "sol"],
      ["🌙", "lua noite"],
      ["🌧️", "chuva"],
      ["❄️", "neve frio"],
      ["🌵", "cacto"],
      ["🌹", "rosa flor"],
      ["🍀", "trevo sorte"],
    ],
  },
  {
    id: "simbolos",
    label: "Símbolos",
    emojis: [
      ["✅", "certo feito ok"],
      ["❌", "errado não x"],
      ["⚠️", "atenção cuidado"],
      ["❓", "pergunta dúvida"],
      ["❗", "exclamação importante"],
      ["‼️", "muito importante"],
      ["🆗", "ok"],
      ["🆒", "cool legal"],
      ["🆘", "socorro"],
      ["🔴", "vermelho ao vivo"],
      ["🟢", "verde online"],
      ["➕", "mais um"],
      ["🔁", "repetir de novo"],
      ["🔇", "mudo silêncio"],
      ["🔊", "som alto"],
      ["💤", "dormindo zzz"],
      ["🇧🇷", "brasil bandeira"],
      ["🏳️‍🌈", "orgulho bandeira arco-íris"],
    ],
  },
];

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Busca por palavra ("risada", "coracao", "fogo"); sem acento e sem maiúscula. */
export function searchEmojis(query: string, limit = 48): string[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: string[] = [];
  for (const cat of EMOJI_CATEGORIES) {
    for (const [emoji, keywords] of cat.emojis) {
      const kw = normalize(keywords).split(/\s+/);
      if (words.every((w) => kw.some((k) => k.startsWith(w)))) out.push(emoji);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Primeira palavra-chave do emoji, para o title/aria-label do botão. */
export function emojiName(emoji: string): string {
  for (const cat of EMOJI_CATEGORIES) {
    const hit = cat.emojis.find(([e]) => e === emoji);
    if (hit) return hit[1].split(" ")[0]!;
  }
  return emoji;
}
