import { useEffect, useState } from "react";
import { reais } from "./dados";

/** Lê as cores do tema (CSS) para os gráficos SVG, e acompanha a troca claro/escuro. */
export function useCores() {
  const ler = () => {
    const css = getComputedStyle(document.documentElement);
    const v = (nome: string) => css.getPropertyValue(nome).trim();
    return {
      acento: v("--acento"),
      neutro: v("--neutro-dado"),
      grade: v("--grade"),
      texto3: v("--texto-3"),
      series: [v("--serie-1"), v("--serie-2"), v("--serie-3")],
    };
  };
  const [cores, setCores] = useState(ler);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const atualizar = () => setCores(ler());
    mq.addEventListener("change", atualizar);
    return () => mq.removeEventListener("change", atualizar);
  }, []);
  return cores;
}

export interface ItemBarra {
  chave: string;
  nome: string;
  valor: number;
  detalhe?: string;
  orcamento?: number | null;
}

/**
 * Ranking em barras horizontais (magnitude: um tom só). Quando há orçamento,
 * uma marca vertical mostra o limite, e o estouro vem com ícone + texto.
 */
export function BarrasHorizontais({ itens, vazio }: { itens: ItemBarra[]; vazio: string }) {
  if (itens.length === 0) return <p className="vazio">{vazio}</p>;
  const maximo = Math.max(...itens.map((i) => Math.max(i.valor, i.orcamento ?? 0)), 1);
  return (
    <ul className="barras">
      {itens.map((i) => {
        const estourou = i.orcamento != null && i.valor > i.orcamento;
        const quase = i.orcamento != null && !estourou && i.valor >= 0.8 * i.orcamento;
        const titulo = `${i.nome}: ${reais(i.valor)}${i.orcamento != null ? ` de ${reais(i.orcamento)} orçados` : ""}`;
        return (
          <li key={i.chave} className="barra" tabIndex={0} title={titulo} aria-label={titulo}>
            <span className="nome">{i.nome}</span>
            <span className="quanto">
              {reais(i.valor)}
              {i.orcamento != null && <small>/ {reais(i.orcamento)}</small>}
              {i.detalhe && <small>{i.detalhe}</small>}
            </span>
            <span className="trilho">
              <span className="preenchimento" style={{ width: `${(i.valor / maximo) * 100}%` }} />
              {i.orcamento != null && (
                <span className="marca-orcamento" style={{ left: `calc(${(i.orcamento / maximo) * 100}% - 1px)` }} />
              )}
            </span>
            {estourou && (
              <span className="aviso">
                <span className="status atrasado">⚠ Passou {reais(i.valor - i.orcamento!)} do orçamento</span>
              </span>
            )}
            {quase && (
              <span className="aviso">
                <span className="status pendente">● {Math.round((i.valor / i.orcamento!) * 100)}% do orçamento</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Indicador({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
  return (
    <div className="cartao indicador">
      <div className="rotulo">{rotulo}</div>
      <div className="valor">{valor}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Erro({ erro }: { erro: string }) {
  return erro ? <div className="mensagem-erro">{erro}</div> : null;
}

/** Status de uma conta fixa no mês, sempre com ícone e texto. */
export function StatusConta({ pago, dia, mes }: { pago: boolean; dia: number | null; mes: string }) {
  if (pago) return <span className="status pago">✓ Paga</span>;
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const vencimento = dia ? `${mes}-${String(dia).padStart(2, "0")}` : null;
  if (vencimento && vencimento < hoje) return <span className="status atrasado">⚠ Vencida</span>;
  return <span className="status pendente">● Pendente</span>;
}
