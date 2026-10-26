import { useCallback, useEffect, useState } from "react";
import type { Base } from "../App";
import { Erro } from "../componentes";
import { dataCurta, dataPadrao, limitesMes, lerValor, nomeMes, ok, reais, supabase } from "../dados";

interface Receita {
  id: number;
  nome: string;
  valor_medio: number;
  dia_recebimento: number | null;
  membro_id: string | null;
  ativa: boolean;
}

interface Extra {
  id: number;
  data: string;
  valor: number;
  descricao: string;
  membro_id: string | null;
}

export default function Receitas({ mes, membros }: Base) {
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState<Partial<Receita> | null>(null);
  const [extra, setExtra] = useState({ valor: "", descricao: "", data: dataPadrao(mes), membro_id: "" });

  useEffect(() => {
    setExtra((x) => ({ ...x, data: dataPadrao(mes) }));
  }, [mes]);

  const carregar = useCallback(async () => {
    try {
      const [inicio, fim] = limitesMes(mes);
      const [r, x] = await Promise.all([
        supabase.from("receitas").select("*").order("ativa", { ascending: false }).order("nome"),
        supabase.from("receitas_extras").select("*").gte("data", inicio).lt("data", fim).order("data"),
      ]);
      setReceitas(ok(r) as Receita[]);
      setExtras(ok(x) as Extra[]);
      setErro("");
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [mes]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function executar(acao: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    try {
      ok(await acao());
      carregar();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    }
  }

  async function salvarReceita(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const { id, ...campos } = editando;
    const feito = await executar(() =>
      id ? supabase.from("receitas").update(campos).eq("id", id) : supabase.from("receitas").insert(campos));
    if (feito) setEditando(null);
  }

  async function salvarExtra(e: React.FormEvent) {
    e.preventDefault();
    const feito = await executar(() =>
      supabase.from("receitas_extras").insert({
        valor: lerValor(extra.valor),
        descricao: extra.descricao,
        data: extra.data,
        membro_id: extra.membro_id || null,
      }));
    if (feito) setExtra({ ...extra, valor: "", descricao: "" });
  }

  const nomeMembro = (id: string | null) => membros.find((m) => m.id === id)?.nome ?? "—";
  const totalRecorrente = receitas.filter((r) => r.ativa).reduce((s, r) => s + Number(r.valor_medio), 0);
  const totalExtras = extras.reduce((s, x) => s + Number(x.valor), 0);

  return (
    <div>
      <Erro erro={erro} />
      <section className="cartao">
        <h2>Entradas recorrentes <small>{reais(totalRecorrente)} por mês, em média</small></h2>
        <table>
          <thead>
            <tr><th>Entrada</th><th className="esconder-celular">De quem</th><th>Dia</th><th className="num">Valor médio</th><th /></tr>
          </thead>
          <tbody>
            {receitas.length === 0 && (
              <tr><td colSpan={5} className="vazio">Cadastre abaixo as entradas de todo mês (salário, pró-labore…) pelo valor médio.</td></tr>
            )}
            {receitas.map((r) => (
              <tr key={r.id} style={r.ativa ? undefined : { opacity: 0.5 }}>
                <td>{r.nome}{!r.ativa && <span className="detalhe"> · desativada</span>}</td>
                <td className="esconder-celular">{nomeMembro(r.membro_id)}</td>
                <td>{r.dia_recebimento ? `dia ${r.dia_recebimento}` : "—"}</td>
                <td className="num">{reais(Number(r.valor_medio))}</td>
                <td><div className="acoes"><button className="botao icone" onClick={() => setEditando(r)} title="Editar">✎</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>

        <form className="formulario secao" onSubmit={salvarReceita}>
          <label className="campo" style={{ flex: 1, minWidth: 140 }}>
            Nome
            <input required value={editando?.nome ?? ""} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} placeholder="Salário" />
          </label>
          <label className="campo">
            Valor médio
            <input required type="number" step="0.01" min="0" style={{ width: 120 }} value={editando?.valor_medio ?? ""}
              onChange={(e) => setEditando({ ...editando, valor_medio: Number(e.target.value) })} />
          </label>
          <label className="campo">
            Dia
            <input type="number" min="1" max="31" style={{ width: 70 }} value={editando?.dia_recebimento ?? ""}
              onChange={(e) => setEditando({ ...editando, dia_recebimento: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <label className="campo">
            De quem
            <select value={editando?.membro_id ?? ""} onChange={(e) => setEditando({ ...editando, membro_id: e.target.value || null })}>
              <option value="">—</option>
              {membros.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
          {editando?.id && (
            <label className="campo">
              Ativa
              <select value={String(editando.ativa)} onChange={(e) => setEditando({ ...editando, ativa: e.target.value === "true" })}>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            </label>
          )}
          <button className="botao primario">{editando?.id ? "Salvar" : "Cadastrar entrada"}</button>
          {editando && <button type="button" className="botao" onClick={() => setEditando(null)}>Cancelar</button>}
        </form>
      </section>

      <section className="cartao secao">
        <h2>Entradas extras de {nomeMes(mes)} <small>{reais(totalExtras)}</small></h2>
        <table>
          <tbody>
            {extras.length === 0 && <tr><td className="vazio">Nenhuma entrada extra neste mês (13º, bônus, reembolso…).</td></tr>}
            {extras.map((x) => (
              <tr key={x.id}>
                <td>{dataCurta(x.data)}</td>
                <td>{x.descricao}</td>
                <td className="esconder-celular">{nomeMembro(x.membro_id)}</td>
                <td className="num">{reais(Number(x.valor))}</td>
                <td>
                  <div className="acoes">
                    <button className="botao icone perigo" title="Apagar"
                      onClick={() => confirm(`Apagar "${x.descricao}"?`) && executar(() => supabase.from("receitas_extras").delete().eq("id", x.id))}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form className="formulario secao" onSubmit={salvarExtra}>
          <label className="campo">
            Valor (R$)
            <input required inputMode="decimal" style={{ width: 110 }} value={extra.valor} onChange={(e) => setExtra({ ...extra, valor: e.target.value })} />
          </label>
          <label className="campo" style={{ flex: 1, minWidth: 140 }}>
            Descrição
            <input required value={extra.descricao} onChange={(e) => setExtra({ ...extra, descricao: e.target.value })} />
          </label>
          <label className="campo">
            Data
            <input type="date" required value={extra.data} onChange={(e) => setExtra({ ...extra, data: e.target.value })} />
          </label>
          <label className="campo">
            De quem
            <select value={extra.membro_id} onChange={(e) => setExtra({ ...extra, membro_id: e.target.value })}>
              <option value="">—</option>
              {membros.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
          <button className="botao primario">Adicionar entrada</button>
        </form>
      </section>
    </div>
  );
}
