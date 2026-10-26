import { useCallback, useEffect, useState } from "react";
import type { Base } from "../App";
import { Erro, StatusConta } from "../componentes";
import { type ContaFixaResumo, hojeISO, ok, reais, supabase } from "../dados";

interface ContaFixa {
  id: number;
  nome: string;
  valor_previsto: number;
  dia_vencimento: number | null;
  categoria_id: number;
  ativa: boolean;
}

export default function ContasFixas({ mes, categorias }: Base) {
  const [contas, setContas] = useState<ContaFixa[]>([]);
  const [status, setStatus] = useState<Record<number, ContaFixaResumo>>({});
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState<Partial<ContaFixa> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        supabase.from("contas_fixas").select("*").order("ativa", { ascending: false }).order("dia_vencimento"),
        supabase.rpc("resumo_mes", { p_mes: `${mes}-01` }),
      ]);
      setContas(ok(c) as ContaFixa[]);
      const resumo = ok(r) as { contas_fixas: ContaFixaResumo[] };
      setStatus(Object.fromEntries(resumo.contas_fixas.map((s) => [s.id, s])));
      setErro("");
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [mes]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const { id, ...campos } = editando;
    try {
      ok(id
        ? await supabase.from("contas_fixas").update(campos).eq("id", id)
        : await supabase.from("contas_fixas").insert(campos));
      setEditando(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function marcarPaga(c: ContaFixa) {
    const texto = prompt(`Valor pago de "${c.nome}" (R$):`, String(c.valor_previsto).replace(".", ","));
    if (texto === null) return;
    const valor = Number(texto.replace(/\./g, "").replace(",", "."));
    if (!(valor > 0)) return setErro("Valor inválido.");
    // No mês atual usa hoje; em outro mês, o dia do vencimento.
    const data = hojeISO().startsWith(mes)
      ? hojeISO()
      : `${mes}-${String(Math.min(c.dia_vencimento ?? 1, 28)).padStart(2, "0")}`;
    try {
      ok(await supabase.from("lancamentos").insert({
        valor, data, descricao: c.nome, categoria_id: c.categoria_id, conta_fixa_id: c.id, origem: "painel",
      }));
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const ativas = contas.filter((c) => c.ativa);
  const totalPrevisto = ativas.reduce((s, c) => s + Number(c.valor_previsto), 0);

  return (
    <div>
      <Erro erro={erro} />
      <section className="cartao">
        <h2>
          Contas fixas <small>{reais(totalPrevisto)} previstos por mês</small>
        </h2>
        <div className="tabela-rolagem">
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th className="esconder-celular">Categoria</th>
                <th>Vence</th>
                <th className="num">Previsto</th>
                <th>Este mês</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contas.length === 0 && (
                <tr><td colSpan={6} className="vazio">Nenhuma conta fixa. Cadastre abaixo ou mande no WhatsApp: “aluguel 2.500 todo dia 10”.</td></tr>
              )}
              {contas.map((c) => {
                const s = status[c.id];
                return (
                  <tr key={c.id} style={c.ativa ? undefined : { opacity: 0.5 }}>
                    <td>{c.nome}{!c.ativa && <span className="detalhe"> · desativada</span>}</td>
                    <td className="esconder-celular">{categorias.find((k) => k.id === c.categoria_id)?.nome}</td>
                    <td>{c.dia_vencimento ? `dia ${c.dia_vencimento}` : "—"}</td>
                    <td className="num">{reais(Number(c.valor_previsto))}</td>
                    <td>
                      {c.ativa && s && <StatusConta pago={s.pago} dia={c.dia_vencimento} mes={mes} />}
                      {s?.pago && <div className="detalhe">{reais(s.valor_pago)}</div>}
                    </td>
                    <td>
                      <div className="acoes">
                        {c.ativa && !s?.pago && (
                          <button className="botao icone" onClick={() => marcarPaga(c)}>Paguei</button>
                        )}
                        <button className="botao icone" onClick={() => setEditando(c)} title="Editar">✎</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <form className="cartao formulario secao" onSubmit={salvar}>
        <h2 style={{ width: "100%" }}>{editando?.id ? `Editar ${editando.nome}` : "Nova conta fixa"}</h2>
        <label className="campo" style={{ flex: 1, minWidth: 160 }}>
          Nome
          <input required value={editando?.nome ?? ""} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} />
        </label>
        <label className="campo">
          Valor previsto
          <input required type="number" step="0.01" min="0" style={{ width: 120 }}
            value={editando?.valor_previsto ?? ""}
            onChange={(e) => setEditando({ ...editando, valor_previsto: Number(e.target.value) })} />
        </label>
        <label className="campo">
          Dia
          <input type="number" min="1" max="31" style={{ width: 70 }}
            value={editando?.dia_vencimento ?? ""}
            onChange={(e) => setEditando({ ...editando, dia_vencimento: e.target.value ? Number(e.target.value) : null })} />
        </label>
        <label className="campo">
          Categoria
          <select required value={editando?.categoria_id ?? ""}
            onChange={(e) => setEditando({ ...editando, categoria_id: Number(e.target.value) })}>
            <option value="">Escolha…</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.nome}</option>)}
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
        <button className="botao primario">{editando?.id ? "Salvar" : "Cadastrar"}</button>
        {editando && <button type="button" className="botao" onClick={() => setEditando(null)}>Cancelar</button>}
      </form>
    </div>
  );
}
