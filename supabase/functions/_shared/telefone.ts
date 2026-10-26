/**
 * O WhatsApp às vezes identifica celulares brasileiros sem o nono dígito
 * (+55 47 9999-8888 em vez de +55 47 99999-8888). Gera as duas formas para
 * achar o membro cadastrado, qualquer que seja a forma que chegou.
 */
export function variantesTelefone(telefone: string): string[] {
  const numero = "+" + telefone.replace(/\D/g, "");
  const variantes = new Set([numero]);
  const br = /^\+55(\d{2})(\d+)$/.exec(numero);
  if (br) {
    const [, ddd, resto] = br;
    if (resto.length === 9 && resto.startsWith("9")) variantes.add(`+55${ddd}${resto.slice(1)}`);
    if (resto.length === 8 && /^[6-9]/.test(resto)) variantes.add(`+55${ddd}9${resto}`);
  }
  return [...variantes];
}
