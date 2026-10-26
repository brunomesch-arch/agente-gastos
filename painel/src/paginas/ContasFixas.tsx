import { useCallback, useEffect, useState } from "react";
import type { Base } from "../App";
import { Erro, StatusConta } from "../componentes";
import { type ContaFixaResumo, dataPadrao, lerValor, ok, reais, supabase } from "../dados";

interface ContaFixa {
  id: number;
  nome: string;
  valor_previsto: number;
  dia_vencimento: number | null;
  categoria_id: number;
  ativa: boolean;
}

export default function ContasFixas({ mes, categorias, eu }: Base) {
  const [contas, setContas] = useState<ContaFixa[]>([]);
  const [status, setStatus] = useState<Record<number, ContaFixaResumo>>({});
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState<Partial<ContaFixa> | null>(null);
  // Pagamentos a registrar: conta → valor digitado (marcada = está no objeto).
  const [aPagar, setAPagar] = useState<Record<number, string>>({});
  const [registrando, setRegistrando] = useState(false);

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

  /** Data do pagamento: o dia do vencimento no mês escolhido (ou a data padrão do mês). */
  function dataDoPagamento(c: ContaFixa): string {
    if (!c.dia_vencimento) return dataPadrao(mes);
    const [a, m] = mes.split("-").map(Number);
    const ultimo = new Date(a, m, 0).getDate();
    return `${mes}-${String(Math.min(c.dia_vencimento, ultimo)).padStart(2, "0")}`;
  }

  async function registrarPagamentos() {
    const linhas = Object.entries(aPagar).map(([id, texto]) => {
      const c = contas.find((x) => x.id === Number(id))!;
      return {
        valor: lerValor(texto),
        data: dataDoPagamento(c),
        descricao: c.nome,
        categoria_id: c.categoria_id,
        conta_fixa_id: c.id,
        membro_id: eu?.id ?? null,
        origem: "painel",
      };
    });
    const invalida = linhas.find((l) => !(l.valor > 0));
    if (invalida) return setErro(`Valor inválido em "${invalida.descricao}".`);
    setRegistrando(true);
    try {
      ok(await supabase.from("lancamentos").insert(linhas));
      setAPagar({});
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRegistrando(false);
    }
  }

  function alternar(c: ContaFixa) {
    setAPagar((atual) => {
      const novo = { ...atual };
      if (c.id in novo) delete novo[c.id];
      else novo[c.id] = String(c.valor_previsto).replace(".", ",");
      return novo;
    });
  }

  const pendentes = contas.filter((c) => c.ativa && !status[c.id]?.pago);
  const totalSelecionado = Object.values(aPagar).reduce((s, v) => s + (lerValor(v) || 0), 0);

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
                <th style={{ width: 32 }}>
                  {pendentes.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Marcar todas as pendentes"
                      checked={pendentes.every((c) => c.id in aPagar)}
                      onChange={(e) =>
                        setAPagar(e.target.checked
                          ? Object.fromEntries(pendentes.map((c) => [c.id, String(c.valor_previsto).replace(".", ",")]))
                          : {})}
                    />
                  )}
                </th>
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
                <tr><td colSpan={7} className="vazio">Nenhuma conta fixa ainda. Cadastre abaixo (aluguel, luz, internet, escola…).</td></tr>
              )}
              {contas.map((c) => {
                const s = status[c.id];
                return (
                  <tr key={c.id} style={c.ativa ? undefined : { opacity: 0.5 }}>
                    <td>
                      {c.ativa && !s?.pago && (
                        <input type="checkbox" aria-label={`Pagar ${c.nome}`} checked={c.id in aPagar} onChange={() => alternar(c)} />
                      )}
                    </td>
                    <td>{c.nome}{!c.ativa && <span className="detalhe"> · desativada</span>}</td>
                    <td className="esconder-celular">{categorias.find((k) => k.id === c.categoria_id)?.nome}</td>
                    <td>{c.dia_vencimento ? `dia ${c.dia_vencimento}` : "—"}</td>
                    <td className="num">{reais(Number(c.valor_previsto))}</td>
                    <td>
                      {c.id in aPagar ? (
                        <input
                          inputMode="decimal"
                          aria-label={`Valor pago de ${c.nome}`}
                          value={aPagar[c.id]}
                          onChange={(e) => setAPagar({ ...aPagar, [c.id]: e.target.value })}
                          style={{ width: 110, textAlign: "right" }}
                        />
                      ) : (
                        <>
                          {c.ativa && s && <StatusConta pago={s.pago} dia={c.dia_vencimento} mes={mes} />}
                          {s?.pago && <div className="detalhe">{reais(s.valor_pago)}</div>}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="acoes">
                        <button className="botao icone" onClick={() => setEditando(c)} title="Editar">✎</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pendentes.length > 0 && (
          <div className="formulario secao" style={{ marginBottom: 0 }}>
            <button className="botao primario" disabled={registrando || Object.keys(aPagar).length === 0} onClick={registrarPagamentos}>
              {Object.keys(aPagar).length === 0
                ? "Marque as contas pagas"
                : `Registrar ${Object.keys(aPagar).length} pagamento(s) · ${reais(totalSelecionado)}`}
            </button>
            <span className="detalhe">Marque as contas já pagas e ajuste o valor real (a conta de luz varia, por exemplo). O pagamento vira um gasto do mês.</span>
          </div>
        )}
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
